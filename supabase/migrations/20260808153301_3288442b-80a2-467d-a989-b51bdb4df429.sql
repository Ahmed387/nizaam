CREATE OR REPLACE FUNCTION public.post_voucher_journal(p_voucher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v RECORD;
  v_cat_code TEXT;
  v_lines JSONB;
  v_treasury_category TEXT;
  v_skip_categories TEXT[] := ARRAY[
    'sales','sales_extra_payment','payment_in','payment_edit_new','payment_edit_reversal',
    'payment_in_void','purchase_return','purchase_shipment_payment','supplier_payment',
    'partner_advance','partner_advance_repayment','partner_contribution','partner_withdrawal',
    'branch_transfer_out','branch_transfer_in','transfer','transfer_in','capital_allocation',
    'return','return_cancel','sale_return','sale_return_cancel',
    'purchase_return_refund','purchase_return_cancel','inventory_adjustment'
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
END
$fn$;