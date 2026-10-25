-- 0121 — a viewer (and a partner, who always carries «viewer») reads these tables company-wide, read only
-- (owner «موافق» 2026-10-25). Before, they were scoped to my_branch_ids(), and a viewer / partner is linked to no
-- branch: the voucher money split (voucher_money_split) and ledger_document_balances (both invoker rights) came back
-- empty for him, as did stock movements and shortages (الحاج ناصر: 0 of 5,741 / 3,611 / 55,254 / 14 rows).
-- Writes are untouched (no INSERT / UPDATE / DELETE policy is added); a paused branch stays hidden
-- (branch_paused_read is RESTRICTIVE).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_movements', 'money_movements', 'payment_allocations', 'stock_shortages'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS viewer_read ON public.%I', t);
    EXECUTE format($p$CREATE POLICY viewer_read ON public.%I FOR SELECT TO authenticated
      USING (tenant_id = (SELECT public.current_tenant_id())
             AND (SELECT public.has_role((SELECT auth.uid()), 'viewer'::app_role)))$p$, t);
  END LOOP;
END $$;
