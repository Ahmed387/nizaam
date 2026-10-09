-- =============================================================================================
-- SEC-004 — No direct browser writes to money and document tables (approved 8 Oct 2026)
--
-- Before this migration the browser (PostgREST, any signed-in user of the company) could INSERT /
-- UPDATE / DELETE rows in invoices, invoice_items, payment plans, purchase returns, contacts and the
-- other money tables directly. Example: updating invoice_items.quantity moved stock through the
-- reverse_invoice_item trigger, and a purchase return header was saved with a client-computed total.
--
-- After it, these tables are read-only for anon/authenticated. Every write goes through a
-- SECURITY DEFINER RPC that starts with the same access checks as SEC-003 (company, suspension,
-- branch, permission) and computes amounts on the server.
--
--   0. Helpers                    assert_company_access(permission) for company-level records
--   1. Contacts                   save_contact, delete_contact
--   2. Sale pricing columns       finalize_sale_pricing (replaces invoice_items updates from NewSale)
--   3. Payment plans              create_payment_plan (replaces payment_plans / installments inserts)
--   4. Purchase invoice date      update_shipment_date + journal follows invoice_date (and repair)
--   5. Purchase returns           create_purchase_return (header + items in one transaction)
--   6. Approval requests          an approved sale-invoice "delete" goes through cancel_invoice_with_refund
--   7. Revoke direct writes       INSERT/UPDATE/DELETE/TRUNCATE on 22 tables
--   8. Allow-list + final check
-- =============================================================================================

