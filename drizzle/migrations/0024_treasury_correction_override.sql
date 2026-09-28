CREATE OR REPLACE FUNCTION public.check_treasury_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_balance numeric;
  v_method_balance numeric;
  v_pm text := COALESCE(NULLIF(NEW.payment_method, ''), 'cash');
  v_label text;
BEGIN
  -- Administrative override: only for audited reversal corrections, only when explicitly enabled in the session.
  IF NEW.category = 'تصحيح قيد عكسي'
     AND COALESCE(current_setting('app.treasury_correction_override', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.type = 'expense' THEN
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.treasury WHERE branch_id = NEW.branch_id;
    IF v_balance < NEW.amount THEN
      RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_method_balance FROM public.treasury
      WHERE branch_id = NEW.branch_id AND COALESCE(NULLIF(payment_method, ''), 'cash') = v_pm;
    IF v_method_balance < NEW.amount THEN
      v_label := CASE v_pm
        WHEN 'cash' THEN 'النقدي' WHEN 'instapay' THEN 'انستاباي' WHEN 'bank' THEN 'الحساب البنكي'
        WHEN 'bank_transfer' THEN 'التحويل البنكي' WHEN 'vodafone' THEN 'فودافون كاش' WHEN 'wallet' THEN 'المحفظة'
        ELSE v_pm END;
      RAISE EXCEPTION 'رصيد % مش كفاية — المتاح % جنيه والمطلوب % جنيه. اختار وسيلة دفع تانية أو حوّل رصيد للوسيلة دي الأول.',
        v_label, v_method_balance, NEW.amount USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;