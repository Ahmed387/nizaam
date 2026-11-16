-- 0239 — Subscription plans («الباقات») per company (owner 2026-11-16: «اعمل Standard للفيتشرز الموجوده كلها … وصاحب المنصة
-- هوا اللي يحدد كل فيتشر هتبقي في اي خطه وسعرها كام … الشهرية والسنوية … خصم»، «بأكده يدويًا»، «ابدا من الاول»، حدود
-- فروع / مستخدمين / فواتير، «مفيش غير شركة A&N … مفتوح ليها كل حاجة … ليميت infinity»).
--
-- * `platform_features` = the standard list: every page / tab of the permission catalogue (src/lib/permissionCatalog.ts,
--   66 keys; a tab follows its page) + services (`svc.telegram_eta`, `svc.daily_report`).
-- * `platform_plans` (+ `platform_plan_features`): name, monthly / yearly price, a discount % for each, limits (NULL = بلا حد),
--   `all_features`. Seeded: أساسي 990 / أعمال 2,200 / احترافي 4,500 a month, yearly = 10 months, and «غير محدود (داخلي)».
-- * `tenant_subscriptions`: the company's plan, cycle (monthly / yearly / unlimited), start → end, price, discount, amount
--   due, paid (by hand, by the platform owner), grace days (default 7). Every change → `tenant_subscription_events`.
--   A renewal starts from its own start day («ابدا من الاول»). A & N = «غير محدود», unlimited.
-- * The company reads `tenant_plan_state()`: plan, days left, status (active / ending ≤ 7 days / grace / expired / none),
--   the features NOT in its plan (the app hides those pages for everyone, the owner too) and limits + usage.
--   After the grace days the app is read-only for that company. No subscription row = nothing is restricted.
-- * Server limits: branches (tenants.max_branches follows the plan), users (`zz_plan_user_limit` on user_roles),
--   sale invoices a month (`zz_plan_invoice_limit` on invoices). Services: the daily report and the Telegram e-invoice
--   messages run only when the plan has them. Reminders 7 / 3 / 1 / 0 days before the end (cron «subscription-reminders»).

