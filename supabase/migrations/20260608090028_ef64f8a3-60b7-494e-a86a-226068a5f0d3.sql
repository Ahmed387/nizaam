
-- Inventory Count (جرد المخزن) feature

CREATE TABLE public.inventory_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting','reviewing','pending_approval','approved','rejected','closed')),
  notes text,
  created_by uuid NOT NULL,
  accountant_id uuid,
  approved_by uuid,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  counted_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  closed_at timestamptz
);

CREATE TABLE public.inventory_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  product_code text NOT NULL,
  unit text,
  system_quantity numeric NOT NULL,
  actual_quantity numeric,
  difference numeric GENERATED ALWAYS AS (COALESCE(actual_quantity,0) - system_quantity) STORED,
  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_isi_session ON public.inventory_session_items(session_id);

CREATE TABLE public.inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  adjustment_amount numeric NOT NULL,
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_iadj_session ON public.inventory_adjustments(session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_session_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_adjustments TO authenticated;
GRANT ALL ON public.inventory_sessions TO service_role;
GRANT ALL ON public.inventory_session_items TO service_role;
GRANT ALL ON public.inventory_adjustments TO service_role;

ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped policies (mirrors pattern in other tables)
CREATE POLICY "inv_sessions_tenant_all" ON public.inventory_sessions
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "inv_items_tenant_all" ON public.inventory_session_items
  FOR ALL TO authenticated
  USING (session_id IN (SELECT id FROM public.inventory_sessions WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())))
  WITH CHECK (session_id IN (SELECT id FROM public.inventory_sessions WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())));

CREATE POLICY "inv_adj_tenant_all" ON public.inventory_adjustments
  FOR ALL TO authenticated
  USING (session_id IN (SELECT id FROM public.inventory_sessions WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())))
  WITH CHECK (session_id IN (SELECT id FROM public.inventory_sessions WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_isi_touch BEFORE UPDATE ON public.inventory_session_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Create session and snapshot all products of branch atomically
CREATE OR REPLACE FUNCTION public.create_inventory_session(p_branch_id uuid, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_session_id uuid;
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;

  INSERT INTO public.inventory_sessions (tenant_id, branch_id, notes, created_by, status)
  VALUES (v_tenant, p_branch_id, p_notes, auth.uid(), 'counting')
  RETURNING id INTO v_session_id;

  INSERT INTO public.inventory_session_items
    (session_id, product_id, product_name, product_code, unit, system_quantity)
  SELECT v_session_id, p.id, p.name, p.sku, 'قطعة', p.quantity
  FROM public.products p
  WHERE p.branch_id = p_branch_id AND p.tenant_id = v_tenant;

  RETURN v_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_inventory_session(uuid, text) TO authenticated;

-- Approve session: apply diffs, create stock_adjustment record, close session
CREATE OR REPLACE FUNCTION public.approve_inventory_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_sess record;
  v_adj_id uuid;
  v_num text;
  r record;
BEGIN
  SELECT * INTO v_sess FROM public.inventory_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_sess IS NULL THEN RAISE EXCEPTION 'session not found'; END IF;
  IF v_sess.status NOT IN ('pending_approval','reviewing') THEN
    RAISE EXCEPTION 'session not in approvable state';
  END IF;

  v_num := 'JRD-' || to_char(now(),'YYYYMMDDHH24MISS');

  INSERT INTO public.stock_adjustments (branch_id, adjustment_number, reason, notes, created_by, tenant_id)
  VALUES (v_sess.branch_id, v_num, 'جرد مخزن', COALESCE(v_sess.notes,''), auth.uid(), v_sess.tenant_id)
  RETURNING id INTO v_adj_id;

  FOR r IN
    SELECT * FROM public.inventory_session_items
    WHERE session_id = p_session_id AND actual_quantity IS NOT NULL AND difference <> 0
  LOOP
    -- Apply to products
    UPDATE public.products SET quantity = r.actual_quantity::int WHERE id = r.product_id;

    -- Record in stock_adjustment_items
    INSERT INTO public.stock_adjustment_items
      (adjustment_id, product_id, product_name, system_quantity, actual_quantity, difference, unit_cost)
    VALUES (v_adj_id, r.product_id, r.product_name, r.system_quantity::int, r.actual_quantity::int, r.difference::int,
            COALESCE((SELECT cost_price FROM public.products WHERE id = r.product_id),0));

    INSERT INTO public.inventory_adjustments (session_id, product_id, adjustment_amount, reason, created_by)
    VALUES (p_session_id, r.product_id, r.difference, r.reason, auth.uid());
  END LOOP;

  UPDATE public.inventory_sessions
  SET status='closed', approved_by=auth.uid(), approved_at=now(), closed_at=now()
  WHERE id = p_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_inventory_session(uuid) TO authenticated;

-- Realtime
ALTER TABLE public.inventory_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_session_items REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_adjustments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_session_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_adjustments;
