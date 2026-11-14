-- 0217 — a sale return follows the cashier's answer (owner 2026-11-14): «العميل هياخد فلوسه (بأي طريقة دفع) ولا تنزل
-- من حسابه؟». The money part is capped by the return's value only (no longer by «what was paid on the invoice», which
-- needed the allocation engine); the rest goes to his account. A walk-in sale can only be paid back in money.
-- `register_sale_return_full` now keeps the split the screen sends (it used to insert 0 / 0 / 0 and let the trigger
-- decide); an edit (`edit_sale_return`, method only) is split by its method: «balance» → all on his account, else money.
CREATE OR REPLACE FUNCTION public.allocate_sale_return_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := round(COALESCE(NEW.total_refund, 0), 2);
  v_method text := COALESCE(NULLIF(NEW.refund_method, ''), 'cash');
  v_cash numeric := GREATEST(COALESCE(NEW.refund_cash_amount, 0), 0);
  v_tr numeric := GREATEST(COALESCE(NEW.refund_transfer_amount, 0), 0);
  v_bal numeric := GREATEST(COALESCE(NEW.refund_balance_amount, 0), 0);
  v_money numeric; v_contact uuid;
BEGIN
  -- 0156 import mode: the old program's own split and day
  IF public.sahl_import_mode() AND nullif(current_setting('app.sahl_split', true), '') IS NOT NULL THEN
    NEW.status := 'active';
    NEW.refund_balance_amount := round(coalesce((current_setting('app.sahl_split')::jsonb->>'balance')::numeric, 0), 2);
    NEW.refund_cash_amount := round(coalesce((current_setting('app.sahl_split')::jsonb->>'cash')::numeric, 0), 2);
    NEW.refund_transfer_amount := round(coalesce((current_setting('app.sahl_split')::jsonb->>'transfer')::numeric, 0), 2);
    NEW.refund_method := coalesce(nullif(current_setting('app.sahl_split')::jsonb->>'method', ''), NEW.refund_method);
    IF current_setting('app.sahl_split')::jsonb ? 'at' THEN
      NEW.invoice_date := (current_setting('app.sahl_split')::jsonb->>'at')::timestamptz;
    END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status, 'active') = 'draft' THEN NEW.status := 'active'; END IF;
  IF COALESCE(NEW.status, 'active') <> 'active' THEN RETURN NEW; END IF;
  NEW.status := 'active';

  SELECT i.contact_id INTO v_contact FROM public.invoices i WHERE i.id = NEW.invoice_id;
  IF v_method = 'mixed' THEN v_method := 'cash'; END IF;  -- the money part of «مختلط» goes out in cash unless a method came

  IF v_cash + v_tr + v_bal <= 0.005 THEN
    -- nothing split by the screen (an edit): by the method
    IF v_method = 'balance' THEN v_money := 0; ELSE v_money := v_total; END IF;
    IF v_method IN ('cash', 'balance', 'mixed') THEN v_cash := v_money; v_tr := 0; ELSE v_cash := 0; v_tr := v_money; END IF;
  ELSE
    v_money := LEAST(v_cash + v_tr, v_total);
    v_cash := LEAST(v_cash, v_money);
    v_tr := v_money - v_cash;
  END IF;
  IF v_contact IS NULL THEN
    -- a walk-in sale has no account to put it on
    v_money := v_total;
    IF v_cash + v_tr <= 0.005 THEN
      IF v_method IN ('cash', 'balance', 'mixed') THEN v_cash := v_total; v_tr := 0; ELSE v_cash := 0; v_tr := v_total; END IF;
    ELSE
      v_tr := v_total - LEAST(v_cash, v_total); v_cash := LEAST(v_cash, v_total);
    END IF;
  END IF;

  NEW.refund_cash_amount := round(v_cash, 2);
  NEW.refund_transfer_amount := round(v_tr, 2);
  NEW.refund_balance_amount := round(v_total - v_cash - v_tr, 2);
  IF v_cash + v_tr <= 0.005 THEN NEW.refund_method := 'balance';
  ELSE NEW.refund_method := CASE WHEN v_method = 'balance' THEN 'cash' ELSE v_method END;
  END IF;
  RETURN NEW;
END
$function$;

DO $mig$
DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.register_sale_return_full'::regproc); o := d;
  d := replace(d, $s$    COALESCE(NULLIF(_refund_method,''), 'cash'), NULLIF(_refund_reference, ''), NULLIF(_refund_account, ''),
    0, 0, 0,$s$, $s$    COALESCE(NULLIF(_refund_method,''), 'cash'), NULLIF(_refund_reference, ''), NULLIF(_refund_account, ''),
    COALESCE(_refund_cash_amount, 0), COALESCE(_refund_transfer_amount, 0), COALESCE(_refund_balance_amount, 0),$s$);
  IF d = o THEN RAISE EXCEPTION '0217: register insert not found'; END IF;
  EXECUTE d;
END
$mig$;
