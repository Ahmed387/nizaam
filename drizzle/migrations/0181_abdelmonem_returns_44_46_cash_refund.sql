-- 0181: owner 2026-11-10 «صلح المرتجعين 44 و46 ويبقوا كاش من الدرج زي سهل». عبدالمنعم's returns 44 (استاذ عبد الرحمن,
-- 3,000, 19/3, RY01802) and 46 (اللواء مصطفى جلال, 5,000, 15/4, RY01803) on 2025 invoices were recorded by 0173 «على حسابه»
-- (a deposit receipt under the customer, till unchanged) but in «سهل» the money left the cash drawer. The deposit receipts
-- RV-5929 / RV-5930 are cancelled (`cancel_voucher`) and the two rows become money_mode 'refund' (the till expense and its
-- entry Dr 1300 / 3800, Cr 1100 stay as they are). 65 (محمد عبدالكريم, RY01804) stays on account.
-- Dry-run: عبدالمنعم cash 30,630.90 → 22,630.90, nothing else moves.
DO $mig$
DECLARE v_owner uuid; r record;
BEGIN
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  IF v_owner IS NULL THEN RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  FOR r IN SELECT p.id, p.deposit_voucher_id, p.return_number FROM public.prior_year_returns p
            WHERE p.return_number IN ('RY01802', 'RY01803') AND p.money_mode = 'account' AND p.deposit_voucher_id IS NOT NULL LOOP
    PERFORM public.cancel_voucher(r.deposit_voucher_id, 'مرتجع ' || r.return_number || ': الفلوس اتصرفت كاش من الدرج في سهل (المالك 2026-11-10)');
    UPDATE public.prior_year_returns SET money_mode = 'refund', deposit_voucher_id = NULL WHERE id = r.id;
  END LOOP;
END
$mig$;
