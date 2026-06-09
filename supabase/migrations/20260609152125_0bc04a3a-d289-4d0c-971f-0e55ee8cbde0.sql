
-- 1) Reservation table
CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  reserved_quantity numeric NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  cashier_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cashier_name text,
  invoice_draft_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  released_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_reservations TO authenticated;
GRANT ALL ON public.inventory_reservations TO service_role;

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read reservations" ON public.inventory_reservations;
CREATE POLICY "auth read reservations" ON public.inventory_reservations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth insert reservations" ON public.inventory_reservations;
CREATE POLICY "auth insert reservations" ON public.inventory_reservations
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth update reservations" ON public.inventory_reservations;
CREATE POLICY "auth update reservations" ON public.inventory_reservations
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "auth delete reservations" ON public.inventory_reservations;
CREATE POLICY "auth delete reservations" ON public.inventory_reservations
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS ix_reservations_active
  ON public.inventory_reservations (product_id, branch_id, status);
CREATE INDEX IF NOT EXISTS ix_reservations_draft
  ON public.inventory_reservations (invoice_draft_id);
CREATE INDEX IF NOT EXISTS ix_reservations_expires
  ON public.inventory_reservations (expires_at) WHERE status = 'active';

-- 2) Low-stock threshold per product
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS min_stock_level numeric NOT NULL DEFAULT 5;

-- 3) Realtime
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_reservations; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 4) Available quantity = stock - active reservations (non-expired)
CREATE OR REPLACE FUNCTION public.get_available_quantity(p_product_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    COALESCE((SELECT quantity FROM products WHERE id = p_product_id), 0)
    - COALESCE((
        SELECT SUM(reserved_quantity)
          FROM inventory_reservations
         WHERE product_id = p_product_id
           AND branch_id  = p_branch_id
           AND status     = 'active'
           AND expires_at > now()
      ), 0)
  );
$$;

-- 5) Atomic reserve: upsert per (draft_id, product_id) and validate availability
CREATE OR REPLACE FUNCTION public.reserve_stock(
  p_product_id uuid,
  p_branch_id  uuid,
  p_draft_id   text,
  p_quantity   numeric,
  p_cashier_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock numeric;
  v_reserved_other numeric;
  v_my_current numeric;
  v_available_for_me numeric;
  v_existing_id uuid;
  v_tenant uuid;
BEGIN
  SELECT quantity, tenant_id INTO v_stock, v_tenant FROM products WHERE id = p_product_id;
  IF v_stock IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  -- Lock other active reservations rows for accurate count
  SELECT COALESCE(SUM(reserved_quantity),0)
    INTO v_reserved_other
    FROM inventory_reservations
   WHERE product_id = p_product_id
     AND branch_id  = p_branch_id
     AND status     = 'active'
     AND expires_at > now()
     AND invoice_draft_id <> p_draft_id;

  SELECT id, reserved_quantity
    INTO v_existing_id, v_my_current
    FROM inventory_reservations
   WHERE product_id = p_product_id
     AND branch_id  = p_branch_id
     AND invoice_draft_id = p_draft_id
     AND status = 'active'
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  v_available_for_me := GREATEST(0, v_stock - v_reserved_other);

  IF p_quantity > v_available_for_me THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'insufficient',
      'stock', v_stock,
      'reserved_by_others', v_reserved_other,
      'available', v_available_for_me,
      'requested', p_quantity
    );
  END IF;

  IF v_existing_id IS NULL THEN
    INSERT INTO inventory_reservations (
      tenant_id, product_id, branch_id, reserved_quantity,
      cashier_id, cashier_name, invoice_draft_id, status,
      expires_at
    ) VALUES (
      v_tenant, p_product_id, p_branch_id, p_quantity,
      auth.uid(), p_cashier_name, p_draft_id, 'active',
      now() + interval '30 minutes'
    ) RETURNING id INTO v_existing_id;
  ELSE
    UPDATE inventory_reservations
       SET reserved_quantity = p_quantity,
           expires_at = now() + interval '30 minutes'
     WHERE id = v_existing_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', v_existing_id,
    'stock', v_stock,
    'reserved_by_others', v_reserved_other,
    'available_for_me', v_available_for_me - p_quantity + COALESCE(v_my_current,0),
    'expires_at', (now() + interval '30 minutes')
  );
END;
$$;

-- 6) Release helpers
CREATE OR REPLACE FUNCTION public.release_reservations_for_draft(p_draft_id text, p_status text DEFAULT 'cancelled')
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE inventory_reservations
     SET status = p_status, released_at = now()
   WHERE invoice_draft_id = p_draft_id
     AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.release_reservation(p_id uuid, p_status text DEFAULT 'cancelled')
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE inventory_reservations
     SET status = p_status, released_at = now()
   WHERE id = p_id AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.expire_old_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE inventory_reservations
     SET status = 'expired', released_at = now()
   WHERE status = 'active'
     AND expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Grants for RPCs
GRANT EXECUTE ON FUNCTION public.get_available_quantity(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_reservations_for_draft(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_reservation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_old_reservations() TO authenticated, service_role;
