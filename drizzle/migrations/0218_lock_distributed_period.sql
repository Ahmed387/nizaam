-- 0218 — after a profit distribution the system ASKS the owner «تقفل الفترة دي؟» (owner «ب) نفذ» 2026-11-14).
-- «تقفل» = a LOCK only: a `fiscal_periods` row with status 'closed' for exactly the distributed days, which the existing
-- guards read (`ledger_period_closed`, enforce_closed_period_*): nothing dated inside it can be added, edited or
-- cancelled any more. No closing journal entry is posted (unlike `close_fiscal_period`), so every report and the
-- income statement keep showing the period's real figures. Owner only. A day already inside a locked period is refused.
CREATE OR REPLACE FUNCTION public.lock_distributed_period(p_from date, p_to date, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v_id uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'قفل الفترة لصاحب الشركة بس' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'حدد الفترة صح'; END IF;
  IF p_to >= public.cairo_today() THEN RAISE EXCEPTION 'مينفعش تقفل فترة لسه ما خلصتش'; END IF;
  IF EXISTS (SELECT 1 FROM fiscal_periods fp WHERE fp.tenant_id = v_t AND fp.status = 'closed'
              AND fp.period_start <= p_to AND fp.period_end >= p_from) THEN
    RAISE EXCEPTION 'جزء من الفترة دي مقفول بالفعل';
  END IF;
  INSERT INTO fiscal_periods (tenant_id, name, period_start, period_end, status, closed_at, closed_by, notes)
  VALUES (v_t, 'توزيع أرباح ' || to_char(p_from, 'DD/MM/YYYY') || ' ← ' || to_char(p_to, 'DD/MM/YYYY'), p_from, p_to,
          'closed', now(), auth.uid(), COALESCE(NULLIF(btrim(p_reason), ''), 'اتقفلت بعد توزيع الأرباح'))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'from', p_from, 'to', p_to);
END
$function$;
REVOKE ALL ON FUNCTION public.lock_distributed_period(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_distributed_period(date, date, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('lock_distributed_period', '0218', 'owner locks the distributed days (no closing entry)')
ON CONFLICT DO NOTHING;
