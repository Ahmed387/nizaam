-- 0147: «متابعة» cards on the owner's home (owner «أي تعديل وافقنا عليه … حطله كارت عشان نتابعه … أوتوماتيك», 2026-10-30)
-- One read-only RPC, owner / admin only, the numbers of the things agreed in 0137–0146 that need an eye on them:
--   طلبات موافقة مستنية (0141 / 0142 / 0146) · تحويلات فلوس بين الفروع مستنية الاستلام (0140) · تحويلات بضاعة مستنية
--   إيرادات أخرى الشهر ده (0139: عمولة على العميل …) · فروقات الجرد الشهر ده (0135) · مبيعات لفروعنا الشهر ده (0144)
--   سلف الشركاء المفتوحة (0137) · حصص التشغيل / المرتبات من ربح الشهر اللي فات لسه متسجلتش (0137)
-- Example: 2 requests waiting, 1 money transfer of 15,000 not received yet, other income 1,250, count surplus 259,036.
CREATE OR REPLACE FUNCTION public.owner_followups()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v_today date := public.cairo_today();
  v_m0 date := date_trunc('month', public.cairo_today())::date; v_p0 date; v_p1 date; st jsonb;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501'; END IF;
  v_p0 := (v_m0 - interval '1 month')::date; v_p1 := (v_m0 - 1);
  st := public.profit_statement_core(v_t, v_m0, v_today, NULL)->'total';
  RETURN jsonb_build_object(
    'month_from', v_m0, 'month_to', v_today,
    'approvals_pending', (SELECT count(*) FROM public.approval_requests WHERE tenant_id = v_t AND status::text = 'pending'),
    'money_transfers_pending', (SELECT jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0))
                                  FROM public.treasury_transfers WHERE tenant_id = v_t AND acknowledged_at IS NULL AND rejected_at IS NULL),
    'stock_transfers_pending', (SELECT count(*) FROM public.stock_transfers WHERE tenant_id = v_t AND status::text = 'pending'),
    'other_income_month', round(coalesce((st->>'other_income')::numeric, 0), 2),
    'count_diff_month', round(coalesce((st->>'count_diff')::numeric, 0), 2),
    'internal_sales_month', (SELECT jsonb_build_object('count', count(*), 'amount', coalesce(round(sum(i.total - coalesce(i.vat_amount, 0)), 2), 0))
                               FROM public.invoices i JOIN public.contacts c ON c.id = i.contact_id
                              WHERE i.tenant_id = v_t AND i.status = 'active' AND c.internal_branch_id IS NOT NULL
                                AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_m0 AND v_today),
    'partner_advances', (SELECT jsonb_build_object('count', count(*), 'amount', coalesce(sum(remaining_amount), 0))
                           FROM public.partner_advances WHERE tenant_id = v_t AND status IN ('active', 'partially_paid') AND remaining_amount > 0),
    'period_shares_missing', CASE
        WHEN NOT EXISTS (SELECT 1 FROM public.equity_partners WHERE tenant_id = v_t AND is_active
                           AND (operating_share > 0 OR (salary_mode = 'percent' AND salary_percent > 0))) THEN NULL
        WHEN EXISTS (SELECT 1 FROM public.partner_transactions WHERE tenant_id = v_t AND NOT coalesce(is_void, false)
                       AND transaction_type IN ('operating_share', 'salary_share') AND period_from = v_p0 AND period_to = v_p1) THEN NULL
        ELSE jsonb_build_object('from', v_p0, 'to', v_p1) END
  );
END $function$;
REVOKE ALL ON FUNCTION public.owner_followups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_followups() TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('owner_followups', '0147', 'owner / admin: the «متابعة» cards on the home page (read only)')
ON CONFLICT DO NOTHING;
