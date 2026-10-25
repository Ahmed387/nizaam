-- 0116: the admin home never runs the integrity audit from the browser (2026-10-25, «النظام بيقطع»).
-- The cron «integrity-cache» refreshes every company at minute 20 of each hour, but the summary accepted a cache of
-- 30 minutes only: for half of every hour each admin home ran the full audit live (10–35 s) and hit the 8 s limit
-- (17 × «500» in one day) while loading the database for everyone. Now: the last cached result is returned whatever
-- its age (checked_at tells how old it is); the live audit runs only when a company has no cached result at all.
CREATE OR REPLACE FUNCTION public.system_integrity_summary(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT summary INTO v FROM public.system_integrity_cache WHERE tenant_id = v_t;
  IF v IS NOT NULL THEN RETURN v; END IF;
  RETURN public.system_integrity_refresh(v_t);
END $function$;
