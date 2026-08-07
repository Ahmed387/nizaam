-- 1) partner treasury is real cash now: enforce balance there too
CREATE OR REPLACE FUNCTION public.check_treasury_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric;
  v_method_balance numeric;
  v_pm text := COALESCE(NULLIF(NEW.payment_method, ''), 'cash');
  v_label text;
BEGIN
  IF NEW.type = 'expense' THEN
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.treasury WHERE branch_id = NEW.branch_id;

    IF v_balance < NEW.amount THEN
      RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_method_balance
      FROM public.treasury
      WHERE branch_id = NEW.branch_id
        AND COALESCE(NULLIF(payment_method, ''), 'cash') = v_pm;

    IF v_method_balance < NEW.amount THEN
      v_label := CASE v_pm
        WHEN 'cash' THEN 'النقدي'
        WHEN 'instapay' THEN 'انستاباي'
        WHEN 'bank' THEN 'الحساب البنكي'
        WHEN 'bank_transfer' THEN 'التحويل البنكي'
        WHEN 'vodafone' THEN 'فودافون كاش'
        WHEN 'wallet' THEN 'المحفظة'
        ELSE v_pm
      END;
      RAISE EXCEPTION 'رصيد % مش كفاية — المتاح % جنيه والمطلوب % جنيه. اختار وسيلة دفع تانية أو حوّل رصيد للوسيلة دي الأول.',
        v_label, v_method_balance, NEW.amount
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- 2) internal money movements must never hit P&L
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
    'branch_transfer_out','branch_transfer_in','transfer','transfer_in','capital_allocation'
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

-- 3) partner advance sanity
CREATE OR REPLACE FUNCTION public.guard_partner_advance_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.amount,0) <= 0 THEN
    RAISE EXCEPTION 'مبلغ السلفة لازم يكون أكبر من صفر';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_partner_advance_amount ON public.partner_advances;
CREATE TRIGGER trg_guard_partner_advance_amount
BEFORE INSERT ON public.partner_advances
FOR EACH ROW EXECUTE FUNCTION public.guard_partner_advance_amount();