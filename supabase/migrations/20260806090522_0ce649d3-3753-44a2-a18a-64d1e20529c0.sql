CREATE OR REPLACE FUNCTION public.import_opening_debt(p_branch_id uuid, p_contact_id uuid, p_kind text, p_legacy_number text, p_date timestamp with time zone, p_total numeric, p_paid numeric, p_batch_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_id uuid; v_number text; v_out numeric; v_paid numeric; v_lines jsonb;
BEGIN
  PERFORM public.assert_can_import_opening_debt();
  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;
  IF p_contact_id IS NULL THEN RAISE EXCEPTION 'لازم تحدد العميل أو المورد'; END IF;
  IF COALESCE(p_total,0) <= 0 THEN RAISE EXCEPTION 'قيمة الفاتورة لازم تكون أكبر من صفر'; END IF;
  v_paid := ROUND(COALESCE(p_paid,0), 2);
  IF v_paid < 0 OR v_paid > ROUND(p_total,2) THEN
    RAISE EXCEPTION 'المبلغ المدفوع (%) لازم يكون بين صفر وإجمالي الفاتورة (%)', v_paid, p_total;
  END IF;
  v_out := ROUND(p_total,2) - v_paid;

  INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system, is_active)
  SELECT v_tenant,'3950','Opening Balance Equity','أرصدة افتتاحية','equity','credit',true,true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='3950');

  PERFORM set_config('app.skip_journal','1',true);

  IF p_kind = 'customer' THEN
    IF p_legacy_number IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.invoices WHERE branch_id=p_branch_id AND legacy_number=p_legacy_number
    ) THEN RAISE EXCEPTION 'الفاتورة رقم % اترحّلت قبل كده', p_legacy_number; END IF;

    INSERT INTO public.invoices(
      invoice_number, branch_id, contact_id, cashier_id, subtotal, total,
      payment_method, status, invoice_date, is_migrated, migration_source,
      legacy_number, migration_batch_id, notes, tenant_id)
    VALUES (
      public.next_invoice_number(), p_branch_id, p_contact_id, auth.uid(),
      ROUND(p_total,2), ROUND(p_total,2),
      CASE WHEN v_out <= 0 THEN 'cash' ELSE 'credit' END,
      'active', p_date, true, 'opening_debt',
      p_legacy_number, p_batch_id,
      COALESCE(p_notes,'دين قديم مرحّل — فاتورة تاريخية (مالهاش أثر على المخزون أو الخزنة)'), v_tenant)
    RETURNING id, invoice_number INTO v_id, v_number;

    IF v_paid > 0 THEN
      INSERT INTO public.invoice_payments(invoice_id, tenant_id, branch_id, payment_method, amount, received_by_name, reference_number, created_at)
      VALUES (v_id, v_tenant, p_branch_id, 'cash', v_paid, 'ترحيل ديون قديمة', 'OPENING_DEBT', p_date);
    END IF;

    IF v_out > 0 THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1200','debit',v_out,'credit',0,'description','رصيد افتتاحي عميل — '||v_number),
        jsonb_build_object('account_code','3950','debit',0,'credit',v_out,'description','أرصدة افتتاحية')
      );
      PERFORM public.post_journal(v_tenant, p_date::date, 'دين قديم مرحّل '||v_number, 'invoice', v_id, v_lines);
    END IF;

  ELSIF p_kind = 'supplier' THEN
    IF p_legacy_number IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.shipments WHERE branch_id=p_branch_id AND legacy_number=p_legacy_number
    ) THEN RAISE EXCEPTION 'فاتورة المورد رقم % اترحّلت قبل كده', p_legacy_number; END IF;

    INSERT INTO public.shipments(
      branch_id, contact_id, received_by, arrival_date, total_cost,
      invoice_date, notes, legacy_number, migration_batch_id,
      is_migrated, migration_source, tenant_id)
    VALUES (
      p_branch_id, p_contact_id, 'ترحيل ديون قديمة', p_date::date, ROUND(p_total,2),
      p_date,
      COALESCE(p_notes,'دين قديم مرحّل — فاتورة مورد تاريخية (مالهاش أثر على المخزون أو الخزنة)'),
      p_legacy_number, p_batch_id, true, 'opening_debt', v_tenant)
    RETURNING id, shipment_number INTO v_id, v_number;

    IF v_paid > 0 THEN
      INSERT INTO public.supplier_payments(tenant_id, contact_id, branch_id, amount, notes, paid_by, paid_at)
      VALUES (v_tenant, p_contact_id, p_branch_id, v_paid, 'OPENING_DEBT — مدفوع قبل التشغيل على النظام', auth.uid(), p_date);
    END IF;

    IF v_out > 0 THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','3950','debit',v_out,'credit',0,'description','أرصدة افتتاحية'),
        jsonb_build_object('account_code','2100','debit',0,'credit',v_out,'description','رصيد افتتاحي مورد — '||v_number)
      );
      PERFORM public.post_journal(v_tenant, p_date::date, 'دين قديم مرحّل '||v_number, 'shipment', v_id, v_lines);
    END IF;
  ELSE
    RAISE EXCEPTION 'نوع غير معروف: %', p_kind;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'outstanding', v_out, 'paid', v_paid);
END $function$;