CREATE TABLE IF NOT EXISTS public.platform_features (
  key text PRIMARY KEY,
  label text NOT NULL,
  section text NOT NULL,
  parent text,
  sort int NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'service'))
);
ALTER TABLE public.platform_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_features FROM anon, authenticated;
INSERT INTO public.platform_features (key, label, section, parent, sort, kind) VALUES
  ('dashboard','الرئيسية','عام',NULL,0,'page'),
  ('admin_home','الرئيسية (لوحة التحكم العامة)','عام',NULL,1,'page'),
  ('admin_ask_me','اسألني (المساعد الذكي)','عام',NULL,2,'page'),
  ('admin_insights','الرؤى التنفيذية','عام',NULL,3,'page'),
  ('sales','المبيعات','العمليات',NULL,4,'page'),
  ('invoices','الفواتير والمستندات','العمليات',NULL,5,'page'),
  ('preorders','طلبات الحجز','العمليات',NULL,6,'page'),
  ('shipments','فواتير الشراء','العمليات',NULL,7,'page'),
  ('inventory','المخزون','العمليات',NULL,8,'page'),
  ('transfers','نقل المخزون بين الفروع','العمليات',NULL,9,'page'),
  ('customers','العملاء','العمليات',NULL,10,'page'),
  ('suppliers','الموردين','العمليات',NULL,11,'page'),
  ('employees','الموظفين','العمليات',NULL,12,'page'),
  ('advances','السلف','العمليات',NULL,13,'page'),
  ('attendance','الحضور والانصراف','العمليات',NULL,14,'page'),
  ('attachments','المرفقات (ملفات الفواتير والمستندات)','العمليات',NULL,15,'page'),
  ('doc_class','تحويل الفاتورة نقدي / آجل (بيع وشراء)','العمليات',NULL,16,'page'),
  ('returns','تعديل المرتجعات (بيع وشراء)','العمليات',NULL,17,'page'),
  ('admin_catalog','الفروع والمخزون','العمليات',NULL,18,'page'),
  ('admin_catalog_branches','إدارة الفروع','العمليات','admin_catalog',19,'page'),
  ('admin_catalog_categories','التصنيفات','العمليات','admin_catalog',20,'page'),
  ('admin_catalog_pricelist','قائمة الأسعار','العمليات','admin_catalog',21,'page'),
  ('admin_catalog_inventory','مخزون كل الفروع','العمليات','admin_catalog',22,'page'),
  ('admin_catalog_images','صور المنتجات','العمليات','admin_catalog',23,'page'),
  ('admin_product_attributes','خصائص المنتجات','العمليات',NULL,24,'page'),
  ('admin_contacts','الحسابات','العمليات',NULL,25,'page'),
  ('admin_employees','الموظفين (إدارة)','العمليات',NULL,26,'page'),
  ('admin_presence','تتبع المستخدمين','العمليات',NULL,27,'page'),
  ('admin_shifts','سجل الورديات','العمليات',NULL,28,'page'),
  ('treasury','الخزنة','المالية',NULL,29,'page'),
  ('vessel_transfers','التحويل بين أوعية الفرع (كاش / محافظ / بنك)','المالية',NULL,30,'page'),
  ('receipt_vouchers','سندات القبض','المالية',NULL,31,'page'),
  ('payment_vouchers','سندات الصرف','المالية',NULL,32,'page'),
  ('reports','التقارير','المالية',NULL,33,'page'),
  ('admin_main_treasury','ملخص الخزائن','المالية',NULL,34,'page'),
  ('admin_finance','المالية','المالية',NULL,35,'page'),
  ('admin_finance_vouchers','السندات المالية','المالية','admin_finance',36,'page'),
  ('admin_finance_receivables','أرصدة المدين والدائن','المالية','admin_finance',37,'page'),
  ('admin_acc_books','الدفاتر (دليل الحسابات، اليومية، الأستاذ، ميزان المراجعة)','المالية','admin_finance',38,'page'),
  ('admin_acc_statements','القوائم المالية (المركز المالي، الدخل، التدفقات، حقوق الملكية، تكلفة البضاعة)','المالية','admin_finance',39,'page'),
  ('admin_acc_aging','أعمار الديون','المالية','admin_finance',40,'page'),
  ('admin_acc_opening','الأرصدة الافتتاحية','المالية','admin_finance',41,'page'),
  ('admin_acc_bank','المطابقة البنكية','المالية','admin_finance',42,'page'),
  ('admin_acc_closing','الإقفال وتوزيع الأرباح','المالية','admin_finance',43,'page'),
  ('admin_acc_assets','الأصول الثابتة','المالية','admin_finance',44,'page'),
  ('admin_acc_branch_capital','توزيع رأس المال على الفروع','المالية','admin_finance',45,'page'),
  ('admin_eta','الفواتير الإلكترونية الواردة (منظومة الضرائب)','المالية','admin_finance',46,'page'),
  ('admin_financial_position','الذمة المالية للشركاء','المالية',NULL,47,'page'),
  ('admin_reports_hub','التقارير (المركزية)','المالية',NULL,48,'page'),
  ('admin_reports_owner','نظرة المالك','المالية','admin_reports_hub',49,'page'),
  ('admin_reports_central','العمليات (مركزية)','المالية','admin_reports_hub',50,'page'),
  ('admin_reports_profitability','الربحية','المالية','admin_reports_hub',51,'page'),
  ('admin_reports_insights','الرؤى التنفيذية','المالية','admin_reports_hub',52,'page'),
  ('admin_reports_scheduled','التقارير المجدولة','المالية','admin_reports_hub',53,'page'),
  ('admin_reports_audit','سجل العمليات','المالية','admin_reports_hub',54,'page'),
  ('admin_reports_price_audit','سجل الأسعار','المالية','admin_reports_hub',55,'page'),
  ('admin_reports_return_overrides','تجاوزات المرتجعات','المالية','admin_reports_hub',56,'page'),
  ('admin_historical_analytics','الأرشيف والتحليل التاريخي','المالية',NULL,57,'page'),
  ('admin_monthly_profit','ملخص الأرباح الشهري','المالية',NULL,58,'page'),
  ('net_profit','رؤية صافي الربح','المالية',NULL,59,'page'),
  ('admin_system_health','فحص السيستم','الإدارة',NULL,60,'page'),
  ('admin_approvals','طلبات موافقة الأدمن','الإدارة',NULL,61,'page'),
  ('admin_approvals_requests','طلبات الموافقة','الإدارة','admin_approvals',62,'page'),
  ('admin_approvals_discounts','طلبات الخصم','الإدارة','admin_approvals',63,'page'),
  ('admin_approvals_advances','طلبات السلف','الإدارة','admin_approvals',64,'page'),
  ('admin_settings','الإعدادات','الإدارة',NULL,65,'page'),
  ('svc.telegram_eta','رسائل تليجرام للفواتير الإلكترونية','خدمات',NULL,100,'service'),
  ('svc.daily_report','تقرير النشاط اليومي على تليجرام','خدمات',NULL,101,'service')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, section = EXCLUDED.section, parent = EXCLUDED.parent, sort = EXCLUDED.sort, kind = EXCLUDED.kind;

