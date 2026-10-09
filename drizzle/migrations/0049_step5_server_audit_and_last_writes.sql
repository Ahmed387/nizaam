-- =============================================================================================
-- Step 5 — server-enforced audit log, last browser writes, no netting, idempotent sales,
--          server-side transfer fees (approved 8 Oct 2026)
--
--   1. Audit log      log_audit_event(): user, name and company come from the session; the browser
--                     can no longer INSERT into audit_log (it could send user_id NULL + any name).
--   2. Products       update_product_details / bulk_update_products / delete_products /
--                     apply_low_stock_default; update_product_price_with_reason gets the access guard
--                     it never had (any signed-in user could change any company's prices) and cost
--                     changes become admin-only. Direct writes on products revoked.
--   3. Stock counts   create_stock_adjustment(): system quantity read at save, header + lines together.
--   4. Personal       personal ledger: save / cancel RPCs, cancel instead of delete.
--   5. No netting     doc_ledger_allocation: customer and supplier sides never pay each other.
--   6. H-01           process_sale_once(): one client request id = one invoice (offline replay safe).
--   7. H-08           transfer fees computed on the server from transfer_fees.
--   8. Revokes, allow-list, final checks.
-- =============================================================================================

-- Helper (this transaction only): inject one statement right after the first BEGIN of a plpgsql
-- function, idempotent through its marker. Same technique as 0051 (bodies merged by 0036 live
-- only in the database).
CREATE OR REPLACE FUNCTION pg_temp.inject_top(p_name text, p_marker text, p_stmt text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE r record; d text; s int; b int; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, l.lanname FROM pg_proc p
      JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name
  LOOP
    n := n + 1;
    IF r.lanname <> 'plpgsql' THEN RAISE EXCEPTION 'Step 5: % is %, expected plpgsql', p_name, r.lanname; END IF;
    d := pg_get_functiondef(r.oid);
    IF position(p_marker IN d) > 0 THEN CONTINUE; END IF;
    s := position('$function$' IN d);
    IF s = 0 THEN RAISE EXCEPTION 'Step 5: unexpected definition format for %', p_name; END IF;
    b := regexp_instr(substr(d, s), '\mBEGIN\M', 1, 1, 0, 'i');
    IF b = 0 THEN RAISE EXCEPTION 'Step 5: no BEGIN in %', p_name; END IF;
    b := s - 1 + b + 4;
    d := left(d, b) || E'\n  -- ' || p_marker || E'\n  ' || p_stmt || E'\n' || substr(d, b + 1);
    EXECUTE d;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Step 5: function % not found', p_name; END IF;
END
$fn$;

-- =============================================================================================
-- 1. Audit log written by the server only
-- =============================================================================================
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'server';
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_source_check') THEN
    ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_source_check CHECK (source IN ('server', 'client'));
  END IF;
END $c$;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text, p_entity text, p_entity_id text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_name text;
  v_id uuid;
  v_details jsonb := COALESCE(p_details, '{}'::jsonb);
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF p_action NOT IN ('CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'EXPORT', 'PRINT') THEN
    RAISE EXCEPTION 'نوع عملية غير صالح في سجل العمليات' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_entity), '') = '' OR length(p_entity) > 64 OR length(COALESCE(p_entity_id, '')) > 128 THEN
    RAISE EXCEPTION 'بيانات سجل العمليات غير صالحة' USING ERRCODE = '22023';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'الفرع غير موجود في شركتك' USING ERRCODE = '42501';
  END IF;
  IF octet_length(v_details::text) > 8192 THEN
    v_details := jsonb_build_object('truncated', true, 'size', octet_length(v_details::text));
  END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details, source)
  VALUES (v_uid, COALESCE(NULLIF(v_name, ''), 'مستخدم'), v_tenant, p_branch_id, p_action, btrim(p_entity),
          NULLIF(p_entity_id, ''), v_details, 'client')
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;

