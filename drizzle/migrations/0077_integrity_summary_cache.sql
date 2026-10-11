-- 0077 — Speed: the admin home page waited 6–9 s for system_integrity_summary on every open.
--
-- Why: the summary ran the whole system_integrity_audit TWICE per call (once for the totals, once for
-- the per-check counts), and the audit itself takes ~7 s on this data. It is a health badge, not a live
-- number: computing it once and keeping it for 30 minutes is enough.
--
-- * system_integrity_cache — one row per company (summary jsonb + checked_at). No client access.
-- * system_integrity_summary(p_tenant) — same signature and result; returns the cached summary when it
--   is younger than 30 minutes, otherwise runs the audit ONCE and stores it. Same guard as the audit.
-- * cron «integrity-cache» refreshes every company at :20 each hour, so the page almost never waits.
-- The full list (SystemHealth page) still calls system_integrity_audit live.

CREATE TABLE IF NOT EXISTS public.system_integrity_cache (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  summary jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_integrity_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_integrity_cache FROM anon, authenticated;

-- internal: run the audit once for one company and store the summary
CREATE OR REPLACE FUNCTION public.system_integrity_refresh(p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  WITH a AS MATERIALIZED (SELECT check_code, severity FROM public.system_integrity_audit(p_tenant))
  SELECT jsonb_build_object(
           'checked_at', now(),
           'errors', count(*) FILTER (WHERE severity = 'error'),
           'warnings', count(*) FILTER (WHERE severity = 'warning'),
           'info', count(*) FILTER (WHERE severity = 'info'),
           'by_check', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT check_code AS k, count(*) AS n FROM a GROUP BY 1) z), '{}'::jsonb))
    INTO v FROM a;
  INSERT INTO public.system_integrity_cache(tenant_id, summary, checked_at) VALUES (p_tenant, v, now())
  ON CONFLICT (tenant_id) DO UPDATE SET summary = excluded.summary, checked_at = excluded.checked_at;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.system_integrity_refresh(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.system_integrity_summary(p_tenant uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid; v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    v_t := p_tenant;
  ELSE
    v_t := public.assert_company_access(NULL);
    IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
      RAISE EXCEPTION 'فحص سلامة البيانات للإدارة فقط' USING ERRCODE = '42501';
    END IF;
    IF p_tenant IS NOT NULL AND public.is_super_admin(auth.uid()) THEN v_t := p_tenant; END IF;
  END IF;
  IF v_t IS NULL THEN RAISE EXCEPTION 'حدد الشركة'; END IF;

  SELECT summary INTO v FROM public.system_integrity_cache
   WHERE tenant_id = v_t AND checked_at > now() - interval '30 minutes';
  IF v IS NOT NULL THEN RETURN v; END IF;
  RETURN public.system_integrity_refresh(v_t);
END $$;

CREATE OR REPLACE FUNCTION public.system_integrity_refresh_all()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT id FROM public.tenants WHERE coalesce(is_suspended, false) = false LOOP
    BEGIN PERFORM public.system_integrity_refresh(t.id); n := n + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'integrity refresh % failed: %', t.id, sqlerrm; END;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.system_integrity_refresh_all() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('integrity-cache', '20 * * * *', 'SELECT public.system_integrity_refresh_all();');