CREATE TABLE IF NOT EXISTS public.platform_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  monthly_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  yearly_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (yearly_price >= 0),
  monthly_discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (monthly_discount_pct BETWEEN 0 AND 100),
  yearly_discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (yearly_discount_pct BETWEEN 0 AND 100),
  max_branches int CHECK (max_branches IS NULL OR max_branches >= 1),
  max_users int CHECK (max_users IS NULL OR max_users >= 1),
  max_invoices_month int CHECK (max_invoices_month IS NULL OR max_invoices_month >= 1),
  all_features boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.platform_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_plans FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.platform_plan_features (
  plan_id uuid NOT NULL REFERENCES public.platform_plans(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES public.platform_features(key) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, feature_key)
);
ALTER TABLE public.platform_plan_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_plan_features FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.platform_plans(id),
  cycle text NOT NULL CHECK (cycle IN ('monthly', 'yearly', 'unlimited')),
  starts_on date NOT NULL,
  ends_on date,
  price numeric(14,2) NOT NULL DEFAULT 0,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  amount_due numeric(14,2) NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  paid_amount numeric(14,2),
  paid_on date,
  paid_note text,
  grace_days int NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
  unlimited boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CHECK (cycle = 'unlimited' OR ends_on IS NOT NULL),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_subscriptions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.tenant_subscription_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  by_user uuid,
  event text NOT NULL,
  data jsonb
);
CREATE INDEX IF NOT EXISTS tenant_subscription_events_t ON public.tenant_subscription_events (tenant_id, at DESC);
ALTER TABLE public.tenant_subscription_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_subscription_events FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.subscription_reminders_sent (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ends_on date NOT NULL,
  days_left int NOT NULL,
  PRIMARY KEY (tenant_id, ends_on, days_left)
);
ALTER TABLE public.subscription_reminders_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_reminders_sent FROM anon, authenticated;

-- Applied live as 0239a (tables + seed) and 0239b (functions); same result as this file.
-- ---------------------------------------------------------------- seed plans (prices are the platform owner's to change)
INSERT INTO public.platform_plans (name, description, monthly_price, yearly_price, max_branches, max_users, max_invoices_month, sort)
VALUES ('أساسي', 'بيع وشراء ومخزون وخزينة لفرع واحد', 990, 9900, 1, 3, 400, 1),
       ('أعمال', 'الأساسي + المحاسبة والقوائم المالية والموظفين والفواتير الإلكترونية', 2200, 22000, 3, 10, 2000, 2),
       ('احترافي', 'كل حاجة في السيستم', 4500, 45000, 10, 30, 10000, 3)
ON CONFLICT (name) DO NOTHING;
INSERT INTO public.platform_plans (name, description, all_features, sort)
VALUES ('غير محدود (داخلي)', 'كل الخصائص من غير حدود — للشركات الداخلية', true, 99)
ON CONFLICT (name) DO NOTHING;
UPDATE public.platform_plans SET all_features = true WHERE name = 'احترافي';
INSERT INTO public.platform_plan_features (plan_id, feature_key)
SELECT p.id, k FROM public.platform_plans p, unnest(ARRAY['admin_approvals','admin_approvals_advances','admin_approvals_discounts','admin_approvals_requests','admin_catalog','admin_catalog_branches','admin_catalog_categories','admin_catalog_images','admin_catalog_inventory','admin_catalog_pricelist','admin_contacts','admin_home','admin_main_treasury','admin_product_attributes','admin_settings','admin_shifts','admin_system_health','attachments','customers','dashboard','doc_class','inventory','invoices','payment_vouchers','preorders','receipt_vouchers','reports','returns','sales','shipments','suppliers','transfers','treasury','vessel_transfers']) k WHERE p.name = 'أساسي'
ON CONFLICT DO NOTHING;
INSERT INTO public.platform_plan_features (plan_id, feature_key)
SELECT p.id, k FROM public.platform_plans p, unnest(ARRAY['admin_acc_aging','admin_acc_assets','admin_acc_bank','admin_acc_books','admin_acc_branch_capital','admin_acc_closing','admin_acc_opening','admin_acc_statements','admin_approvals','admin_approvals_advances','admin_approvals_discounts','admin_approvals_requests','admin_catalog','admin_catalog_branches','admin_catalog_categories','admin_catalog_images','admin_catalog_inventory','admin_catalog_pricelist','admin_contacts','admin_employees','admin_eta','admin_finance','admin_finance_receivables','admin_finance_vouchers','admin_home','admin_main_treasury','admin_monthly_profit','admin_presence','admin_product_attributes','admin_reports_audit','admin_reports_central','admin_reports_hub','admin_reports_owner','admin_reports_price_audit','admin_reports_profitability','admin_reports_return_overrides','admin_reports_scheduled','admin_settings','admin_shifts','admin_system_health','advances','attachments','attendance','customers','dashboard','doc_class','employees','inventory','invoices','net_profit','payment_vouchers','preorders','receipt_vouchers','reports','returns','sales','shipments','suppliers','svc.telegram_eta','transfers','treasury','vessel_transfers']) k WHERE p.name = 'أعمال'
ON CONFLICT DO NOTHING;
INSERT INTO public.platform_plan_features (plan_id, feature_key)
SELECT p.id, f.key FROM public.platform_plans p, public.platform_features f WHERE p.all_features
ON CONFLICT DO NOTHING;

-- A & N: everything, no limits
INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, cycle, starts_on, ends_on, unlimited, paid, notes)
SELECT '5316fbfe-b862-4c91-b48b-1d81c8aa5a71', id, 'unlimited', DATE '2026-11-16', NULL, true, true, 'شركة A&N — مفتوح ليها كل حاجة'
  FROM public.platform_plans WHERE name = 'غير محدود (داخلي)'
