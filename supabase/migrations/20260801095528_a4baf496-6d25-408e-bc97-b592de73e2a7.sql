-- ============ 1. Notification helper ============
CREATE OR REPLACE FUNCTION public.notify_tenant_admins(
  p_tenant_id uuid,
  p_title text,
  p_body text,
  p_type text DEFAULT 'alert',
  p_link text DEFAULT NULL,
  p_entity text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_roles app_role[] DEFAULT ARRAY['admin','owner','super_admin']::app_role[],
  p_dedupe_hours int DEFAULT 20
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_n int := 0;
BEGIN
  FOR v_uid IN
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
    WHERE ur.tenant_id = p_tenant_id AND ur.role = ANY(p_roles)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = v_uid AND n.title = p_title
        AND n.created_at > now() - (p_dedupe_hours || ' hours')::interval
    ) THEN
      INSERT INTO public.notifications (user_id, tenant_id, title, body, type, link, related_entity, related_entity_id)
      VALUES (v_uid, p_tenant_id, p_title, p_body, p_type, p_link, p_entity, p_entity_id);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- ============ 2. Anomaly detection ============
CREATE OR REPLACE FUNCTION public.detect_anomalies()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_sent int := 0;
BEGIN
  FOR r IN
    SELECT b.id AS branch_id, b.name AS branch_name, b.tenant_id,
      COALESCE((SELECT SUM(e.amount) FROM public.expenses e
        WHERE e.branch_id = b.id AND e.date >= CURRENT_DATE - 7),0) AS cur_exp,
      COALESCE((SELECT SUM(e.amount)/4.0 FROM public.expenses e
        WHERE e.branch_id = b.id AND e.date >= CURRENT_DATE - 35 AND e.date < CURRENT_DATE - 7),0) AS avg_exp,
      COALESCE((SELECT SUM(i.total) FROM public.invoices i
        WHERE i.branch_id = b.id AND i.status = 'active' AND i.invoice_date >= now() - interval '7 days'),0) AS cur_sales,
      COALESCE((SELECT SUM(i.total)/4.0 FROM public.invoices i
        WHERE i.branch_id = b.id AND i.status = 'active'
          AND i.invoice_date >= now() - interval '35 days' AND i.invoice_date < now() - interval '7 days'),0) AS avg_sales,
      COALESCE((SELECT SUM(i.discount_amount) FROM public.invoices i
        WHERE i.branch_id = b.id AND i.status = 'active' AND i.invoice_date >= now() - interval '7 days'),0) AS cur_disc,
      COALESCE((SELECT SUM(i.discount_amount)/4.0 FROM public.invoices i
        WHERE i.branch_id = b.id AND i.status = 'active'
          AND i.invoice_date >= now() - interval '35 days' AND i.invoice_date < now() - interval '7 days'),0) AS avg_disc,
      COALESCE((SELECT COUNT(*) FROM public.invoices i
        WHERE i.branch_id = b.id AND i.status = 'cancelled' AND i.cancelled_at >= now() - interval '7 days'),0) AS cur_void,
      COALESCE((SELECT COUNT(*)/4.0 FROM public.invoices i
        WHERE i.branch_id = b.id AND i.status = 'cancelled'
          AND i.cancelled_at >= now() - interval '35 days' AND i.cancelled_at < now() - interval '7 days'),0) AS avg_void
    FROM public.branches b
    JOIN public.tenants t ON t.id = b.tenant_id
    WHERE b.is_active AND t.is_active AND NOT t.is_suspended
  LOOP
    -- Expenses spike (> +50% vs 4-week average, and material)
    IF r.avg_exp > 0 AND r.cur_exp > r.avg_exp * 1.5 AND r.cur_exp - r.avg_exp >= 500 THEN
      v_sent := v_sent + public.notify_tenant_admins(
        r.tenant_id,
        'انحراف في المصروفات — فرع ' || r.branch_name,
        'مصروفات آخر 7 أيام ' || ROUND(r.cur_exp,2) || ' ج مقابل متوسط أسبوعي ' || ROUND(r.avg_exp,2) ||
        ' ج (زيادة ' || ROUND((r.cur_exp - r.avg_exp) / NULLIF(r.avg_exp,0) * 100) || '%).',
        'anomaly', '/admin/expenses', 'branch', r.branch_id);
    END IF;

    -- Sales collapse (< -40%)
    IF r.avg_sales > 0 AND r.cur_sales < r.avg_sales * 0.6 THEN
      v_sent := v_sent + public.notify_tenant_admins(
        r.tenant_id,
        'هبوط في المبيعات — فرع ' || r.branch_name,
        'مبيعات آخر 7 أيام ' || ROUND(r.cur_sales,2) || ' ج مقابل متوسط أسبوعي ' || ROUND(r.avg_sales,2) ||
        ' ج (انخفاض ' || ROUND((r.avg_sales - r.cur_sales) / NULLIF(r.avg_sales,0) * 100) || '%).',
        'anomaly', '/admin/executive-insights', 'branch', r.branch_id);
    END IF;

    -- Discounts spike (> +80%)
    IF r.avg_disc > 0 AND r.cur_disc > r.avg_disc * 1.8 AND r.cur_disc - r.avg_disc >= 300 THEN
      v_sent := v_sent + public.notify_tenant_admins(
        r.tenant_id,
        'ارتفاع غير معتاد في الخصومات — فرع ' || r.branch_name,
        'خصومات آخر 7 أيام ' || ROUND(r.cur_disc,2) || ' ج مقابل متوسط أسبوعي ' || ROUND(r.avg_disc,2) || ' ج.',
        'anomaly', '/admin/sales', 'branch', r.branch_id);
    END IF;

    -- Cancellations spike (>= 3 and double the average)
    IF r.cur_void >= 3 AND r.cur_void > GREATEST(r.avg_void,0.5) * 2 THEN
      v_sent := v_sent + public.notify_tenant_admins(
        r.tenant_id,
        'إلغاءات فواتير غير معتادة — فرع ' || r.branch_name,
        'عدد الفواتير الملغية آخر 7 أيام ' || r.cur_void || ' مقابل متوسط أسبوعي ' || ROUND(r.avg_void,1) || '.',
        'anomaly', '/admin/sales', 'branch', r.branch_id);
    END IF;
  END LOOP;
  RETURN v_sent;
