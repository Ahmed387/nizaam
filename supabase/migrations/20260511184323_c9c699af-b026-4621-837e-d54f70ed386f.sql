
-- 1) Add suspension columns to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

-- 2) Helper: is current user's tenant suspended?
CREATE OR REPLACE FUNCTION public.current_tenant_is_suspended()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_suspended FROM public.tenants WHERE id = public.current_tenant_id()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_tenant_is_suspended() TO authenticated, anon;

-- 3) Block writes from suspended tenants on critical tables (super_admin always allowed)
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'invoices','invoice_items','returns','return_items','shipments','shipment_items',
    'products','expenses','treasury','treasury_transfers','stock_transfers',
    'salaries','advances','advance_payments','advance_requests','supplier_payments',
    'customers','suppliers','employees','branches','categories','price_list','settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS suspended_block_write ON public.%I', tbl);
    EXECUTE format($p$
      CREATE POLICY suspended_block_write ON public.%I
      AS RESTRICTIVE
      FOR ALL
      TO public
      USING (public.is_super_admin(auth.uid()) OR NOT public.current_tenant_is_suspended())
      WITH CHECK (public.is_super_admin(auth.uid()) OR NOT public.current_tenant_is_suspended())
    $p$, tbl);
  END LOOP;
END $$;

-- 4) Accountant role: ensure exists in enum (skip if already there)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
                 WHERE t.typname = 'app_role' AND e.enumlabel = 'accountant') THEN
    ALTER TYPE public.app_role ADD VALUE 'accountant';
  END IF;
END $$;