ON CONFLICT (tenant_id) DO NOTHING;

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public.subscription_status(p_ends date, p_grace int, p_unlimited boolean)
 RETURNS text LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN p_unlimited OR p_ends IS NULL THEN 'active'
    WHEN (now() AT TIME ZONE 'Africa/Cairo')::date <= p_ends - 8 THEN 'active'
    WHEN (now() AT TIME ZONE 'Africa/Cairo')::date <= p_ends THEN 'ending'
    WHEN (now() AT TIME ZONE 'Africa/Cairo')::date <= p_ends + coalesce(p_grace, 0) THEN 'grace'
    ELSE 'expired' END
$$;

CREATE OR REPLACE FUNCTION public.tenant_feature_allowed(p_tenant uuid, p_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN s.tenant_id IS NULL OR s.unlimited OR p.all_features THEN true
    ELSE EXISTS (SELECT 1 FROM platform_plan_features pf WHERE pf.plan_id = s.plan_id AND pf.feature_key = p_key)
         AND NOT EXISTS (SELECT 1 FROM platform_features f WHERE f.key = p_key AND f.parent IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM platform_plan_features pf2 WHERE pf2.plan_id = s.plan_id AND pf2.feature_key = f.parent))
  END
    FROM (SELECT p_tenant AS t) x
    LEFT JOIN tenant_subscriptions s ON s.tenant_id = x.t
    LEFT JOIN platform_plans p ON p.id = s.plan_id
$$;

CREATE OR REPLACE FUNCTION public.subscription_amount(p_price numeric, p_disc numeric)
 RETURNS numeric LANGUAGE sql IMMUTABLE
AS $$ SELECT round(coalesce(p_price, 0) * (1 - coalesce(p_disc, 0) / 100.0), 2) $$;

CREATE OR REPLACE FUNCTION public.tenant_plan_usage(p_tenant uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'branches', (SELECT count(*) FROM branches WHERE tenant_id = p_tenant AND NOT coalesce(is_system, false)),
    'users', (SELECT count(DISTINCT user_id) FROM user_roles WHERE tenant_id = p_tenant AND role <> 'super_admin'),
    'invoices_month', (SELECT count(*) FROM invoices WHERE tenant_id = p_tenant
                        AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')))
$$;

-- the company: its plan, what is closed, limits and usage
CREATE OR REPLACE FUNCTION public.tenant_plan_state()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid := public.current_tenant_id(); s record; p record; v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  IF auth.uid() IS NULL OR v_t IS NULL THEN RETURN jsonb_build_object('has_plan', false); END IF;
  SELECT * INTO s FROM tenant_subscriptions WHERE tenant_id = v_t;
  IF NOT FOUND THEN RETURN jsonb_build_object('has_plan', false, 'status', 'none', 'disabled', '[]'::jsonb); END IF;
  SELECT * INTO p FROM platform_plans WHERE id = s.plan_id;
  RETURN jsonb_build_object(
    'has_plan', true, 'plan', p.name, 'cycle', s.cycle, 'unlimited', s.unlimited,
    'starts_on', s.starts_on, 'ends_on', s.ends_on, 'grace_days', s.grace_days, 'paid', s.paid,
    'days_left', CASE WHEN s.ends_on IS NULL OR s.unlimited THEN NULL ELSE s.ends_on - v_today END,
    'status', public.subscription_status(s.ends_on, s.grace_days, s.unlimited),
    'disabled', CASE WHEN s.unlimited OR p.all_features THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(f.key ORDER BY f.sort) FROM platform_features f
         WHERE NOT public.tenant_feature_allowed(v_t, f.key)), '[]'::jsonb) END,
    'limits', CASE WHEN s.unlimited THEN jsonb_build_object('branches', NULL, 'users', NULL, 'invoices_month', NULL)
                   ELSE jsonb_build_object('branches', p.max_branches, 'users', p.max_users, 'invoices_month', p.max_invoices_month) END,
    'usage', public.tenant_plan_usage(v_t));
END $$;

-- ---------------------------------------------------------------- platform owner: plans
CREATE OR REPLACE FUNCTION public.super_plans_list()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'features', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'section', section, 'parent', parent, 'kind', kind) ORDER BY sort), '[]'::jsonb) FROM platform_features),
    'plans', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'monthly_price', p.monthly_price, 'yearly_price', p.yearly_price,
        'monthly_discount_pct', p.monthly_discount_pct, 'yearly_discount_pct', p.yearly_discount_pct,
        'max_branches', p.max_branches, 'max_users', p.max_users, 'max_invoices_month', p.max_invoices_month,
        'all_features', p.all_features, 'is_active', p.is_active, 'sort', p.sort,
        'features', (SELECT coalesce(jsonb_agg(feature_key), '[]'::jsonb) FROM platform_plan_features WHERE plan_id = p.id),
        'companies', (SELECT count(*) FROM tenant_subscriptions s WHERE s.plan_id = p.id)) ORDER BY p.sort, p.name), '[]'::jsonb)
      FROM platform_plans p));
END $$;

