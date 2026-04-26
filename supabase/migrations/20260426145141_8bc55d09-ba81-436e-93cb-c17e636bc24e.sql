CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_count FROM public.branches WHERE tenant_id = NEW.tenant_id;

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'وصلت للحد الأقصى من الفروع (3 فروع لكل شركة)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_branch_limit_trg ON public.branches;
CREATE TRIGGER enforce_branch_limit_trg
BEFORE INSERT ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_limit();