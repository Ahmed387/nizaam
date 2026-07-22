
-- ============================================================================
-- Journal Backfill + Missing Triggers for Shipments & Supplier Payments
-- ============================================================================

-- 1) Shipment journal trigger: Inventory Dr / Accounts Payable Cr
CREATE OR REPLACE FUNCTION public.trg_shipment_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND COALESCE(NEW.total_cost,0) > 0 THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1300','debit',NEW.total_cost,'credit',0,'description','Shipment '||NEW.shipment_number||' inventory received'),
      jsonb_build_object('account_code','2100','debit',0,'credit',NEW.total_cost,'description','Shipment '||NEW.shipment_number||' payable to supplier')
    );
    PERFORM public.post_journal(NEW.tenant_id, NEW.invoice_date, 'Shipment '||NEW.shipment_number,
      'shipment', NEW.id, v_lines);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_shipments_journal ON public.shipments;
CREATE TRIGGER trg_shipments_journal
  AFTER INSERT ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.trg_shipment_journal();

-- 2) Supplier payment journal trigger: AP Dr / Cash Cr
CREATE OR REPLACE FUNCTION public.trg_supplier_payment_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND COALESCE(NEW.amount,0) > 0 THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','2100','debit',NEW.amount,'credit',0,'description','Supplier payment'),
      jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount,'description','Cash paid to supplier')
    );
    PERFORM public.post_journal(NEW.tenant_id, NEW.paid_at::date, 'Supplier payment',
      'supplier_payment', NEW.id, v_lines);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_supplier_payments_journal ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payments_journal
  AFTER INSERT ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_supplier_payment_journal();

-- 3) Backfill RPC — owner only
CREATE OR REPLACE FUNCTION public.backfill_missing_journals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_tenant UUID;
  r RECORD;
  v_lines JSONB;
  v_cat_code TEXT;
  v_deleted_tests INT := 0;
  v_inv INT := 0;
  v_pay INT := 0;
  v_vou INT := 0;
  v_ship INT := 0;
  v_sup INT := 0;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL OR lower(v_email) <> 'an.ayoub98@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: owner only';
  END IF;

  -- (a) Remove TEST-JE-* entries (test scenarios only). Keep real partner entries.
  DELETE FROM public.journal_entry_lines
   WHERE entry_id IN (SELECT id FROM public.journal_entries WHERE entry_number LIKE 'TEST-JE-%');
  DELETE FROM public.journal_entries WHERE entry_number LIKE 'TEST-JE-%';
  GET DIAGNOSTICS v_deleted_tests = ROW_COUNT;

  -- (b) Invoices (active) missing journal
  FOR r IN
    SELECT i.* FROM public.invoices i
    WHERE i.status='active'
      AND NOT EXISTS (SELECT 1 FROM public.journal_entries je
                       WHERE je.source_type='invoice' AND je.source_id=i.id AND je.status='posted')
  LOOP
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1200','debit',r.total,'credit',0,'description','Invoice '||r.invoice_number),
      jsonb_build_object('account_code','4100','debit',0,'credit',(COALESCE(r.subtotal,0)-COALESCE(r.discount_amount,0)),'description','Sales revenue'),
      jsonb_build_object('account_code','2200','debit',0,'credit',COALESCE(r.vat_amount,0),'description','VAT payable')
    );
    IF public.post_journal(r.tenant_id, r.invoice_date, 'Sale Invoice '||r.invoice_number, 'invoice', r.id, v_lines) IS NOT NULL THEN
      v_inv := v_inv + 1;
    END IF;
  END LOOP;

  -- (c) Invoice payments missing journal
  FOR r IN
    SELECT ip.* FROM public.invoice_payments ip
    WHERE ip.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.journal_entries je
                       WHERE je.source_type='invoice_payment' AND je.source_id=ip.id AND je.status='posted')
  LOOP
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1100','debit',r.amount,'credit',0,'description','Payment received'),
      jsonb_build_object('account_code','1200','debit',0,'credit',r.amount,'description','AR settlement')
    );
    IF public.post_journal(r.tenant_id, COALESCE(r.paid_at::date, CURRENT_DATE), 'Invoice payment', 'invoice_payment', r.id, v_lines) IS NOT NULL THEN
      v_pay := v_pay + 1;
    END IF;
  END LOOP;

  -- (d) Vouchers (active) missing journal
  FOR r IN
    SELECT v.*, vc.gl_account_code AS cat_code FROM public.vouchers v
    LEFT JOIN public.voucher_categories vc ON vc.id = v.category_id
    WHERE v.status='active' AND v.amount > 0
      AND NOT EXISTS (SELECT 1 FROM public.journal_entries je
                       WHERE je.source_type='voucher' AND je.source_id=v.id AND je.status='posted')
  LOOP
    IF r.type = 'receipt' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1100','debit',r.amount,'credit',0,'description','Receipt '||r.voucher_number),
        jsonb_build_object('account_code',COALESCE(r.cat_code,'4200'),'debit',0,'credit',r.amount,'description',COALESCE(r.description,'Receipt'))
      );
    ELSIF r.type = 'payment' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code',COALESCE(r.cat_code,'5500'),'debit',r.amount,'credit',0,'description',COALESCE(r.description,'Payment')),
        jsonb_build_object('account_code','1100','debit',0,'credit',r.amount,'description','Payment '||r.voucher_number)
      );
    ELSE
      CONTINUE;
    END IF;
    IF public.post_journal(r.tenant_id, r.voucher_date, r.type::text||' voucher '||r.voucher_number, 'voucher', r.id, v_lines) IS NOT NULL THEN
      v_vou := v_vou + 1;
    END IF;
  END LOOP;

  -- (e) Shipments missing journal
  FOR r IN
    SELECT s.* FROM public.shipments s
    WHERE COALESCE(s.total_cost,0) > 0
      AND NOT EXISTS (SELECT 1 FROM public.journal_entries je
                       WHERE je.source_type='shipment' AND je.source_id=s.id AND je.status='posted')
  LOOP
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1300','debit',r.total_cost,'credit',0,'description','Shipment '||r.shipment_number||' inventory received'),
      jsonb_build_object('account_code','2100','debit',0,'credit',r.total_cost,'description','Shipment '||r.shipment_number||' payable to supplier')
    );
    IF public.post_journal(r.tenant_id, r.invoice_date, 'Shipment '||r.shipment_number, 'shipment', r.id, v_lines) IS NOT NULL THEN
      v_ship := v_ship + 1;
    END IF;
  END LOOP;

  -- (f) Supplier payments missing journal
  FOR r IN
    SELECT sp.* FROM public.supplier_payments sp
    WHERE COALESCE(sp.amount,0) > 0
      AND NOT EXISTS (SELECT 1 FROM public.journal_entries je
                       WHERE je.source_type='supplier_payment' AND je.source_id=sp.id AND je.status='posted')
  LOOP
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','2100','debit',r.amount,'credit',0,'description','Supplier payment'),
      jsonb_build_object('account_code','1100','debit',0,'credit',r.amount,'description','Cash paid to supplier')
    );
    IF public.post_journal(r.tenant_id, r.paid_at::date, 'Supplier payment', 'supplier_payment', r.id, v_lines) IS NOT NULL THEN
      v_sup := v_sup + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'deleted_test_entries', v_deleted_tests,
    'invoices_posted', v_inv,
    'invoice_payments_posted', v_pay,
    'vouchers_posted', v_vou,
    'shipments_posted', v_ship,
    'supplier_payments_posted', v_sup
  );
END $$;

REVOKE ALL ON FUNCTION public.backfill_missing_journals() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_missing_journals() TO authenticated;