END $$;

-- ============ 3. Cycle count enforcement ============
CREATE OR REPLACE FUNCTION public.branch_cycle_count_status(p_branch_id uuid, p_stale_days int DEFAULT 90)
RETURNS TABLE(overdue_count int, critical_count int, last_session timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last_counted AS (
    SELECT p.id, p.created_at,
      (SELECT MAX(COALESCE(s.counted_at, s.approved_at, s.closed_at))
         FROM public.inventory_session_items si
         JOIN public.inventory_sessions s ON s.id = si.session_id
        WHERE si.product_id = p.id AND s.branch_id = p.branch_id) AS lc
    FROM public.products p
    WHERE p.branch_id = p_branch_id AND p.archived_at IS NULL
  )
  SELECT
    COUNT(*) FILTER (
      WHERE (lc IS NULL AND created_at < now() - (p_stale_days || ' days')::interval)
         OR lc < now() - (p_stale_days || ' days')::interval)::int,
    COUNT(*) FILTER (
      WHERE (lc IS NULL AND created_at < now() - ((p_stale_days + 30) || ' days')::interval)
         OR lc < now() - ((p_stale_days + 30) || ' days')::interval)::int,
    (SELECT MAX(created_at) FROM public.inventory_sessions s WHERE s.branch_id = p_branch_id)
  FROM last_counted;
$$;

CREATE OR REPLACE FUNCTION public.enforce_cycle_counts(p_stale_days int DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; st record; v_sent int := 0;
BEGIN
  FOR b IN
    SELECT br.id, br.name, br.tenant_id FROM public.branches br
    JOIN public.tenants t ON t.id = br.tenant_id
    WHERE br.is_active AND t.is_active AND NOT t.is_suspended
  LOOP
    SELECT * INTO st FROM public.branch_cycle_count_status(b.id, p_stale_days);
    IF st.overdue_count > 0 THEN
      v_sent := v_sent + public.notify_tenant_admins(
        b.tenant_id,
        'جرد دوري مستحق — فرع ' || b.name,
        st.overdue_count || ' صنف عدى عليه أكتر من ' || p_stale_days || ' يوم من غير جرد فعلي. افتح جلسة جرد.',
        'cycle_count', '/branch/' || b.id || '/inventory-count', 'branch', b.id,
        ARRAY['branch_manager','warehouse']::app_role[], 20);
    END IF;
    IF st.critical_count > 0 THEN
      v_sent := v_sent + public.notify_tenant_admins(
        b.tenant_id,
        'تصعيد: جرد متأخر جداً — فرع ' || b.name,
        st.critical_count || ' صنف عدى عليه أكتر من ' || (p_stale_days + 30) ||
        ' يوم من غير جرد. الجرد بقى إلزامي على الفرع ده.',
        'cycle_count_escalation', '/branch/' || b.id || '/inventory-count', 'branch', b.id,
        ARRAY['admin','owner','super_admin']::app_role[], 20);
    END IF;
  END LOOP;
  RETURN v_sent;
END $$;

-- ============ 4. Automated health / regression runs ============
CREATE TABLE IF NOT EXISTS public.health_check_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  status text NOT NULL,
  failure_count int NOT NULL DEFAULT 0,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  details jsonb,
  source text NOT NULL DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.health_check_runs TO authenticated;
GRANT ALL ON public.health_check_runs TO service_role;
ALTER TABLE public.health_check_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins view health runs" ON public.health_check_runs;
CREATE POLICY "admins view health runs" ON public.health_check_runs
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'super_admin')
);