CREATE OR REPLACE FUNCTION public.super_plan_save(p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid := NULLIF(p->>'id', '')::uuid; v_name text := btrim(coalesce(p->>'name', ''));
  lim int; k text; t record;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'اكتب اسم الباقة'; END IF;
  IF coalesce((p->>'monthly_price')::numeric, 0) < 0 OR coalesce((p->>'yearly_price')::numeric, 0) < 0 THEN RAISE EXCEPTION 'السعر مينفعش يبقى بالسالب'; END IF;
  IF coalesce((p->>'monthly_discount_pct')::numeric, 0) NOT BETWEEN 0 AND 100 OR coalesce((p->>'yearly_discount_pct')::numeric, 0) NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'الخصم من 0 لـ 100٪';
  END IF;
  FOREACH k IN ARRAY ARRAY['max_branches', 'max_users', 'max_invoices_month'] LOOP
    lim := NULLIF(p->>k, '')::int;
    IF lim IS NOT NULL AND lim < 1 THEN RAISE EXCEPTION 'الحدود لازم تكون 1 أو أكتر، أو فاضية = بلا حد'; END IF;
  END LOOP;
  IF v_id IS NULL THEN
    INSERT INTO platform_plans (name, updated_by) VALUES (v_name, auth.uid()) RETURNING id INTO v_id;
  END IF;
  UPDATE platform_plans SET name = v_name, description = NULLIF(btrim(p->>'description'), ''),
     monthly_price = coalesce((p->>'monthly_price')::numeric, 0), yearly_price = coalesce((p->>'yearly_price')::numeric, 0),
     monthly_discount_pct = coalesce((p->>'monthly_discount_pct')::numeric, 0), yearly_discount_pct = coalesce((p->>'yearly_discount_pct')::numeric, 0),
     max_branches = NULLIF(p->>'max_branches', '')::int, max_users = NULLIF(p->>'max_users', '')::int,
     max_invoices_month = NULLIF(p->>'max_invoices_month', '')::int,
     all_features = coalesce((p->>'all_features')::boolean, false), is_active = coalesce((p->>'is_active')::boolean, true),
     sort = coalesce((p->>'sort')::int, sort), updated_at = now(), updated_by = auth.uid()
   WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الباقة مش موجودة'; END IF;
  DELETE FROM platform_plan_features WHERE plan_id = v_id;
  IF coalesce((p->>'all_features')::boolean, false) THEN
    INSERT INTO platform_plan_features (plan_id, feature_key) SELECT v_id, key FROM platform_features;
  ELSE
    INSERT INTO platform_plan_features (plan_id, feature_key)
    SELECT v_id, f.key FROM platform_features f WHERE f.key IN (SELECT jsonb_array_elements_text(coalesce(p->'features', '[]'::jsonb)));
  END IF;
  -- the companies on this plan follow its branch limit
  FOR t IN SELECT s.tenant_id FROM tenant_subscriptions s WHERE s.plan_id = v_id AND NOT s.unlimited LOOP
    PERFORM public.subscription_sync_limits(t.tenant_id);
  END LOOP;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.super_plan_delete(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM tenant_subscriptions WHERE plan_id = p_id) THEN
    RAISE EXCEPTION 'فيه شركات على الباقة دي — انقلهم لباقة تانية الأول، أو وقّف الباقة بدل ما تمسحها';
  END IF;
  DELETE FROM platform_plans WHERE id = p_id;
END $$;

-- ---------------------------------------------------------------- platform owner: a company's subscription
CREATE OR REPLACE FUNCTION public.subscription_sync_limits(p_tenant uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s record; v_used int;
BEGIN
  SELECT ts.unlimited, pp.max_branches INTO s FROM tenant_subscriptions ts JOIN platform_plans pp ON pp.id = ts.plan_id WHERE ts.tenant_id = p_tenant;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO v_used FROM branches WHERE tenant_id = p_tenant AND NOT coalesce(is_system, false);
  -- never below what the company already has (its branches stay; only new ones are refused)
  UPDATE tenants SET max_branches = CASE WHEN s.unlimited OR s.max_branches IS NULL THEN 999 ELSE greatest(s.max_branches, v_used) END
   WHERE id = p_tenant;
END $$;

CREATE OR REPLACE FUNCTION public.super_tenant_subscription_get(p_tenant uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s record; v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  SELECT ts.*, pp.name AS plan_name INTO s FROM tenant_subscriptions ts JOIN platform_plans pp ON pp.id = ts.plan_id WHERE ts.tenant_id = p_tenant;
  RETURN jsonb_build_object(
    'subscription', CASE WHEN s.tenant_id IS NULL THEN NULL ELSE jsonb_build_object(
      'plan_id', s.plan_id, 'plan_name', s.plan_name, 'cycle', s.cycle, 'starts_on', s.starts_on, 'ends_on', s.ends_on,
      'price', s.price, 'discount_pct', s.discount_pct, 'amount_due', s.amount_due, 'paid', s.paid, 'paid_amount', s.paid_amount,
      'paid_on', s.paid_on, 'paid_note', s.paid_note, 'grace_days', s.grace_days, 'unlimited', s.unlimited, 'notes', s.notes,
      'days_left', CASE WHEN s.ends_on IS NULL OR s.unlimited THEN NULL ELSE s.ends_on - v_today END,
      'status', public.subscription_status(s.ends_on, s.grace_days, s.unlimited)) END,
    'usage', public.tenant_plan_usage(p_tenant),
    'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'event', e.event, 'data', e.data, 'by', pr.name) ORDER BY e.at DESC), '[]'::jsonb)
                 FROM (SELECT * FROM tenant_subscription_events WHERE tenant_id = p_tenant ORDER BY at DESC LIMIT 30) e
                 LEFT JOIN profiles pr ON pr.id = e.by_user));
END $$;

CREATE OR REPLACE FUNCTION public.super_tenant_subscription_set(p_tenant uuid, p jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_plan record; v_cycle text := coalesce(p->>'cycle', 'monthly'); v_start date := coalesce(NULLIF(p->>'starts_on', '')::date, (now() AT TIME ZONE 'Africa/Cairo')::date);
  v_end date := NULLIF(p->>'ends_on', '')::date; v_price numeric; v_disc numeric; v_unl boolean := coalesce((p->>'unlimited')::boolean, false);
  v_old record; v_renew boolean;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
  SELECT * INTO v_plan FROM platform_plans WHERE id = NULLIF(p->>'plan_id', '')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'اختار الباقة'; END IF;
  IF v_cycle NOT IN ('monthly', 'yearly', 'unlimited') THEN RAISE EXCEPTION 'مدة الاشتراك غلط'; END IF;
  IF v_cycle = 'unlimited' THEN v_end := NULL;
  ELSIF v_end IS NULL THEN v_end := (v_start + CASE v_cycle WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END)::date - 1;
  END IF;
  IF v_end IS NOT NULL AND v_end < v_start THEN RAISE EXCEPTION 'تاريخ النهاية قبل البداية'; END IF;
  v_price := coalesce(NULLIF(p->>'price', '')::numeric, CASE v_cycle WHEN 'yearly' THEN v_plan.yearly_price WHEN 'monthly' THEN v_plan.monthly_price ELSE 0 END);
  v_disc := coalesce(NULLIF(p->>'discount_pct', '')::numeric, CASE v_cycle WHEN 'yearly' THEN v_plan.yearly_discount_pct WHEN 'monthly' THEN v_plan.monthly_discount_pct ELSE 0 END);
  IF v_price < 0 OR v_disc NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'السعر أو الخصم غلط'; END IF;
  SELECT * INTO v_old FROM tenant_subscriptions WHERE tenant_id = p_tenant;
  v_renew := FOUND AND (v_old.starts_on IS DISTINCT FROM v_start OR v_old.plan_id IS DISTINCT FROM v_plan.id OR v_old.cycle IS DISTINCT FROM v_cycle);
  INSERT INTO tenant_subscriptions AS ts (tenant_id, plan_id, cycle, starts_on, ends_on, price, discount_pct, amount_due, grace_days, unlimited, notes, paid, updated_by)
  VALUES (p_tenant, v_plan.id, v_cycle, v_start, v_end, v_price, v_disc, public.subscription_amount(v_price, v_disc),
          coalesce(NULLIF(p->>'grace_days', '')::int, 7), v_unl, NULLIF(btrim(p->>'notes'), ''), v_unl, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, cycle = EXCLUDED.cycle, starts_on = EXCLUDED.starts_on,
     ends_on = EXCLUDED.ends_on, price = EXCLUDED.price, discount_pct = EXCLUDED.discount_pct, amount_due = EXCLUDED.amount_due,
     grace_days = EXCLUDED.grace_days, unlimited = EXCLUDED.unlimited, notes = EXCLUDED.notes,
     -- a new period (another start day / plan / cycle) starts unpaid
     paid = CASE WHEN v_renew THEN EXCLUDED.unlimited ELSE ts.paid END,
     paid_amount = CASE WHEN v_renew THEN NULL ELSE ts.paid_amount END,
     paid_on = CASE WHEN v_renew THEN NULL ELSE ts.paid_on END,
     paid_note = CASE WHEN v_renew THEN NULL ELSE ts.paid_note END,
     updated_at = now(), updated_by = auth.uid();
  INSERT INTO tenant_subscription_events (tenant_id, by_user, event, data)
  VALUES (p_tenant, auth.uid(), CASE WHEN v_old.tenant_id IS NULL THEN 'start' WHEN v_renew THEN 'renew' ELSE 'change' END,
          jsonb_build_object('plan', v_plan.name, 'cycle', v_cycle, 'starts_on', v_start, 'ends_on', v_end, 'price', v_price,
                             'discount_pct', v_disc, 'amount_due', public.subscription_amount(v_price, v_disc), 'unlimited', v_unl));
  PERFORM public.subscription_sync_limits(p_tenant);
  DELETE FROM subscription_reminders_sent WHERE tenant_id = p_tenant AND ends_on IS DISTINCT FROM v_end;
  RETURN public.super_tenant_subscription_get(p_tenant);
END $$;

CREATE OR REPLACE FUNCTION public.super_tenant_subscription_pay(p_tenant uuid, p_paid boolean, p_amount numeric, p_on date, p_note text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF p_paid AND (p_amount IS NULL OR p_amount < 0) THEN RAISE EXCEPTION 'اكتب المبلغ اللي اتدفع'; END IF;
  UPDATE tenant_subscriptions SET paid = p_paid, paid_amount = CASE WHEN p_paid THEN p_amount END,
         paid_on = CASE WHEN p_paid THEN coalesce(p_on, (now() AT TIME ZONE 'Africa/Cairo')::date) END,
         paid_note = CASE WHEN p_paid THEN NULLIF(btrim(p_note), '') END, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشركة مالهاش اشتراك لسه'; END IF;
  INSERT INTO tenant_subscription_events (tenant_id, by_user, event, data)
  VALUES (p_tenant, auth.uid(), CASE WHEN p_paid THEN 'paid' ELSE 'unpaid' END,
          jsonb_build_object('amount', p_amount, 'on', p_on, 'note', p_note));
  RETURN public.super_tenant_subscription_get(p_tenant);
END $$;

CREATE OR REPLACE FUNCTION public.super_subscriptions_overview()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'tenant_id', t.id, 'tenant', t.name, 'plan', pp.name, 'cycle', s.cycle, 'ends_on', s.ends_on, 'paid', s.paid,
      'amount_due', s.amount_due, 'unlimited', s.unlimited,
      'days_left', CASE WHEN s.ends_on IS NULL OR s.unlimited THEN NULL ELSE s.ends_on - v_today END,
      'status', CASE WHEN s.tenant_id IS NULL THEN 'none' ELSE public.subscription_status(s.ends_on, s.grace_days, s.unlimited) END)
      ORDER BY s.ends_on NULLS LAST, t.name), '[]'::jsonb)
    FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id LEFT JOIN platform_plans pp ON pp.id = s.plan_id
   WHERE NOT coalesce(t.is_test, false));
END $$;

-- ---------------------------------------------------------------- server limits
CREATE OR REPLACE FUNCTION public.plan_user_limit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_max int; v_n int;
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.role = 'super_admin' OR public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id) THEN RETURN NEW; END IF;
  SELECT CASE WHEN s.unlimited THEN NULL ELSE p.max_users END INTO v_max
    FROM tenant_subscriptions s JOIN platform_plans p ON p.id = s.plan_id WHERE s.tenant_id = NEW.tenant_id;
  IF v_max IS NULL THEN RETURN NEW; END IF;
  SELECT count(DISTINCT user_id) INTO v_n FROM user_roles WHERE tenant_id = NEW.tenant_id AND role <> 'super_admin';
  IF v_n >= v_max THEN
    RAISE EXCEPTION 'وصلت لأقصى عدد مستخدمين في باقتك (%) — كلّم إدارة المنصة لترقية الباقة', v_max USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_plan_user_limit ON public.user_roles;