-- =============================================================================================
-- 0. Company-level access check (records with no branch, e.g. suppliers)
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.assert_company_access(p_permission text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'تعذر تحديد الشركة الحالية للمستخدم' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin(v_uid) THEN
    IF public.current_tenant_is_suspended() THEN
      RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية' USING ERRCODE = '42501';
    END IF;
    IF p_permission IS NOT NULL AND NOT public.effective_permission(v_uid, p_permission) THEN
      RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «%»', p_permission USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN v_tenant;
END
$fn$;
REVOKE ALL ON FUNCTION public.assert_company_access(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_company_access(text) TO service_role;

-- =============================================================================================
-- 1. Contacts
--    Create: anyone with customers.create / suppliers.create (by type), branch must be theirs.
--    Promote to "both": same create permission. Any other edit or delete: admin / owner only
--    (branch managers keep sending approval requests, which the definer trigger applies).
--    Balances are never written here (credit_balance / opening_balance have their own guards).
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.save_contact(p_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_admin boolean;
  v_keys text[];
  v_type text;
  v_branch uuid;
  v_name text;
  c public.contacts%ROWTYPE;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  v_admin := public.is_admin(v_uid) OR public.is_super_admin(v_uid);
  p_data := COALESCE(p_data, '{}'::jsonb);

  SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_keys FROM jsonb_object_keys(p_data) AS k;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) k
              WHERE k NOT IN ('name', 'type', 'contact_person', 'phone', 'email', 'address', 'notes', 'branch_id')) THEN
    RAISE EXCEPTION 'حقل غير مسموح في بيانات جهة التعامل' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    -- create
    v_type := COALESCE(NULLIF(btrim(p_data->>'type'), ''), 'both');   -- same as the column default
    IF v_type NOT IN ('customer', 'supplier', 'both') THEN
      RAISE EXCEPTION 'نوع جهة التعامل غير صالح' USING ERRCODE = '22023';
    END IF;
    IF NOT v_admin AND NOT (
         (v_type IN ('customer', 'both') AND public.effective_permission(v_uid, 'customers.create'))
      OR (v_type IN ('supplier', 'both') AND public.effective_permission(v_uid, 'suppliers.create'))) THEN
      RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية إضافة %', CASE WHEN v_type = 'supplier' THEN 'الموردين' ELSE 'العملاء' END
        USING ERRCODE = '42501';
    END IF;
    v_name := btrim(COALESCE(p_data->>'name', ''));
    IF v_name = '' THEN RAISE EXCEPTION 'الاسم مطلوب' USING ERRCODE = '22023'; END IF;
    v_branch := NULLIF(p_data->>'branch_id', '')::uuid;
    IF v_branch IS NOT NULL THEN
      PERFORM public.assert_access(v_branch, NULL);
    END IF;

    INSERT INTO public.contacts (tenant_id, type, name, contact_person, phone, email, address, notes, branch_id)
    VALUES (v_tenant, v_type, v_name,
            NULLIF(btrim(p_data->>'contact_person'), ''),
            NULLIF(btrim(p_data->>'phone'), ''),
            NULLIF(lower(btrim(p_data->>'email')), ''),
            NULLIF(btrim(p_data->>'address'), ''),
            NULLIF(btrim(p_data->>'notes'), ''),
            v_branch)
    RETURNING * INTO c;
    RETURN to_jsonb(c);
  END IF;

  -- update
  SELECT * INTO c FROM public.contacts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'جهة التعامل غير موجودة' USING ERRCODE = 'P0002'; END IF;
  IF c.tenant_id IS DISTINCT FROM v_tenant AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'غير مصرح: جهة التعامل تخص شركة أخرى' USING ERRCODE = '42501';
  END IF;
  IF 'branch_id' = ANY (v_keys) THEN
    RAISE EXCEPTION 'لا يمكن نقل جهة التعامل لفرع آخر من هنا' USING ERRCODE = '22023';
  END IF;

  IF v_keys = ARRAY['type'] AND p_data->>'type' = 'both' THEN
    -- "also a customer / also a supplier"
    IF NOT v_admin AND NOT (public.effective_permission(v_uid, 'customers.create')
                            OR public.effective_permission(v_uid, 'suppliers.create')) THEN
      RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
    END IF;
    UPDATE public.contacts SET type = 'both' WHERE id = p_id RETURNING * INTO c;
    RETURN to_jsonb(c);
  END IF;

  IF NOT v_admin THEN
    RAISE EXCEPTION 'تعديل بيانات جهة التعامل للإدارة فقط — مدير الفرع يرسل طلب موافقة' USING ERRCODE = '42501';
  END IF;
  IF p_data ? 'type' AND (p_data->>'type') NOT IN ('customer', 'supplier', 'both') THEN
    RAISE EXCEPTION 'نوع جهة التعامل غير صالح' USING ERRCODE = '22023';
  END IF;
  IF p_data ? 'name' AND btrim(COALESCE(p_data->>'name', '')) = '' THEN
    RAISE EXCEPTION 'الاسم مطلوب' USING ERRCODE = '22023';
  END IF;

  UPDATE public.contacts SET
    name           = CASE WHEN p_data ? 'name'           THEN btrim(p_data->>'name') ELSE name END,
    type           = CASE WHEN p_data ? 'type'           THEN p_data->>'type' ELSE type END,
    contact_person = CASE WHEN p_data ? 'contact_person' THEN NULLIF(btrim(p_data->>'contact_person'), '') ELSE contact_person END,
    phone          = CASE WHEN p_data ? 'phone'          THEN NULLIF(btrim(p_data->>'phone'), '') ELSE phone END,
    email          = CASE WHEN p_data ? 'email'          THEN NULLIF(lower(btrim(p_data->>'email')), '') ELSE email END,
    address        = CASE WHEN p_data ? 'address'        THEN NULLIF(btrim(p_data->>'address'), '') ELSE address END,
    notes          = CASE WHEN p_data ? 'notes'          THEN NULLIF(btrim(p_data->>'notes'), '') ELSE notes END
  WHERE id = p_id
  RETURNING * INTO c;
  RETURN to_jsonb(c);
END
$fn$;

-- A contact with no history can be removed (a typo card); one with documents or payments cannot
-- (trg_protect_contact_delete) — archive it instead.
CREATE OR REPLACE FUNCTION public.delete_contact(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_ct uuid;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'حذف جهة التعامل للإدارة فقط — مدير الفرع يرسل طلب موافقة' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO v_ct FROM public.contacts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'جهة التعامل غير موجودة' USING ERRCODE = 'P0002'; END IF;
  IF v_ct IS DISTINCT FROM v_tenant AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'غير مصرح: جهة التعامل تخص شركة أخرى' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.contacts WHERE id = p_id;
END
$fn$;

-- =============================================================================================
-- 2. Profit / pricing columns of a sale, computed on the server from the stored lines
--    (NewSale used to UPDATE invoice_items from the browser after process_sale_full).
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.finalize_sale_pricing(p_invoice_id uuid, p_discount_request_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_n int := 0;
  r record;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_access(v_inv.branch_id, 'sales.create');
  IF v_inv.status <> 'active' THEN RAISE EXCEPTION 'الفاتورة غير نشطة'; END IF;

  UPDATE public.invoice_items ii
     SET original_price   = x.orig,
         final_price      = x.final_unit,
         discount_percent = CASE WHEN x.orig > 0 THEN round((x.orig - x.final_unit) / x.orig * 100, 2) ELSE 0 END
    FROM (
      SELECT i.id,
             GREATEST(COALESCE(i.market_price, 0), COALESCE(i.selling_price, 0)) AS orig,
             GREATEST(0, i.quantity * COALESCE(i.selling_price, 0) - COALESCE(i.line_discount, 0))
               / GREATEST(1, i.quantity) AS final_unit
        FROM public.invoice_items i
       WHERE i.invoice_id = p_invoice_id AND i.product_id IS NOT NULL
    ) x
   WHERE ii.id = x.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Approved discount requests of this sale: link them and copy the approval onto the lines.
  FOR r IN
    SELECT d.* FROM public.discount_approval_requests d
     WHERE d.id = ANY (COALESCE(p_discount_request_ids, '{}'::uuid[]))
       AND d.tenant_id = v_inv.tenant_id
       AND d.branch_id = v_inv.branch_id
       AND (d.invoice_id IS NULL OR d.invoice_id = p_invoice_id)
  LOOP
    UPDATE public.discount_approval_requests SET invoice_id = p_invoice_id WHERE id = r.id;
    IF r.status = 'approved' AND r.product_id IS NOT NULL THEN
      UPDATE public.invoice_items
         SET discount_approved_by = r.decided_by,
             discount_approval_note = r.admin_note,
             final_price = r.requested_price
       WHERE invoice_id = p_invoice_id AND product_id = r.product_id;
    END IF;
  END LOOP;

  RETURN v_n;
END
$fn$;

-- =============================================================================================
-- 3. Payment plans (credit sale remainder, supplier schedule) — header, amounts and party come
--    from the document, never from the browser.
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.create_payment_plan(
  p_reference_type text,
  p_reference_id uuid,
  p_total numeric,
  p_plan_type text DEFAULT 'open',
  p_fee_on_customer boolean DEFAULT false,
  p_installments jsonb DEFAULT '[]'::jsonb,
  p_existing_plan_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_branch uuid; v_contact uuid; v_doc_total numeric; v_status text; v_tenant uuid;
  v_entity_type text; v_name text;
  v_plan public.payment_plans%ROWTYPE;
  v_sum numeric := 0; v_next int; it jsonb;
BEGIN
  IF p_reference_type = 'invoice' THEN
    SELECT branch_id, contact_id, total, status, tenant_id INTO v_branch, v_contact, v_doc_total, v_status, v_tenant
      FROM public.invoices WHERE id = p_reference_id;
    v_entity_type := 'customer';
    IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_access(v_branch, 'sales.create');
  ELSIF p_reference_type = 'shipment' THEN
    SELECT branch_id, contact_id, total_cost, status, tenant_id INTO v_branch, v_contact, v_doc_total, v_status, v_tenant
      FROM public.shipments WHERE id = p_reference_id;
    v_entity_type := 'supplier';
    IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_access(v_branch, 'shipments.create');
  ELSE
    RAISE EXCEPTION 'نوع المستند غير مدعوم لخطة الدفع' USING ERRCODE = '22023';
  END IF;

  IF v_status <> 'active' THEN RAISE EXCEPTION 'المستند غير نشط — لا يمكن إنشاء خطة دفع'; END IF;
  IF v_contact IS NULL THEN RAISE EXCEPTION 'خطة الدفع تحتاج عميل/مورد مسجل'; END IF;
  IF COALESCE(p_plan_type, 'open') NOT IN ('open', 'scheduled') THEN
    RAISE EXCEPTION 'نوع خطة الدفع غير صالح' USING ERRCODE = '22023';
  END IF;

  IF p_existing_plan_id IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.payment_plans WHERE id = p_existing_plan_id FOR UPDATE;
    IF NOT FOUND OR v_plan.reference_type IS DISTINCT FROM p_reference_type OR v_plan.reference_id IS DISTINCT FROM p_reference_id THEN
      RAISE EXCEPTION 'خطة الدفع لا تخص هذا المستند' USING ERRCODE = '42501';
    END IF;
    IF v_plan.status = 'cancelled' THEN RAISE EXCEPTION 'خطة الدفع ملغاة'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.payment_plans
                WHERE reference_type = p_reference_type AND reference_id = p_reference_id AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'المستند عليه خطة دفع بالفعل';
    END IF;
    IF COALESCE(p_total, 0) <= 0 OR p_total > v_doc_total + 0.01 THEN
      RAISE EXCEPTION 'مبلغ خطة الدفع لازم يكون أكبر من صفر ومش أكبر من إجمالي المستند (%)', v_doc_total USING ERRCODE = '22023';
    END IF;
    SELECT name INTO v_name FROM public.contacts WHERE id = v_contact;
    INSERT INTO public.payment_plans (tenant_id, branch_id, entity_type, entity_id, entity_name,
      total_amount, paid_amount, remaining_amount, plan_type, reference_type, reference_id,
      fee_on_customer, status, created_by)
    VALUES (v_tenant, v_branch, v_entity_type, v_contact,
      COALESCE(v_name, CASE WHEN v_entity_type = 'customer' THEN 'عميل' ELSE 'مورد' END),
      round(p_total, 2), 0, round(p_total, 2), COALESCE(p_plan_type, 'open'), p_reference_type, p_reference_id,
      COALESCE(p_fee_on_customer, false) AND v_entity_type = 'customer', 'active', v_uid)
    RETURNING * INTO v_plan;
  END IF;

  IF COALESCE(p_plan_type, 'open') = 'scheduled' AND jsonb_typeof(p_installments) = 'array'
     AND jsonb_array_length(p_installments) > 0 THEN
    FOR it IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
      IF NULLIF(it->>'due_date', '') IS NULL OR COALESCE((it->>'amount')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'كل قسط محتاج تاريخ استحقاق ومبلغ أكبر من صفر' USING ERRCODE = '22023';
      END IF;
      v_sum := v_sum + (it->>'amount')::numeric;
    END LOOP;
    IF v_sum > v_plan.total_amount + 0.01 THEN
      RAISE EXCEPTION 'مجموع الأقساط (%) أكبر من قيمة الخطة (%)', round(v_sum, 2), round(v_plan.total_amount, 2) USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(MAX(installment_number), 0) INTO v_next FROM public.payment_installments WHERE payment_plan_id = v_plan.id;
    INSERT INTO public.payment_installments (tenant_id, payment_plan_id, installment_number, due_date, amount, status)
    SELECT v_plan.tenant_id, v_plan.id, v_next + e.ord, (e.v->>'due_date')::date, round((e.v->>'amount')::numeric, 2), 'pending'
      FROM jsonb_array_elements(p_installments) WITH ORDINALITY AS e(v, ord);
    UPDATE public.payment_plans SET plan_type = 'scheduled' WHERE id = v_plan.id AND plan_type <> 'scheduled';
  END IF;

  RETURN v_plan.id;
END
$fn$;

-- =============================================================================================
-- 4. Purchase invoice date — one central path; the journal entry always follows invoice_date.
--    Root cause fixed here: the save stored invoice_date after posting, and the journal trigger
--    re-synced only on a total change, so a backdated purchase was posted on the save day.
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.trg_shipment_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF COALESCE(current_setting('app.skip_journal', true), '') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT'
     OR NEW.total_cost   IS DISTINCT FROM OLD.total_cost
     OR NEW.vat_amount   IS DISTINCT FROM OLD.vat_amount
     OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date THEN
    PERFORM public.sync_shipment_journal(NEW.id);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.update_shipment_date(p_shipment_id uuid, p_new_date timestamptz, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  s public.shipments%ROWTYPE;
  v_uname text;
  v_entry_date date;
BEGIN
  IF p_new_date IS NULL THEN RAISE EXCEPTION 'تاريخ الفاتورة الجديد مطلوب' USING ERRCODE = '22004'; END IF;
  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_access(s.branch_id, 'shipments.update');
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'تعديل تاريخ الفاتورة متاح لمالك الشركة أو المدير العام فقط' USING ERRCODE = '42501';
  END IF;
  IF s.status = 'cancelled' THEN RAISE EXCEPTION 'فاتورة الشراء ملغاة — لا يمكن تعديلها'; END IF;
  IF (p_new_date AT TIME ZONE 'Africa/Cairo')::date > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'مينفعش تاريخ الفاتورة يكون في المستقبل';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fiscal_periods fp
              WHERE fp.tenant_id = s.tenant_id AND fp.status = 'closed'
                AND (s.invoice_date::date BETWEEN fp.period_start AND fp.period_end
                     OR p_new_date::date BETWEEN fp.period_start AND fp.period_end)) THEN
    RAISE EXCEPTION 'لا يمكن نقل فاتورة من أو إلى فترة مالية مقفلة' USING ERRCODE = '23514';
  END IF;
  IF p_new_date IS NOT DISTINCT FROM s.invoice_date THEN
    RETURN jsonb_build_object('shipment_id', s.id, 'invoice_date', s.invoice_date, 'changed', false);
  END IF;

  UPDATE public.shipments SET invoice_date = p_new_date WHERE id = s.id;   -- journal re-posted by trigger

  SELECT entry_date INTO v_entry_date FROM public.journal_entries
   WHERE source_type = 'shipment' AND source_id = s.id ORDER BY created_at DESC LIMIT 1;
  SELECT name INTO v_uname FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (v_uid, COALESCE(v_uname, '?'), s.tenant_id, s.branch_id, 'invoice_date_changed', 'shipments', s.id::text,
          jsonb_build_object('shipment_number', s.shipment_number, 'old_invoice_date', s.invoice_date,
                             'new_invoice_date', p_new_date, 'journal_entry_date', v_entry_date,
                             'reason', NULLIF(btrim(p_reason), '')));
  RETURN jsonb_build_object('shipment_id', s.id, 'invoice_date', p_new_date, 'journal_entry_date', v_entry_date, 'changed', true);
END
$fn$;

-- Repair: active purchase invoices whose entry sits on another day than invoice_date
-- (skipped when either day is in a closed fiscal period).
DO $repair$
DECLARE r record; n int := 0; skipped int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.tenant_id, s.invoice_date::date AS doc_day, je.entry_date
      FROM public.shipments s
      JOIN public.journal_entries je ON je.source_type = 'shipment' AND je.source_id = s.id
     WHERE s.status = 'active' AND je.entry_date <> s.invoice_date::date
  LOOP
    IF EXISTS (SELECT 1 FROM public.fiscal_periods fp
                WHERE fp.tenant_id = r.tenant_id AND fp.status = 'closed'
                  AND (r.doc_day BETWEEN fp.period_start AND fp.period_end
                       OR r.entry_date BETWEEN fp.period_start AND fp.period_end)) THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    PERFORM public.sync_shipment_journal(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'SEC-004 repair: % purchase journal entries moved to their invoice date, % left (closed period)', n, skipped;
END
$repair$;

-- =============================================================================================
-- 5. Purchase return — header and lines saved together; quantities, unit cost and total from the
--    purchase invoice on the server; backdating admin-only (same rule as sales).
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.create_purchase_return(p_header jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  s public.shipments%ROWTYPE;
  v_total numeric := 0;
  v_cash numeric := GREATEST(COALESCE((p_header->>'refund_cash_amount')::numeric, 0), 0);
  v_transfer numeric := GREATEST(COALESCE((p_header->>'refund_transfer_amount')::numeric, 0), 0);
  v_balance numeric := GREATEST(COALESCE((p_header->>'refund_balance_amount')::numeric, 0), 0);
  v_day date := NULLIF(p_header->>'invoice_date', '')::date;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_date timestamptz;
  v_reason text := btrim(COALESCE(p_header->>'reason', ''));
  pr public.purchase_returns%ROWTYPE;
  bad record;
BEGIN
  SELECT * INTO s FROM public.shipments WHERE id = NULLIF(p_header->>'shipment_id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'اختر فاتورة شراء' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_access(s.branch_id, 'shipments.create');
  IF s.status <> 'active' THEN RAISE EXCEPTION 'فاتورة الشراء ملغاة — لا يمكن عمل مرتجع عليها'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'اكتب السبب' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'اختر منتج واحد على الأقل لإرجاعه' USING ERRCODE = '22023';
  END IF;

  IF v_day IS NULL OR v_day = v_today THEN
    v_date := now();
  ELSE
    IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
      RAISE EXCEPTION 'تسجيل مرتجع بتاريخ سابق متاح للإدارة فقط' USING ERRCODE = '42501';
    END IF;
    v_date := (v_day + time '12:00') AT TIME ZONE 'Africa/Cairo';
  END IF;

  -- Requested lines, resolved against the purchase invoice lines.
  CREATE TEMP TABLE IF NOT EXISTS _pr_lines (item_id uuid, product_id uuid, product_name text, qty int, unit_cost numeric) ON COMMIT DROP;
  TRUNCATE _pr_lines;
  INSERT INTO _pr_lines
  SELECT si.id, si.product_id, si.product_name, (e->>'quantity')::int, si.cost_price
    FROM jsonb_array_elements(p_items) e
    LEFT JOIN public.shipment_items si
      ON si.id = NULLIF(e->>'shipment_item_id', '')::uuid AND si.shipment_id = s.id
   WHERE COALESCE((e->>'quantity')::int, 0) > 0;

  IF NOT EXISTS (SELECT 1 FROM _pr_lines) THEN
    RAISE EXCEPTION 'اختر منتج واحد على الأقل لإرجاعه' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM _pr_lines WHERE item_id IS NULL OR product_id IS NULL) THEN
    RAISE EXCEPTION 'بند غير موجود في فاتورة الشراء دي' USING ERRCODE = '22023';
  END IF;

  -- Per product: requested ≤ received on this invoice − already returned (active returns).
  SELECT x.product_name, x.req, x.avail INTO bad
    FROM (
      SELECT l.product_id, min(l.product_name) AS product_name, sum(l.qty) AS req,
             (SELECT COALESCE(sum(si.quantity), 0) FROM public.shipment_items si
               WHERE si.shipment_id = s.id AND si.product_id = l.product_id)
           - (SELECT COALESCE(sum(pri.quantity), 0) FROM public.purchase_return_items pri
                JOIN public.purchase_returns p ON p.id = pri.purchase_return_id
               WHERE p.shipment_id = s.id AND p.status = 'active' AND pri.product_id = l.product_id) AS avail
        FROM _pr_lines l GROUP BY l.product_id
    ) x
   WHERE x.req > x.avail
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'الكمية أكبر من المتاح للمنتج % (متاح: %)', bad.product_name, GREATEST(bad.avail, 0) USING ERRCODE = '22023';
  END IF;

  SELECT round(sum(qty * unit_cost), 2) INTO v_total FROM _pr_lines;
  IF abs((v_cash + v_transfer + v_balance) - v_total) > 0.01 THEN
    RAISE EXCEPTION 'مجموع توزيع الرد (%) لازم يساوي إجمالي المرتجع (%)', v_cash + v_transfer + v_balance, v_total USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.purchase_returns (branch_id, contact_id, shipment_id, reason, notes, recipient_name, created_by,
    total_amount, status, refund_method, refund_reference, refund_account,
    refund_cash_amount, refund_transfer_amount, refund_balance_amount, invoice_date)
  VALUES (s.branch_id, s.contact_id, s.id, v_reason, NULLIF(btrim(p_header->>'notes'), ''),
    NULLIF(btrim(p_header->>'recipient_name'), ''), v_uid,
    v_total, 'active', NULLIF(p_header->>'refund_method', ''), NULLIF(btrim(p_header->>'refund_reference'), ''),
    NULLIF(btrim(p_header->>'refund_account'), ''), v_cash, v_transfer, v_balance, v_date)
  RETURNING * INTO pr;

  INSERT INTO public.purchase_return_items (purchase_return_id, product_id, product_name, quantity, unit_cost, total)
  SELECT pr.id, product_id, product_name, qty, unit_cost, round(qty * unit_cost, 2) FROM _pr_lines;

  SELECT * INTO pr FROM public.purchase_returns WHERE id = pr.id;   -- triggers may rewrite the refund split
  RETURN jsonb_build_object('id', pr.id, 'return_number', pr.return_number, 'total_amount', pr.total_amount,
    'refund_cash_amount', pr.refund_cash_amount, 'refund_transfer_amount', pr.refund_transfer_amount,
    'refund_balance_amount', pr.refund_balance_amount);
END
$fn$;

-- =============================================================================================
-- 6. Approval requests: an approved "delete" of a sale invoice no longer flips the status alone.
--    No money paid → cancel_invoice_with_refund (plan, installments, stock, journal as the dialog).
--    Money paid → refused: the refund method must be chosen in the cancel dialog.
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.process_approval_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text;
  v_body text;
  v_link text;
  v_paid numeric;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'approved' THEN
    NEW.decided_at = now();
    IF NEW.action = 'delete' THEN
      IF NEW.entity_type = 'contact' THEN
        DELETE FROM public.contacts WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      ELSIF NEW.entity_type = 'invoice' THEN
        SELECT COALESCE((SELECT SUM(pi.paid_amount) FROM public.payment_installments pi
                           JOIN public.payment_plans pp ON pp.id = pi.payment_plan_id
                          WHERE pp.reference_type = 'invoice' AND pp.reference_id = NEW.entity_id), 0)
             + COALESCE((SELECT SUM(ip.amount) FROM public.invoice_payments ip
                          WHERE ip.invoice_id = NEW.entity_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL), 0)
          INTO v_paid;
        IF v_paid > 0 THEN
          RAISE EXCEPTION 'الفاتورة عليها مدفوعات (%) — الإلغاء يتم من زر «إلغاء الفاتورة» عشان تختار طريقة رد المبلغ، أو ارفض الطلب', v_paid;
        END IF;
        PERFORM public.cancel_invoice_with_refund(NEW.entity_id, COALESCE(NEW.admin_note, NEW.reason, 'إلغاء بموافقة الإدارة'), 'none');
      ELSIF NEW.entity_type = 'shipment' THEN
        -- No hard delete (owner rule): an approved request cancels the purchase invoice with full reversal.
        PERFORM public.cancel_purchase_invoice(NEW.entity_id, COALESCE(NEW.admin_note, NEW.reason, 'إلغاء بموافقة الإدارة'));
      END IF;
    ELSIF NEW.action = 'update' AND NEW.payload IS NOT NULL THEN
      IF NEW.entity_type = 'contact' THEN
        UPDATE public.contacts SET
          name = COALESCE(NEW.payload->>'name', name),
          phone = COALESCE(NEW.payload->>'phone', phone),
          address = COALESCE(NEW.payload->>'address', address),
          contact_person = COALESCE(NEW.payload->>'contact_person', contact_person),
          notes = COALESCE(NEW.payload->>'notes', notes)
        WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      END IF;
    END IF;

    v_title = 'تمت الموافقة على طلبك';
    v_body  = 'تمت الموافقة على طلب ' || (CASE WHEN NEW.action='delete' THEN 'إلغاء' ELSE 'تعديل' END) || ' ' || NEW.entity_label;
  ELSIF NEW.status = 'rejected' THEN
    NEW.decided_at = now();
    v_title = 'تم رفض طلبك';
    v_body  = 'تم رفض طلب ' || (CASE WHEN NEW.action='delete' THEN 'إلغاء' ELSE 'تعديل' END) || ' ' || NEW.entity_label
              || COALESCE(' — ' || NEW.admin_note, '');
  END IF;

  v_link = CASE
    WHEN NEW.branch_id IS NOT NULL THEN '/branch/' || NEW.branch_id || '/approval-requests'
    ELSE '/admin/approval-requests'
  END;

  INSERT INTO public.notifications(tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
  VALUES (NEW.tenant_id, NEW.requested_by, v_title, v_body, 'general', v_link, 'approval_request', NEW.id);

  RETURN NEW;
END $$;

-- =============================================================================================
-- 7. Direct writes from the browser are revoked. Reads (and Realtime) are unchanged; RPCs and
--    triggers run as the function owner and are not affected.
-- =============================================================================================
DO $revoke$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invoices', 'invoice_items', 'invoice_payments',
    'shipments', 'shipment_items', 'product_batches',
    'payment_plans', 'payment_installments', 'payment_transactions', 'supplier_payments',
    'customer_credit_log', 'returns', 'return_items', 'purchase_returns', 'purchase_return_items',
    'vouchers', 'treasury', 'journal_entries', 'journal_entry_lines', 'stock_movements',
    'contacts', 'partner_transactions'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'SEC-004: table % not found — skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END
$revoke$;

-- =============================================================================================
-- 8. New browser RPCs: grant by name + allow-list; final exposure check
-- =============================================================================================
REVOKE ALL ON FUNCTION public.save_contact(uuid, jsonb)                                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_contact(uuid)                                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_sale_pricing(uuid, uuid[])                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_payment_plan(text, uuid, numeric, text, boolean, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_shipment_date(uuid, timestamptz, text)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_purchase_return(jsonb, jsonb)                              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_contact(uuid, jsonb)                                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_contact(uuid)                                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_sale_pricing(uuid, uuid[])                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_payment_plan(text, uuid, numeric, text, boolean, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_shipment_date(uuid, timestamptz, text)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(jsonb, jsonb)                              TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_shipment_journal() FROM PUBLIC, anon, authenticated;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('save_contact',           '0052', 'contact create/edit; company + permission; edits admin-only'),
  ('delete_contact',         '0052', 'admin-only; blocked when the contact has history'),
  ('finalize_sale_pricing',  '0052', 'sale profit columns computed on the server; assert_access sales.create'),
  ('create_payment_plan',    '0052', 'plan from the document; assert_access sales.create / shipments.create'),
  ('update_shipment_date',   '0052', 'admin-only; journal follows invoice_date; audit row'),
  ('create_purchase_return', '0052', 'header + lines atomically; server quantities and cost; assert_access shipments.create')
ON CONFLICT (function_name) DO NOTHING;

DO $check$
DECLARE v_list text; v_tables text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'SEC-004: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
  SELECT string_agg(c.relname, ', ') INTO v_tables
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     AND c.relname IN ('invoices', 'invoice_items', 'invoice_payments', 'shipments', 'shipment_items', 'product_batches',
                       'payment_plans', 'payment_installments', 'payment_transactions', 'supplier_payments',
                       'customer_credit_log', 'returns', 'return_items', 'purchase_returns', 'purchase_return_items',
                       'vouchers', 'treasury', 'journal_entries', 'journal_entry_lines', 'stock_movements',
                       'contacts', 'partner_transactions')
     AND (has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
          OR has_table_privilege('authenticated', c.oid, 'DELETE'));
  IF v_tables IS NOT NULL THEN
    RAISE EXCEPTION 'SEC-004: authenticated can still write: %', v_tables;
  END IF;
END
$check$;