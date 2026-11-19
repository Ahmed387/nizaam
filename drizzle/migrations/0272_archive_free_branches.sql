-- 0272 historical archive takes «سهل» files of any branch (owner 2026-11-19: «فروع الارشيف خليها حرة اتوماتيك بناءا علي
-- الشيت»). The archive stays OUTSIDE the system: no till, books, stock or ledger reads it.
--  * branch_name is free text (the three fixed names were a CHECK) — read from the file name, editable before upload.
--  * unique keys include the company (two companies with a branch of the same name never overwrite each other).
--  * historical_archive_files: one row per uploaded file (SHA-256) — the same file is never loaded twice.
--  * historical_branch_id_for matches a free name to today's branch by its words («سكة تله» → «معرض سكة  تلة»),
--    NULL when nothing matches (the row stays visible to the owner / central readers only).

ALTER TABLE public.historical_invoices DROP CONSTRAINT IF EXISTS historical_invoices_branch_name_check;
ALTER TABLE public.historical_invoice_items DROP CONSTRAINT IF EXISTS historical_invoice_items_branch_name_check;
ALTER TABLE public.historical_vouchers DROP CONSTRAINT IF EXISTS historical_vouchers_branch_name_check;
ALTER TABLE public.historical_invoices ADD CONSTRAINT historical_invoices_branch_name_chk CHECK (length(btrim(branch_name)) BETWEEN 1 AND 120);
ALTER TABLE public.historical_invoice_items ADD CONSTRAINT historical_invoice_items_branch_name_chk CHECK (length(btrim(branch_name)) BETWEEN 1 AND 120);
ALTER TABLE public.historical_vouchers ADD CONSTRAINT historical_vouchers_branch_name_chk CHECK (length(btrim(branch_name)) BETWEEN 1 AND 120);

ALTER TABLE public.historical_invoices DROP CONSTRAINT IF EXISTS unique_historical_invoice;
ALTER TABLE public.historical_invoices ADD CONSTRAINT unique_historical_invoice UNIQUE (tenant_id, branch_name, doc_type, invoice_no, date);
ALTER TABLE public.historical_vouchers DROP CONSTRAINT IF EXISTS unique_historical_voucher;
ALTER TABLE public.historical_vouchers ADD CONSTRAINT unique_historical_voucher UNIQUE (tenant_id, branch_name, voucher_type, voucher_no, date, amount);
CREATE INDEX IF NOT EXISTS historical_invoices_tenant_branch_date ON public.historical_invoices (tenant_id, branch_name, doc_type, date);
CREATE INDEX IF NOT EXISTS historical_vouchers_tenant_branch_date ON public.historical_vouchers (tenant_id, branch_name, voucher_type, date);

CREATE OR REPLACE FUNCTION public.historical_name_key(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT btrim(regexp_replace(regexp_replace(translate(coalesce(p, ''), 'ةىأإآ', 'هيااا'),
           '(^|\s)(معرض|مخزن|مكتب|فرع|و)(\s|$)', ' ', 'g'), '\s+', ' ', 'g'))
$f$;

CREATE OR REPLACE FUNCTION public.historical_branch_id_for(p_name text)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT b.id FROM public.branches b
   WHERE b.is_system = false
     AND (public.current_tenant_id() IS NULL OR b.tenant_id = public.current_tenant_id())
     AND (    trim(b.name) = trim(p_name)
          OR (p_name ILIKE '%عبد المنعم%' AND b.name ILIKE '%عبدالمنعم%')
          OR (p_name ILIKE '%شلبي%' AND b.name ILIKE '%شلبى%')
          OR (length(public.historical_name_key(p_name)) >= 3
              AND (replace(public.historical_name_key(b.name), ' ', '') LIKE '%' || replace(public.historical_name_key(p_name), ' ', '') || '%'
                   OR replace(public.historical_name_key(p_name), ' ', '') LIKE '%' || replace(public.historical_name_key(b.name), ' ', '') || '%')))
   ORDER BY (trim(b.name) = trim(p_name)) DESC
   LIMIT 1
$function$;

CREATE TABLE IF NOT EXISTS public.historical_archive_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_name text NOT NULL,
  branch_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sales', 'purchases', 'sales_returns', 'purchase_returns', 'expense', 'receipt')),
  date_from date, date_to date,
  rows_count integer NOT NULL DEFAULT 0,
  replaced_count integer NOT NULL DEFAULT 0,
  uploaded_by uuid DEFAULT auth.uid(),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);
ALTER TABLE public.historical_archive_files ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.historical_archive_files TO authenticated;
CREATE POLICY haf_select ON public.historical_archive_files FOR SELECT TO authenticated USING (
  (SELECT is_super_admin((SELECT auth.uid()))) OR (tenant_id = (SELECT current_tenant_id()) AND (SELECT has_central_access((SELECT auth.uid())))));
CREATE POLICY haf_insert ON public.historical_archive_files FOR INSERT TO authenticated WITH CHECK (
  (SELECT is_super_admin((SELECT auth.uid()))) OR (tenant_id = (SELECT current_tenant_id()) AND (SELECT is_admin((SELECT auth.uid())))));
CREATE POLICY haf_delete ON public.historical_archive_files FOR DELETE TO authenticated USING (
  (SELECT is_super_admin((SELECT auth.uid()))) OR (tenant_id = (SELECT current_tenant_id()) AND (SELECT is_owner((SELECT auth.uid())))));
CREATE POLICY suspended_block_write ON public.historical_archive_files AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT is_super_admin((SELECT auth.uid()))) OR NOT (SELECT current_tenant_is_suspended()))
  WITH CHECK ((SELECT is_super_admin((SELECT auth.uid()))) OR NOT (SELECT current_tenant_is_suspended()));

-- the branches the archive holds (for the page's branch chips; free names, own company)
CREATE OR REPLACE FUNCTION public.historical_branches()
 RETURNS TABLE(branch_name text, docs bigint, first_day date, last_day date)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $f$
  SELECT branch_name, sum(n)::bigint, min(d1), max(d2) FROM (
    SELECT branch_name, count(*) n, min(date) d1, max(date) d2 FROM public.historical_invoices GROUP BY 1
    UNION ALL
    SELECT branch_name, count(*), min(date), max(date) FROM public.historical_vouchers GROUP BY 1) x
  GROUP BY 1 ORDER BY 2 DESC
$f$;
GRANT EXECUTE ON FUNCTION public.historical_branches() TO authenticated;
