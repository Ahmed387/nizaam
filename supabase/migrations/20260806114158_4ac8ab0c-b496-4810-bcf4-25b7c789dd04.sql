-- New account for employee advances
INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, normal_balance, is_active)
SELECT DISTINCT t.tenant_id, '1450', 'Employee Advances', 'asset'::account_type, 'debit'::normal_balance, true
FROM public.chart_of_accounts t
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.tenant_id AND c.code = '1450'
);

-- Map voucher categories to correct GL accounts
UPDATE public.voucher_categories SET gl_account_code = m.code
FROM (VALUES
  ('receipt','إيرادات أخرى','4200'),
  ('receipt','تحصيل أقساط عملاء','1200'),
  ('receipt','تحويلات بين الفروع','1100'),
  ('receipt','مبيعات نقدية','4100'),
  ('payment','أخرى','5900'),
  ('payment','إيجارات','5300'),
  ('payment','تحويلات بين الفروع','1100'),
  ('payment','رواتب موظفين','5200'),
  ('payment','سلف موظفين','1450'),
  ('payment','صيانة','5500'),
  ('payment','عمولات تحويل','5500'),
  ('payment','كهرباء ومياه','5400'),
  ('payment','مدفوعات موردين','2100'),
  ('payment','مرتجعات للعملاء','4900'),
  ('payment','مصاريف شحن','5500')
) AS m(vtype, vname, code)
WHERE public.voucher_categories.name = m.vname
  AND public.voucher_categories.type::text = m.vtype
  AND public.voucher_categories.gl_account_code IS NULL;

-- Extract voucher journal posting into a reusable function
CREATE OR REPLACE FUNCTION public.post_voucher_journal(p_voucher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  v_cat_code TEXT;
  v_lines JSONB;
  v_treasury_category TEXT;
  v_skip_categories TEXT[] := ARRAY[
    'sales','sales_extra_payment','payment_in','payment_edit_new','payment_edit_reversal',
    'payment_in_void','purchase_return','purchase_shipment_payment','supplier_payment',
    'partner_advance','partner_advance_repayment','partner_contribution','partner_withdrawal',
    'branch_transfer_out','branch_transfer_in'
  ];
BEGIN
  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher_id;
  IF NOT FOUND OR v.status <> 'active' OR COALESCE(v.amount,0) <= 0 THEN RETURN; END IF;

  IF v.source = 'system' AND v.source_type = 'treasury' AND v.treasury_id IS NOT NULL THEN
    SELECT category INTO v_treasury_category FROM public.treasury WHERE id = v.treasury_id;
    IF v_treasury_category = ANY(v_skip_categories) THEN RETURN; END IF;
  END IF;

  SELECT gl_account_code INTO v_cat_code FROM public.voucher_categories WHERE id = v.category_id;

  IF v.type = 'receipt' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1100','debit',v.amount,'credit',0,'description','Receipt '||v.voucher_number),
      jsonb_build_object('account_code',COALESCE(v_cat_code,'4200'),'debit',0,'credit',v.amount,'description',COALESCE(v.description,'Receipt'))
    );
  ELSIF v.type = 'payment' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code',COALESCE(v_cat_code,'5500'),'debit',v.amount,'credit',0,'description',COALESCE(v.description,'Payment')),
      jsonb_build_object('account_code','1100','debit',0,'credit',v.amount,'description','Payment '||v.voucher_number)
    );
  ELSE
    RETURN;
  END IF;

  PERFORM public.post_journal(v.tenant_id, v.voucher_date, v.type::text||' voucher '||v.voucher_number,
    'voucher', v.id, v_lines);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_voucher_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    PERFORM public.post_voucher_journal(NEW.id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'voucher', NEW.id,
      'Voucher '||NEW.voucher_number||' cancelled');
  END IF;
  RETURN NEW;
END $function$;

-- Rebuild journals for active vouchers using the corrected account mapping
DO $$
DECLARE r RECORD; v_id uuid;
BEGIN
  FOR r IN SELECT id FROM public.vouchers WHERE status = 'active' LOOP
    FOR v_id IN SELECT id FROM public.journal_entries
                 WHERE source_type = 'voucher' AND source_id = r.id LOOP
      DELETE FROM public.journal_entry_lines WHERE entry_id = v_id;
      DELETE FROM public.journal_entries WHERE reversed_by = v_id;
      DELETE FROM public.journal_entries WHERE id = v_id;
    END LOOP;
    PERFORM public.post_voucher_journal(r.id);
  END LOOP;
END $$;