-- =============================================================================================
-- 2. Products
-- =============================================================================================
-- 2a. The existing price RPC had no access check at all. Now: product's branch + inventory.update;
--     cost changes admin-only; reason still required (price_audit_log keeps it).
CREATE OR REPLACE FUNCTION public.update_product_price_with_reason(
  _product_id uuid, _selling_price numeric DEFAULT NULL::numeric, _cost_price numeric DEFAULT NULL::numeric,
  _market_price numeric DEFAULT NULL::numeric, _reason text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  p public.products%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_access(p.branch_id, 'inventory.update');
  IF _reason IS NULL OR length(trim(_reason)) < 10 THEN
    RAISE EXCEPTION 'يجب إدخال سبب التعديل (10 أحرف على الأقل)';
  END IF;
  IF _cost_price IS NOT NULL AND _cost_price IS DISTINCT FROM p.cost_price
     AND NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'تعديل سعر التكلفة للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(_selling_price, 0) < 0 OR COALESCE(_cost_price, 0) < 0 OR COALESCE(_market_price, 0) < 0 THEN
    RAISE EXCEPTION 'الأسعار لا يمكن أن تكون سالبة' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.price_change_reason', trim(_reason), true);
  PERFORM set_config('app.price_change_source', 'manual', true);

  UPDATE public.products
     SET selling_price = COALESCE(_selling_price, selling_price),
         cost_price    = COALESCE(_cost_price, cost_price),
         market_price  = COALESCE(_market_price, market_price)
   WHERE id = _product_id;
END
$fn$;

-- 2b. Non-price fields (name, code, category, image, variant attributes, alert levels)
CREATE OR REPLACE FUNCTION public.update_product_details(p_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  p public.products%ROWTYPE;
  v_keys text[];
BEGIN
  SELECT * INTO p FROM public.products WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_access(p.branch_id, 'inventory.update');
  p_patch := COALESCE(p_patch, '{}'::jsonb);
  SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_keys FROM jsonb_object_keys(p_patch) AS k;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE k NOT IN
       ('name', 'sku', 'category_id', 'image', 'color', 'product_type', 'capacity', 'size', 'brand', 'model',
        'low_stock_alert', 'min_stock_level')) THEN
    RAISE EXCEPTION 'حقل غير مسموح — الأسعار من «تعديل السعر» والكمية من الجرد' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'name' AND btrim(COALESCE(p_patch->>'name', '')) = '' THEN
    RAISE EXCEPTION 'اسم المنتج مطلوب' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'category_id' AND NULLIF(p_patch->>'category_id', '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.categories c WHERE c.id = (p_patch->>'category_id')::uuid AND c.tenant_id = p.tenant_id) THEN
    RAISE EXCEPTION 'التصنيف غير موجود في شركتك' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products SET
    name            = CASE WHEN p_patch ? 'name'            THEN btrim(p_patch->>'name') ELSE name END,
    sku             = CASE WHEN p_patch ? 'sku'             THEN btrim(p_patch->>'sku') ELSE sku END,
    category_id     = CASE WHEN p_patch ? 'category_id'     THEN NULLIF(p_patch->>'category_id', '')::uuid ELSE category_id END,
    image           = CASE WHEN p_patch ? 'image'           THEN NULLIF(p_patch->>'image', '') ELSE image END,
    color           = CASE WHEN p_patch ? 'color'           THEN NULLIF(btrim(p_patch->>'color'), '') ELSE color END,
    product_type    = CASE WHEN p_patch ? 'product_type'    THEN NULLIF(btrim(p_patch->>'product_type'), '') ELSE product_type END,
    capacity        = CASE WHEN p_patch ? 'capacity'        THEN NULLIF(btrim(p_patch->>'capacity'), '') ELSE capacity END,
    size            = CASE WHEN p_patch ? 'size'            THEN NULLIF(btrim(p_patch->>'size'), '') ELSE size END,
    brand           = CASE WHEN p_patch ? 'brand'           THEN NULLIF(btrim(p_patch->>'brand'), '') ELSE brand END,
    model           = CASE WHEN p_patch ? 'model'           THEN NULLIF(btrim(p_patch->>'model'), '') ELSE model END,
    low_stock_alert = CASE WHEN p_patch ? 'low_stock_alert' THEN GREATEST(COALESCE((p_patch->>'low_stock_alert')::int, 0), 0) ELSE low_stock_alert END,
    min_stock_level = CASE WHEN p_patch ? 'min_stock_level' THEN GREATEST(COALESCE((p_patch->>'min_stock_level')::int, 0), 0) ELSE min_stock_level END
  WHERE id = p_id;
END
$fn$;

-- 2c. Bulk edit (admin screen "كل المخزون"): category / alert / prices with one reason.
CREATE OR REPLACE FUNCTION public.bulk_update_products(p_ids uuid[], p_patch jsonb, p_reason text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_keys text[];
  v_n int;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'التعديل الجماعي للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  p_patch := COALESCE(p_patch, '{}'::jsonb);
  SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_keys FROM jsonb_object_keys(p_patch) AS k;
  IF cardinality(v_keys) = 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE k NOT IN
       ('category_id', 'low_stock_alert', 'cost_price', 'selling_price', 'market_price')) THEN
    RAISE EXCEPTION 'حقل غير مسموح في التعديل الجماعي' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE id = ANY (p_ids) AND tenant_id IS DISTINCT FROM v_tenant)
     AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'منتجات من شركة أخرى ضمن التحديد' USING ERRCODE = '42501';
  END IF;
  IF (p_patch ?| ARRAY['cost_price', 'selling_price', 'market_price']) THEN
    IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
      RAISE EXCEPTION 'يجب إدخال سبب تعديل السعر (10 أحرف على الأقل)';
    END IF;
    IF COALESCE((p_patch->>'cost_price')::numeric, 0) < 0 OR COALESCE((p_patch->>'selling_price')::numeric, 0) < 0
       OR COALESCE((p_patch->>'market_price')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'الأسعار لا يمكن أن تكون سالبة' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('app.price_change_reason', trim(p_reason), true);
    PERFORM set_config('app.price_change_source', 'manual', true);
  END IF;
  IF p_patch ? 'category_id' AND NULLIF(p_patch->>'category_id', '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.categories c WHERE c.id = (p_patch->>'category_id')::uuid AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'التصنيف غير موجود في شركتك' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products SET
    category_id     = CASE WHEN p_patch ? 'category_id'     THEN NULLIF(p_patch->>'category_id', '')::uuid ELSE category_id END,
    low_stock_alert = CASE WHEN p_patch ? 'low_stock_alert' THEN GREATEST(COALESCE((p_patch->>'low_stock_alert')::int, 0), 0) ELSE low_stock_alert END,
    cost_price      = CASE WHEN p_patch ? 'cost_price'      THEN (p_patch->>'cost_price')::numeric ELSE cost_price END,
    selling_price   = CASE WHEN p_patch ? 'selling_price'   THEN (p_patch->>'selling_price')::numeric ELSE selling_price END,
    market_price    = CASE WHEN p_patch ? 'market_price'    THEN (p_patch->>'market_price')::numeric ELSE market_price END
  WHERE id = ANY (p_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- 2d. Delete products with no history (history is still blocked by trg_block_product_delete_with_history).
CREATE OR REPLACE FUNCTION public.delete_products(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid; v_n int;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'حذف المنتجات للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE id = ANY (p_ids) AND tenant_id IS DISTINCT FROM v_tenant)
     AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'منتجات من شركة أخرى ضمن التحديد' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.products WHERE id = ANY (p_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- 2e. Settings → default low-stock alert applied to every product of the company.
CREATE OR REPLACE FUNCTION public.apply_low_stock_default(p_value integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid; v_n int;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  UPDATE public.products SET low_stock_alert = GREATEST(COALESCE(p_value, 0), 0) WHERE tenant_id = v_tenant;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- =============================================================================================
-- 3. Stock adjustment (manual count): one transaction, system quantity read at save.
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.create_stock_adjustment(p_branch_id uuid, p_reason text, p_notes text, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_adj uuid;
  v_number text;
  r record;
  v_n int := 0;
BEGIN
  PERFORM public.assert_access(p_branch_id, 'inventory.update');
  v_admin := public.is_admin(v_uid) OR public.is_super_admin(v_uid);
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الجرد' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف منتج واحد على الأقل' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e
              WHERE NULLIF(e->>'product_id', '') IS NULL
                 OR COALESCE((e->>'actual_quantity')::numeric, -1) < 0
                 OR (e->>'actual_quantity')::numeric <> trunc((e->>'actual_quantity')::numeric)) THEN
    RAISE EXCEPTION 'كل سطر محتاج منتج وكمية فعلية صحيحة (صفر أو أكثر)' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_lines)) <> (SELECT count(DISTINCT e->>'product_id') FROM jsonb_array_elements(p_lines) e) THEN
    RAISE EXCEPTION 'المنتج متكرر في الجرد' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e
               LEFT JOIN public.products p ON p.id = (e->>'product_id')::uuid
              WHERE p.id IS NULL OR p.branch_id IS DISTINCT FROM p_branch_id) THEN
    RAISE EXCEPTION 'منتج غير موجود في هذا الفرع' USING ERRCODE = '22023';
  END IF;

  -- Lock in id order (no deadlocks), then read the quantities that the adjustment corrects.
  PERFORM 1 FROM public.products
   WHERE id IN (SELECT (e->>'product_id')::uuid FROM jsonb_array_elements(p_lines) e)
   ORDER BY id FOR UPDATE;

  v_number := 'ADJ-' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  INSERT INTO public.stock_adjustments (branch_id, adjustment_number, reason, notes, created_by)
  VALUES (p_branch_id, v_number, btrim(p_reason), NULLIF(btrim(p_notes), ''), v_uid)
  RETURNING id INTO v_adj;

  FOR r IN
    SELECT p.id, p.name, p.quantity AS sys_qty, (e->>'actual_quantity')::int AS act_qty,
           COALESCE(CASE WHEN v_admin THEN NULLIF((e->>'unit_cost')::numeric, 0) END, p.cost_price, 0) AS unit_cost
      FROM jsonb_array_elements(p_lines) e
      JOIN public.products p ON p.id = (e->>'product_id')::uuid
  LOOP
    INSERT INTO public.stock_adjustment_items (adjustment_id, product_id, product_name,
      system_quantity, actual_quantity, difference, unit_cost)
    VALUES (v_adj, r.id, r.name, COALESCE(r.sys_qty, 0), r.act_qty, r.act_qty - COALESCE(r.sys_qty, 0), r.unit_cost);
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('id', v_adj, 'adjustment_number', v_number, 'lines', v_n);
END
$fn$;

-- =============================================================================================
-- 4. Personal ledger: save and cancel only
-- =============================================================================================
ALTER TABLE public.owner_personal_expenses
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.owner_personal_deposits
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_personal_expenses_status_check') THEN
    ALTER TABLE public.owner_personal_expenses ADD CONSTRAINT owner_personal_expenses_status_check CHECK (status IN ('active', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_personal_deposits_status_check') THEN
    ALTER TABLE public.owner_personal_deposits ADD CONSTRAINT owner_personal_deposits_status_check CHECK (status IN ('active', 'cancelled'));
  END IF;
END $c$;

CREATE OR REPLACE FUNCTION public.save_personal_entry(p_kind text, p_id uuid, p_data jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid := public.personal_ledger_owner_id();
  v_amount numeric := (p_data->>'amount')::numeric;
  v_at timestamptz := NULLIF(p_data->>'at', '')::timestamptz;
  v_id uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501'; END IF;
  IF v_owner IS NULL OR public.personal_access_level(v_owner) <> 'edit' THEN
    RAISE EXCEPTION 'غير مصرح بالتعديل في الدفتر الشخصي' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('expense', 'deposit') THEN RAISE EXCEPTION 'نوع غير صالح' USING ERRCODE = '22023'; END IF;
  IF COALESCE(v_amount, 0) <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر' USING ERRCODE = '22023'; END IF;
  IF v_at IS NULL THEN RAISE EXCEPTION 'التاريخ والوقت مطلوبين' USING ERRCODE = '22023'; END IF;

  IF p_kind = 'expense' THEN
    IF btrim(COALESCE(p_data->>'description', '')) = '' THEN RAISE EXCEPTION 'الوصف مطلوب' USING ERRCODE = '22023'; END IF;
    IF p_id IS NULL THEN
      INSERT INTO public.owner_personal_expenses (owner_user_id, amount, description, category, expense_datetime, notes, created_by)
      VALUES (v_owner, round(v_amount, 2), btrim(p_data->>'description'), NULLIF(btrim(p_data->>'category'), ''), v_at,
              NULLIF(btrim(p_data->>'notes'), ''), v_uid)
      RETURNING id INTO v_id;
    ELSE
      SELECT status INTO v_status FROM public.owner_personal_expenses WHERE id = p_id AND owner_user_id = v_owner FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'السطر غير موجود' USING ERRCODE = 'P0002'; END IF;
      IF v_status = 'cancelled' THEN RAISE EXCEPTION 'السطر ملغي — لا يمكن تعديله'; END IF;
      UPDATE public.owner_personal_expenses
         SET amount = round(v_amount, 2), description = btrim(p_data->>'description'),
             category = NULLIF(btrim(p_data->>'category'), ''), expense_datetime = v_at,
             notes = NULLIF(btrim(p_data->>'notes'), ''), updated_at = now()
       WHERE id = p_id
      RETURNING id INTO v_id;
    END IF;
  ELSE
    IF p_id IS NULL THEN
      INSERT INTO public.owner_personal_deposits (owner_user_id, amount, description, category, deposit_datetime, notes, created_by)
      VALUES (v_owner, round(v_amount, 2), COALESCE(NULLIF(btrim(p_data->>'description'), ''), 'إيداع'),
              NULLIF(btrim(p_data->>'category'), ''), v_at, NULLIF(btrim(p_data->>'notes'), ''), v_uid)
      RETURNING id INTO v_id;
    ELSE
      SELECT status INTO v_status FROM public.owner_personal_deposits WHERE id = p_id AND owner_user_id = v_owner FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'السطر غير موجود' USING ERRCODE = 'P0002'; END IF;
      IF v_status = 'cancelled' THEN RAISE EXCEPTION 'السطر ملغي — لا يمكن تعديله'; END IF;
      UPDATE public.owner_personal_deposits
         SET amount = round(v_amount, 2), description = COALESCE(NULLIF(btrim(p_data->>'description'), ''), 'إيداع'),
             category = NULLIF(btrim(p_data->>'category'), ''), deposit_datetime = v_at,
             notes = NULLIF(btrim(p_data->>'notes'), ''), updated_at = now()
       WHERE id = p_id
      RETURNING id INTO v_id;
    END IF;
  END IF;
  RETURN v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_personal_entry(p_kind text, p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid := public.personal_ledger_owner_id();
  v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501'; END IF;
  IF v_owner IS NULL OR public.personal_access_level(v_owner) <> 'edit' THEN
    RAISE EXCEPTION 'غير مصرح بالتعديل في الدفتر الشخصي' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء' USING ERRCODE = '22023'; END IF;
  IF p_kind = 'expense' THEN
    UPDATE public.owner_personal_expenses
       SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(p_reason), updated_at = now()
     WHERE id = p_id AND owner_user_id = v_owner AND status = 'active';
  ELSIF p_kind = 'deposit' THEN
    UPDATE public.owner_personal_deposits
       SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(p_reason), updated_at = now()
     WHERE id = p_id AND owner_user_id = v_owner AND status = 'active';
  ELSE
    RAISE EXCEPTION 'نوع غير صالح' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'السطر غير موجود أو ملغي بالفعل' USING ERRCODE = 'P0002'; END IF;
END
$fn$;

DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.owner_personal_expenses;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.owner_personal_expenses
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.owner_personal_deposits;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.owner_personal_deposits
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.stock_transfers;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- =============================================================================================
-- 5. No netting: doc_ledger_allocation keeps customer and supplier sides apart.
--    Before: a "both" contact's supplier balance joined the pool
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.doc_ledger_allocation(p_kind text, p_branch_id uuid, p_contact_ids uuid[], p_as_of date DEFAULT NULL::date, p_cash_only boolean DEFAULT false)
 RETURNS TABLE(doc_id uuid, contact_id uuid, doc_date date, amount numeric, paid numeric, remaining numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = p_branch_id AND b.tenant_id = public.current_tenant_id())
     OR NOT (public.user_in_branch(auth.uid(), p_branch_id) OR public.is_admin(auth.uid())
             OR public.has_role(auth.uid(), 'viewer'::app_role) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  -- FIFO matching of each contact's branch statement. p_cash_only = true (purchases): only real cash/bank
  -- outflows to the supplier (supplier_payments + active supplier-payment vouchers) — no returns.
  -- Step 5 (0053): no netting — each side is paid only by its own money (owner rule).
  WITH c AS (
    SELECT ct.id, ct.branch_id, ct.type, COALESCE(ct.opening_balance,0) AS ob
    FROM contacts ct WHERE ct.id = ANY(p_contact_ids) AND ct.tenant_id = public.current_tenant_id()
  ),
  debts AS (
    SELECT 's'::text AS side, NULL::uuid AS doc_id, c.id AS cid, '0001-01-01'::date AS dd, NULL::timestamptz AS ts,
           CASE WHEN c.type = 'supplier' THEN 0 ELSE GREATEST(c.ob,0) END AS amt
      FROM c WHERE c.branch_id = p_branch_id
    UNION ALL
    SELECT 'p', NULL::uuid, c.id, '0001-01-01'::date, NULL::timestamptz,
           CASE WHEN c.type = 'customer' THEN 0 ELSE GREATEST(-c.ob,0) END
      FROM c WHERE c.branch_id = p_branch_id
    UNION ALL
    SELECT 's', i.id, i.contact_id, (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date, i.created_at, i.total
      FROM invoices i JOIN c ON c.id=i.contact_id
     WHERE i.branch_id=p_branch_id AND i.status='active'
       AND (p_as_of IS NULL OR (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', s.id, s.contact_id, (COALESCE(s.invoice_date,s.created_at) AT TIME ZONE 'Africa/Cairo')::date, s.created_at, s.total_cost
      FROM shipments s JOIN c ON c.id=s.contact_id
     WHERE s.branch_id=p_branch_id AND s.status='active'
       AND (p_as_of IS NULL OR (COALESCE(s.invoice_date,s.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
  ),
  credits AS (
    -- opening advance of a customer-only / supplier-only contact pays that side's own documents
    SELECT 's'::text AS side, c.id AS cid, GREATEST(-c.ob,0) AS amt
      FROM c WHERE NOT p_cash_only AND c.branch_id = p_branch_id AND c.type = 'customer'
    UNION ALL
    SELECT 'p', c.id, GREATEST(c.ob,0)
      FROM c WHERE NOT p_cash_only AND c.branch_id = p_branch_id AND c.type = 'supplier'
    UNION ALL
    SELECT 's', i.contact_id, ip.amount
      FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id JOIN c ON c.id=i.contact_id
     WHERE NOT p_cash_only AND i.branch_id=p_branch_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
       AND (p_as_of IS NULL OR (ip.created_at AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 's', i.contact_id, GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0)
      FROM returns r JOIN invoices i ON i.id=r.invoice_id JOIN c ON c.id=i.contact_id
     WHERE NOT p_cash_only AND i.branch_id=p_branch_id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')
       AND (p_as_of IS NULL OR (COALESCE(r.invoice_date,r.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', sp.contact_id, sp.amount FROM supplier_payments sp JOIN c ON c.id=sp.contact_id
     WHERE sp.branch_id=p_branch_id
       AND (p_as_of IS NULL OR (COALESCE(sp.paid_at,sp.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', pr.contact_id, GREATEST(COALESCE(pr.total_amount,0)-COALESCE(pr.refund_cash_amount,0)-COALESCE(pr.refund_transfer_amount,0),0)
      FROM purchase_returns pr JOIN c ON c.id=pr.contact_id
     WHERE NOT p_cash_only AND pr.branch_id=p_branch_id AND pr.status='active'
       AND (p_as_of IS NULL OR (COALESCE(pr.invoice_date,pr.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT CASE WHEN v.type='receipt' THEN 's' ELSE 'p' END, v.party_id, v.amount
      FROM vouchers v JOIN c ON c.id=v.party_id
     WHERE v.branch_id=p_branch_id AND v.status='active' AND v.party_type IN ('customer','supplier')
       AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)
       AND (NOT p_cash_only OR (v.type='payment' AND EXISTS (
             SELECT 1 FROM voucher_categories vc WHERE vc.id=v.category_id AND vc.system_key='supplier_payment')))
  ),
  own AS (SELECT cid, SUM(amt) AS amt FROM credits WHERE side = CASE WHEN p_kind='sale' THEN 's' ELSE 'p' END GROUP BY cid),
  pool AS (
    SELECT c.id AS cid,
           COALESCE((SELECT amt FROM own WHERE own.cid=c.id),0) AS amt
      FROM c
  ),
  ordered AS (
    SELECT dt.*, COALESCE(SUM(dt.amt) OVER (PARTITION BY dt.cid ORDER BY dt.dd, dt.ts NULLS FIRST, dt.doc_id NULLS FIRST
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS before
      FROM debts dt
     WHERE dt.side = CASE WHEN p_kind='sale' THEN 's' ELSE 'p' END AND (dt.amt > 0 OR dt.doc_id IS NOT NULL)
  )
  SELECT o.doc_id, o.cid, o.dd, round(o.amt,2),
         round(LEAST(o.amt, GREATEST(0, COALESCE(p.amt,0) - o.before)),2),
         round(o.amt - LEAST(o.amt, GREATEST(0, COALESCE(p.amt,0) - o.before)),2)
    FROM ordered o LEFT JOIN pool p ON p.cid=o.cid;
END;
$function$;


-- =============================================================================================
-- 6. H-01 — idempotent sale: one client request id gives exactly one invoice.
--    The browser makes the id when the sale is created and keeps it in the offline queue, so a sale
--    that reached the server before the connection dropped is never saved twice on replay.
-- =============================================================================================
CREATE TABLE IF NOT EXISTS public.sale_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  invoice_id uuid REFERENCES public.invoices(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sale_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sale_requests TO service_role;

CREATE OR REPLACE FUNCTION public.process_sale_once(
  p_client_request_id uuid,
  p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_percent numeric,
  p_discount_reason text, p_total numeric, p_payment_method text, p_items jsonb, p_payments jsonb,
  p_vat_rate numeric, p_vat_amount numeric, p_invoice_date date,
  p_recipient text DEFAULT NULL, p_notes text DEFAULT NULL, p_credit_to_apply numeric DEFAULT 0,
  p_received_by_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_inv uuid;
  v_row public.sale_requests%ROWTYPE;
BEGIN
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'معرّف العملية مطلوب' USING ERRCODE = '22023'; END IF;
  IF v_uid IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501'; END IF;

  -- Waits for a concurrent attempt with the same id; after it commits, its invoice is returned.
  INSERT INTO public.sale_requests (id, tenant_id, branch_id, created_by)
  VALUES (p_client_request_id, v_tenant, p_branch_id, v_uid)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.sale_requests WHERE id = p_client_request_id;
    IF v_row.tenant_id IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'معرّف العملية مستخدم' USING ERRCODE = '42501';
    END IF;
    IF v_row.invoice_id IS NOT NULL THEN RETURN v_row.invoice_id; END IF;
    RAISE EXCEPTION 'العملية دي قيد التنفيذ — حاول تاني بعد لحظات';
  END IF;

  -- H-08: the fee of each payment line comes from the company's transfer_fees, not from the browser.
  IF jsonb_typeof(p_payments) = 'array' THEN
    SELECT COALESCE(jsonb_agg(e.v || jsonb_build_object('fee_amount',
             public.calculate_payment_fee(COALESCE(e.v->>'payment_method', 'cash'), COALESCE((e.v->>'amount')::numeric, 0)))
             ORDER BY e.ord), '[]'::jsonb)
      INTO p_payments
      FROM jsonb_array_elements(p_payments) WITH ORDINALITY AS e(v, ord);
  END IF;

  v_inv := public.process_sale_full(
    p_branch_id => p_branch_id, p_customer_id => p_customer_id, p_subtotal => p_subtotal,
    p_discount_amount => p_discount_amount, p_discount_percent => p_discount_percent,
    p_discount_reason => p_discount_reason, p_total => p_total, p_payment_method => p_payment_method,
    p_items => p_items, p_payments => p_payments, p_vat_rate => p_vat_rate, p_vat_amount => p_vat_amount,
    p_invoice_date => p_invoice_date, p_recipient => p_recipient, p_notes => p_notes,
    p_credit_to_apply => p_credit_to_apply, p_received_by_name => p_received_by_name);

  UPDATE public.sale_requests SET invoice_id = v_inv WHERE id = p_client_request_id;
  RETURN v_inv;
END
$fn$;

-- =============================================================================================
-- 7. H-08 — transfer fees computed on the server (same table and formula the screens use).
--    Edits keep the stored fee unless the amount or the method changed.
--    Not touched: transfer_treasury_atomic (internal transfer; the fee actually charged is entered).
-- =============================================================================================
SELECT pg_temp.inject_top('add_invoice_payment', 'Step 5 fee (migration 0053)',
  $s$p_fee_amount := public.calculate_payment_fee(p_payment_method, p_amount);$s$);
SELECT pg_temp.inject_top('record_contact_payment', 'Step 5 fee (migration 0053)',
  $s$p_fee_amount := public.calculate_payment_fee(p_payment_method, p_amount);$s$);
SELECT pg_temp.inject_top('record_payment_transaction', 'Step 5 fee (migration 0053)',
  $s$p_fee_amount := public.calculate_payment_fee(p_payment_method, p_amount);$s$);
SELECT pg_temp.inject_top('create_manual_voucher', 'Step 5 fee (migration 0053)',
  $s$p_fee_amount := public.calculate_payment_fee(p_payment_method, p_amount);$s$);
SELECT pg_temp.inject_top('disburse_employee_advance', 'Step 5 fee (migration 0053)',
  $s$p_fee_amount := public.calculate_payment_fee(p_payment_method, p_amount);$s$);
SELECT pg_temp.inject_top('edit_invoice_payment', 'Step 5 fee (migration 0053)',
  $s$p_fee_amount := COALESCE((SELECT x.fee_amount FROM public.invoice_payments x WHERE x.id = p_payment_id AND x.payment_method IS NOT DISTINCT FROM p_payment_method AND x.amount = p_amount), public.calculate_payment_fee(p_payment_method, p_amount));$s$);
SELECT pg_temp.inject_top('edit_payment_transaction', 'Step 5 fee (migration 0053)',
  $s$p_fee_amount := COALESCE((SELECT x.fee_amount FROM public.payment_transactions x WHERE x.id = p_tx_id AND x.payment_method IS NOT DISTINCT FROM p_payment_method AND x.amount = p_amount), public.calculate_payment_fee(p_payment_method, p_amount));$s$);
SELECT pg_temp.inject_top('edit_voucher', 'Step 5 fee (migration 0053)',
  $s$p_fee_amount := COALESCE((SELECT x.fee_amount FROM public.vouchers x WHERE x.id = p_voucher_id AND x.payment_method IS NOT DISTINCT FROM p_payment_method AND x.amount = p_amount), public.calculate_payment_fee(p_payment_method, p_amount));$s$);

-- =============================================================================================
-- 8. Revokes, grants, allow-list, final checks
-- =============================================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM PUBLIC, anon, authenticated;
DO $revoke$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'stock_adjustments', 'stock_adjustment_items',
                           'owner_personal_expenses', 'owner_personal_deposits', 'stock_transfers'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Step 5: table % not found — skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END
$revoke$;

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.log_audit_event(text, text, text, uuid, jsonb)',
    'public.update_product_price_with_reason(uuid, numeric, numeric, numeric, text)',
    'public.update_product_details(uuid, jsonb)',
    'public.bulk_update_products(uuid[], jsonb, text)',
    'public.delete_products(uuid[])',
    'public.apply_low_stock_default(integer)',
    'public.create_stock_adjustment(uuid, text, text, jsonb)',
    'public.save_personal_entry(text, uuid, jsonb)',
    'public.cancel_personal_entry(text, uuid, text)',
    'public.process_sale_once(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric, text, jsonb, jsonb, numeric, numeric, date, text, text, numeric, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$grants$;

-- Sales go through process_sale_once only (idempotency + server fees).
REVOKE ALL ON FUNCTION public.process_sale_full(uuid, uuid, numeric, numeric, numeric, text, numeric, text, jsonb, jsonb, numeric, numeric, date, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale_full(uuid, uuid, numeric, numeric, numeric, text, numeric, text, jsonb, jsonb, numeric, numeric, date, text, text, numeric, text) TO service_role;

DELETE FROM public.security_rpc_allowlist WHERE function_name = 'process_sale_full';
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('log_audit_event',          '0053', 'audit rows: user, name and company from the session'),
  ('update_product_price_with_reason', '0053', 'now guarded: branch + inventory.update; cost admin-only'),
  ('update_product_details',   '0053', 'non-price product fields; assert_access inventory.update'),
  ('bulk_update_products',     '0053', 'admin-only bulk edit; prices need a reason'),
  ('delete_products',          '0053', 'admin-only; products with history stay blocked'),
  ('apply_low_stock_default',  '0053', 'admin-only settings action'),
  ('create_stock_adjustment',  '0053', 'manual count; system quantity read at save; assert_access inventory.update'),
  ('save_personal_entry',      '0053', 'personal ledger; personal_access_level = edit'),
  ('cancel_personal_entry',    '0053', 'personal ledger cancel (no delete)'),
  ('process_sale_once',        '0053', 'idempotent sale wrapper; server-side fees; calls process_sale_full')
ON CONFLICT (function_name) DO NOTHING;

DO $check$
DECLARE v_list text; v_tables text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 5: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
  IF has_function_privilege('authenticated', 'public.process_sale_full(uuid, uuid, numeric, numeric, numeric, text, numeric, text, jsonb, jsonb, numeric, numeric, date, text, text, numeric, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Step 5: process_sale_full is still callable from the browser';
  END IF;
  SELECT string_agg(c.relname, ', ') INTO v_tables
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     AND c.relname IN ('audit_log', 'products', 'stock_adjustments', 'stock_adjustment_items',
                       'owner_personal_expenses', 'owner_personal_deposits', 'stock_transfers', 'sale_requests')
     AND (has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
          OR has_table_privilege('authenticated', c.oid, 'DELETE'));
  IF v_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Step 5: authenticated can still write: %', v_tables;
  END IF;
END
$check$;