-- 0190: owner 2026-11-11 «سجل التعديلات audit_log عاوزك تعملي زرار لما ادوس عليه امسح ال Audit دي كلها حتى مساحتها من
-- الداتا بيز». `purge_audit_log(p_confirm)` — owner only, the caller types «مسح». The table is TRUNCATEd (the only way the
-- disk space goes back; 130 MB on 2026-11-11) and ONE row is written saying who purged, when and how many rows went.
-- TRUNCATE takes every tenant's rows, so it is refused while the table holds another tenant's log (one tenant today).
-- The log is the trail that shows who changed what: after a purge nothing before it can be traced — the button says so.
-- `price_audit_log` and the journal are not touched.
CREATE OR REPLACE FUNCTION public.purge_audit_log(p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_t uuid := public.current_tenant_id(); v_n bigint; v_size bigint;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'مسح سجل العمليات للمالك بس' USING ERRCODE = '42501'; END IF;
  IF btrim(coalesce(p_confirm, '')) <> 'مسح' THEN RAISE EXCEPTION 'اكتب كلمة «مسح» للتأكيد'; END IF;
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE tenant_id IS DISTINCT FROM v_t) THEN
    RAISE EXCEPTION 'السجل فيه بيانات شركة تانية — المسح الكامل مش متاح';
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_log;
  v_size := pg_total_relation_size('public.audit_log');
  TRUNCATE public.audit_log;
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), v_t, 'DELETE', 'audit_log', NULL,
          jsonb_build_object('purged_rows', v_n, 'freed_bytes', v_size, 'note', 'المالك مسح سجل العمليات كله'));
  RETURN jsonb_build_object('rows', v_n, 'freed', pg_size_pretty(v_size));
END
$fn$;
REVOKE ALL ON FUNCTION public.purge_audit_log(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_audit_log(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
