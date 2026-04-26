-- Trigger: enforce branch limit per tenant
CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
  v_count INT;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  SELECT max_branches INTO v_max FROM public.tenants WHERE id = NEW.tenant_id;
  SELECT count(*) INTO v_count FROM public.branches WHERE tenant_id = NEW.tenant_id;

  IF v_max IS NOT NULL AND v_count >= v_max THEN
    RAISE EXCEPTION 'وصلت للحد الأقصى من الفروع (%) في باقتك الحالية', v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_branch_limit ON public.branches;
CREATE TRIGGER trg_enforce_branch_limit
  BEFORE INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_limit();

-- Trigger: enforce product limit per tenant
CREATE OR REPLACE FUNCTION public.enforce_product_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
  v_count INT;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  SELECT max_products INTO v_max FROM public.tenants WHERE id = NEW.tenant_id;
  SELECT count(*) INTO v_count FROM public.products WHERE tenant_id = NEW.tenant_id;

  IF v_max IS NOT NULL AND v_count >= v_max THEN
    RAISE EXCEPTION 'وصلت للحد الأقصى من المنتجات (%) في باقتك الحالية', v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_product_limit ON public.products;
CREATE TRIGGER trg_enforce_product_limit
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_product_limit();

-- Trigger: enforce user limit per tenant (on profiles insert)
CREATE OR REPLACE FUNCTION public.enforce_user_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
  v_count INT;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;

  SELECT max_users INTO v_max FROM public.tenants WHERE id = NEW.tenant_id;
  SELECT count(*) INTO v_count FROM public.profiles WHERE tenant_id = NEW.tenant_id;

  IF v_max IS NOT NULL AND v_count >= v_max THEN
    RAISE EXCEPTION 'وصلت للحد الأقصى من المستخدمين (%) في باقتك الحالية', v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_limit ON public.profiles;
CREATE TRIGGER trg_enforce_user_limit
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_limit();

-- Block tenant access if inactive (extra safety)
CREATE OR REPLACE FUNCTION public.current_tenant_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_active FROM public.tenants WHERE id = public.current_tenant_id()),
    false
  )
$$;