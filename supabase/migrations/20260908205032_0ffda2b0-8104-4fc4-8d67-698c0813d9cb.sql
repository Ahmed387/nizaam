ALTER TABLE public.product_batches
  ADD COLUMN IF NOT EXISTS effective_at timestamptz;

UPDATE public.product_batches
SET effective_at = created_at
WHERE effective_at IS NULL;

ALTER TABLE public.product_batches
  ALTER COLUMN effective_at SET DEFAULT now(),
  ALTER COLUMN effective_at SET NOT NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS initial_stock_date date;

UPDATE public.products
SET initial_stock_date = created_at::date
WHERE initial_stock_date IS NULL;

ALTER TABLE public.products
  ALTER COLUMN initial_stock_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN initial_stock_date SET NOT NULL;

DROP INDEX IF EXISTS public.idx_product_batches_fifo;
CREATE INDEX idx_product_batches_fifo
  ON public.product_batches(product_id, branch_id, effective_at, created_at, id)
  WHERE quantity_remaining > 0;

CREATE OR REPLACE FUNCTION public.validate_product_batch_effective_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.effective_at AT TIME ZONE 'Africa/Cairo')::date > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'تاريخ حركة المخزون لا يمكن أن يكون في المستقبل';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_product_batch_effective_at ON public.product_batches;
CREATE TRIGGER trg_validate_product_batch_effective_at
BEFORE INSERT OR UPDATE OF effective_at ON public.product_batches
FOR EACH ROW EXECUTE FUNCTION public.validate_product_batch_effective_at();

DO $migration$
DECLARE
  r record;
  v_definition text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'consume_product_batches',
        'consume_product_batches_json',
        'peek_product_fifo_cost',
        'admin_set_product_quantity',
        'approve_inventory_session__impl',
        'partial_confirm_transfer__impl'
      )
  LOOP
    v_definition := replace(
      r.definition,
      'ORDER BY created_at ASC, id ASC',
      'ORDER BY effective_at ASC, created_at ASC, id ASC'
    );
    v_definition := replace(
      v_definition,
      'ORDER BY created_at ASC FOR UPDATE',
      'ORDER BY effective_at ASC, created_at ASC, id ASC FOR UPDATE'
    );
    IF v_definition = r.definition AND r.definition ILIKE '%ORDER BY%created_at%ASC%' THEN
      RAISE EXCEPTION 'تعذر تحديث ترتيب FIFO في الدالة %', r.proname;
    END IF;
    IF v_definition <> r.definition THEN
      EXECUTE v_definition;
    END IF;
  END LOOP;
END;
$migration$;

DROP FUNCTION IF EXISTS public.create_product_with_opening_stock(jsonb);

CREATE FUNCTION public.create_product_with_opening_stock(
  p_product jsonb,
  p_initial_stock_date timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_branch uuid := (p_product->>'branch_id')::uuid;
  v_tenant uuid;
  v_current_tenant uuid;
  v_qty int := COALESCE((p_product->>'quantity')::int, 0);
  v_cost numeric := COALESCE((p_product->>'cost_price')::numeric, 0);
  v_effective timestamptz := COALESCE(p_initial_stock_date, now());
  v_effective_date date;
  v_new_id uuid;
  v_value numeric;
  v_inv uuid;
  v_eq uuid;
  v_entry uuid;
  v_num text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'الفرع مطلوب'; END IF;
  IF v_qty < 0 THEN RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة'; END IF;

  v_effective_date := (v_effective AT TIME ZONE 'Africa/Cairo')::date;
  IF v_effective_date > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'تاريخ الكمية الأولية لا يمكن أن يكون في المستقبل';
  END IF;

  SELECT tenant_id INTO v_tenant
  FROM public.branches
  WHERE id = v_branch;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;

  v_current_tenant := public.current_tenant_id();
  IF NOT public.is_super_admin(v_user) AND v_tenant IS DISTINCT FROM v_current_tenant THEN
    RAISE EXCEPTION 'الفرع غير تابع لشركتك';
  END IF;

  IF NOT (
    public.is_super_admin(v_user)
    OR public.has_role(v_user, 'owner'::public.app_role)
    OR public.has_role(v_user, 'admin'::public.app_role)
    OR public.user_can_write_branch(v_user, v_branch)
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لإدارة مخزون هذا الفرع';
  END IF;

  INSERT INTO public.products(
    tenant_id, branch_id, name, sku, category_id,
    cost_price, selling_price, market_price,
    low_stock_alert, quantity, image,
    brand, model, color, product_type, capacity, size,
    initial_stock_date
  ) VALUES (
    v_tenant, v_branch,
    p_product->>'name',
    p_product->>'sku',
    NULLIF(p_product->>'category_id','')::uuid,
    v_cost,
    COALESCE((p_product->>'selling_price')::numeric, 0),
    COALESCE((p_product->>'market_price')::numeric, 0),
    COALESCE((p_product->>'low_stock_alert')::int, 5),
    v_qty,
    NULLIF(p_product->>'image',''),
    NULLIF(btrim(p_product->>'brand'),''),
    NULLIF(btrim(p_product->>'model'),''),
    NULLIF(btrim(p_product->>'color'),''),
    NULLIF(btrim(p_product->>'product_type'),''),
    NULLIF(btrim(p_product->>'capacity'),''),
    NULLIF(btrim(p_product->>'size'),''),
    v_effective_date
  ) RETURNING id INTO v_new_id;

  IF v_qty > 0 THEN
    INSERT INTO public.product_batches(
      tenant_id, branch_id, product_id,
      quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, true_unit_cost,
      batch_type, effective_at
    ) VALUES (
      v_tenant, v_branch, v_new_id,
      v_qty, v_qty,
      v_cost, v_cost, v_cost,
      'opening_stock', v_effective
    );

    v_value := ROUND(v_qty * v_cost, 2);
    IF v_value > 0 THEN
      SELECT id INTO v_inv FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='1300' LIMIT 1;
      SELECT id INTO v_eq FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='3800' LIMIT 1;
      IF v_inv IS NULL OR v_eq IS NULL THEN
        RAISE EXCEPTION 'تعذر إنشاء الرصيد الافتتاحي: يجب تهيئة حسابي المخزون 1300 ورأس المال 3800';
      END IF;

      v_num := 'OPS-' || to_char(v_effective_date,'YYYYMMDD') || '-' || substring(v_new_id::text,1,6);
      INSERT INTO public.journal_entries (
        tenant_id, entry_number, entry_date, description,
        source_type, source_id, status, total_debit, total_credit, created_by
      ) VALUES (
        v_tenant, v_num, v_effective_date,
        'رصيد مخزون افتتاحي — ' || COALESCE(p_product->>'name',''),
        'opening_stock', v_new_id, 'posted', v_value, v_value, v_user
      ) RETURNING id INTO v_entry;

      INSERT INTO public.journal_entry_lines (
        tenant_id, entry_id, account_id, debit, credit, description, line_order
      ) VALUES
        (v_tenant, v_entry, v_inv, v_value, 0, 'مخزون افتتاحي', 1),
        (v_tenant, v_entry, v_eq, 0, v_value, 'رأس مال / أرباح مرحلة', 2);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'product_id', v_new_id,
    'opening_batch', v_qty > 0,
    'cost_warning', v_qty > 0 AND v_cost <= 0,
    'initial_stock_date', v_effective_date
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_product_with_opening_stock(jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock(jsonb, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock(jsonb, timestamptz) TO service_role;