CREATE TRIGGER zz_plan_user_limit BEFORE INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.plan_user_limit();

CREATE OR REPLACE FUNCTION public.plan_invoice_limit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_max int; v_n int;
BEGIN
  IF NEW.tenant_id IS NULL OR public.sahl_import_mode() THEN RETURN NEW; END IF;
  SELECT CASE WHEN s.unlimited THEN NULL ELSE p.max_invoices_month END INTO v_max
    FROM tenant_subscriptions s JOIN platform_plans p ON p.id = s.plan_id WHERE s.tenant_id = NEW.tenant_id;
  IF v_max IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM invoices WHERE tenant_id = NEW.tenant_id
     AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo');
  IF v_n >= v_max THEN
    RAISE EXCEPTION 'وصلت لأقصى عدد فواتير بيع في الشهر في باقتك (%) — كلّم إدارة المنصة لترقية الباقة', v_max USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_plan_invoice_limit ON public.invoices;
CREATE TRIGGER zz_plan_invoice_limit BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.plan_invoice_limit();

-- ---------------------------------------------------------------- services follow the plan
DO $svc$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.tg_daily_tick()'::regprocedure);
  n := replace(d, 'WHERE s.daily_report_enabled', 'WHERE s.daily_report_enabled AND public.tenant_feature_allowed(s.tenant_id, ''svc.daily_report'')');
  IF n = d AND strpos(d, 'svc.daily_report') = 0 THEN RAISE EXCEPTION '0239: tg_daily_tick anchor'; END IF;
  IF n <> d THEN EXECUTE n; END IF;
  d := pg_get_functiondef('public.eta_tg_mark_pending()'::regprocedure);
  n := replace(d, 'c.tenant_id = NEW.tenant_id AND c.tg_chat_id IS NOT NULL)', 'c.tenant_id = NEW.tenant_id AND c.tg_chat_id IS NOT NULL) AND public.tenant_feature_allowed(NEW.tenant_id, ''svc.telegram_eta'')');
  IF n = d AND strpos(d, 'svc.telegram_eta') = 0 THEN RAISE EXCEPTION '0239: eta_tg_mark_pending anchor'; END IF;
  IF n <> d THEN EXECUTE n; END IF;