CREATE INDEX IF NOT EXISTS idx_health_check_runs_created ON public.health_check_runs(created_at DESC);

CREATE OR REPLACE FUNCTION public.run_regression_checks(p_source text DEFAULT 'cron')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb; v_fails jsonb := '[]'::jsonb; v_key text; v_item jsonb; v_id uuid; t record;
BEGIN
  SELECT to_jsonb(public.system_health_check()) INTO v_res;

  FOR v_key IN SELECT jsonb_object_keys(v_res) LOOP
    IF jsonb_typeof(v_res -> v_key) = 'array' THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_res -> v_key) LOOP
        IF (v_item ? 'ok') AND (v_item ->> 'ok') = 'false' THEN
          v_fails := v_fails || jsonb_build_object('check', v_key, 'detail', v_item);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.health_check_runs (status, failure_count, failures, details, source)
  VALUES (CASE WHEN jsonb_array_length(v_fails) = 0 THEN 'pass' ELSE 'fail' END,
          jsonb_array_length(v_fails), v_fails, v_res, p_source)
  RETURNING id INTO v_id;

  IF jsonb_array_length(v_fails) > 0 THEN
    FOR t IN SELECT id, name FROM public.tenants WHERE is_active AND NOT is_suspended LOOP
      PERFORM public.notify_tenant_admins(
        t.id,
        'فحص سلامة النظام لقى ' || jsonb_array_length(v_fails) || ' مشكلة',
        'الفحص التلقائي اكتشف اختلالات محاسبية أو بيانات غير متسقة. افتح صفحة صحة النظام للتفاصيل.',
        'health_check', '/admin/system-health', 'health_check_run', v_id);
    END LOOP;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.run_regression_checks(text) FROM anon;
REVOKE ALL ON FUNCTION public.detect_anomalies() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_cycle_counts(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.run_regression_checks(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.branch_cycle_count_status(uuid, int) TO authenticated;

-- ============ 5. Schedules ============
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobname) FROM cron.job
 WHERE jobname IN ('nizam-detect-anomalies','nizam-cycle-counts','nizam-regression-checks');

SELECT cron.schedule('nizam-detect-anomalies', '0 6 * * *', $$SELECT public.detect_anomalies();$$);
SELECT cron.schedule('nizam-cycle-counts',     '30 6 * * *', $$SELECT public.enforce_cycle_counts();$$);
SELECT cron.schedule('nizam-regression-checks','0 3 * * *', $$SELECT public.run_regression_checks('cron');$$);