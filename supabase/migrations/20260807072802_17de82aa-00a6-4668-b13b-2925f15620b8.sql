ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
UPDATE public.branches SET is_system = true WHERE code = 'PARTNER-CASH';

CREATE OR REPLACE FUNCTION public.block_system_branch_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.is_system
  ) THEN
    RAISE EXCEPTION 'خزينة الشركاء فرع نظامي — مينفعش تسجّل عليه بيع أو شراء أو حضور أو وردية';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_sys_branch ON public.invoices;
CREATE TRIGGER trg_block_sys_branch BEFORE INSERT OR UPDATE OF branch_id ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.block_system_branch_activity();

DROP TRIGGER IF EXISTS trg_block_sys_branch ON public.shipments;
CREATE TRIGGER trg_block_sys_branch BEFORE INSERT OR UPDATE OF branch_id ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.block_system_branch_activity();

DROP TRIGGER IF EXISTS trg_block_sys_branch ON public.attendance;
CREATE TRIGGER trg_block_sys_branch BEFORE INSERT OR UPDATE OF branch_id ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.block_system_branch_activity();

DROP TRIGGER IF EXISTS trg_block_sys_branch ON public.cashier_shifts;
CREATE TRIGGER trg_block_sys_branch BEFORE INSERT OR UPDATE OF branch_id ON public.cashier_shifts
FOR EACH ROW EXECUTE FUNCTION public.block_system_branch_activity();