END $svc$;

-- ---------------------------------------------------------------- reminders (09:07 Cairo ≈ 07:07 UTC, once a day per step)
CREATE OR REPLACE FUNCTION public.subscription_reminders()
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s record; u record; n int := 0; v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date; v_left int; v_title text;
BEGIN
  FOR s IN SELECT ts.*, t.name AS tenant_name, pp.name AS plan_name FROM tenant_subscriptions ts
             JOIN tenants t ON t.id = ts.tenant_id JOIN platform_plans pp ON pp.id = ts.plan_id
            WHERE NOT ts.unlimited AND ts.ends_on IS NOT NULL LOOP
    v_left := s.ends_on - v_today;
    CONTINUE WHEN v_left NOT IN (7, 3, 1, 0, -1, -(s.grace_days + 1));
    INSERT INTO subscription_reminders_sent (tenant_id, ends_on, days_left) VALUES (s.tenant_id, s.ends_on, v_left) ON CONFLICT DO NOTHING;
    CONTINUE WHEN NOT FOUND;
    v_title := CASE WHEN v_left > 0 THEN 'اشتراك باقة «' || s.plan_name || '» هيخلص بعد ' || v_left || ' يوم'
                    WHEN v_left = 0 THEN 'اشتراك باقة «' || s.plan_name || '» بيخلص النهارده'
                    WHEN v_left = -1 THEN 'اشتراك باقة «' || s.plan_name || '» خلص — فيه ' || s.grace_days || ' يوم سماح'
                    ELSE 'انتهت مهلة الاشتراك — السيستم بقى للعرض بس' END;
    FOR u IN SELECT DISTINCT ur.user_id, ur.tenant_id FROM user_roles ur
              WHERE (ur.tenant_id = s.tenant_id AND ur.role = 'owner') LOOP
      INSERT INTO notifications (tenant_id, user_id, title, body, type, link)
      VALUES (s.tenant_id, u.user_id, v_title, 'لتجديد الاشتراك كلّم إدارة المنصة' || CASE WHEN s.paid THEN '' ELSE ' — المبلغ المطلوب ' || s.amount_due END,
              'subscription', '/admin/settings');
    END LOOP;
    FOR u IN SELECT DISTINCT ur.user_id, p.tenant_id FROM user_roles ur JOIN profiles p ON p.id = ur.user_id WHERE ur.role = 'super_admin' LOOP
      INSERT INTO notifications (tenant_id, user_id, title, body, type, link)
      VALUES (u.tenant_id, u.user_id, s.tenant_name || ': ' || v_title, CASE WHEN s.paid THEN 'مدفوع' ELSE 'لسه مش مدفوع — ' || s.amount_due END,
              'subscription', '/super/tenants/' || s.tenant_id);
    END LOOP;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- privileges
