-- 0242 — «تظهر في اختيارات الدفع» per vessel (owner 2026-11-16 «نخفيهم من اختيارات الدفع … لكل الاوعية»).
-- Off = not offered when choosing how money is paid; balances, old movements, vessel transfers and
-- «تسوية رصيد بدون فلوس» still use the vessel (is_enabled stays on).
ALTER TABLE public.transfer_fees ADD COLUMN IF NOT EXISTS show_in_payments boolean NOT NULL DEFAULT true;
UPDATE public.transfer_fees SET show_in_payments = false
 WHERE tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND payment_method IN ('paymob', 'safe', 'old_drawer', 'company_offers');