REVOKE ALL ON FUNCTION public.tenant_feature_allowed(uuid, text), public.tenant_plan_usage(uuid), public.tenant_plan_state(),
  public.super_plans_list(), public.super_plan_save(jsonb), public.super_plan_delete(uuid), public.subscription_sync_limits(uuid),
  public.super_tenant_subscription_get(uuid), public.super_tenant_subscription_set(uuid, jsonb),
  public.super_tenant_subscription_pay(uuid, boolean, numeric, date, text), public.super_subscriptions_overview(),
  public.plan_user_limit(), public.plan_invoice_limit(), public.subscription_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_plan_state(), public.super_plans_list(), public.super_plan_save(jsonb), public.super_plan_delete(uuid),
  public.super_tenant_subscription_get(uuid), public.super_tenant_subscription_set(uuid, jsonb),
  public.super_tenant_subscription_pay(uuid, boolean, numeric, date, text), public.super_subscriptions_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_feature_allowed(uuid, text) TO service_role;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('tenant_plan_state', '0239', 'the company''s plan, closed features, limits'),
  ('super_plans_list', '0239', 'plans (super)'), ('super_plan_save', '0239', 'plans (super)'), ('super_plan_delete', '0239', 'plans (super)'),
  ('super_tenant_subscription_get', '0239', 'subscription (super)'), ('super_tenant_subscription_set', '0239', 'subscription (super)'),
  ('super_tenant_subscription_pay', '0239', 'subscription paid (super)'), ('super_subscriptions_overview', '0239', 'subscriptions (super)')
ON CONFLICT DO NOTHING;

DO $c$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'subscription-reminders';
  PERFORM cron.schedule('subscription-reminders', '7 7 * * *', 'SELECT public.subscription_reminders()');
END $c$;

DO $l$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.background_jobs_status__all(uuid)'::regprocedure);
  IF strpos(d, 'subscription-reminders') > 0 THEN RETURN; END IF;
  n := replace(d, $a$    ('job-failure-alerts',$a$,
    $b$    ('subscription-reminders',     'تنبيهات نهاية الاشتراك',               'هيتعاد لوحده بكره الصبح'),
    ('job-failure-alerts',$b$);
  IF n = d THEN RAISE EXCEPTION '0239: job labels anchor not found'; END IF;
  EXECUTE n;
END $l$;

SELECT public.subscription_sync_limits('5316fbfe-b862-4c91-b48b-1d81c8aa5a71');

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN
    RAISE EXCEPTION '0239: exposed definer functions: %', (SELECT string_agg(f::text, ', ') FROM public.security_exposed_definer_functions() f);
  END IF;
END $chk$;
