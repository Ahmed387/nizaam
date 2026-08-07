-- 1) Capital allocation now actually moves cash out of the partner treasury
CREATE OR REPLACE FUNCTION public.allocate_capital_to_branch(
  _branch_id uuid, _amount numeric, _allocation_date date DEFAULT CURRENT_DATE, _notes text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid;
  _id uuid;
  _partner_branch uuid;
  _available numeric;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.branches WHERE id = _branch_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF _tenant <> current_tenant_id() THEN RAISE EXCEPTION 'Branch not in tenant'; END IF;
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'accountant')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF COALESCE(_amount,0) <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF _allocation_date > CURRENT_DATE THEN RAISE EXCEPTION 'مينفعش تاريخ في المستقبل'; END IF;

  SELECT id INTO _partner_branch FROM public.branches
   WHERE tenant_id = _tenant AND is_system AND code = 'PARTNER-CASH' LIMIT 1;
  IF _partner_branch IS NULL THEN RAISE EXCEPTION 'خزينة الشركاء غير موجودة'; END IF;
  IF _partner_branch = _branch_id THEN RAISE EXCEPTION 'مينفعش تضخ رأس مال لخزينة الشركاء نفسها'; END IF;

  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO _available
    FROM public.treasury
   WHERE branch_id = _partner_branch AND payment_method = 'cash';

  IF _available < _amount THEN
    RAISE EXCEPTION 'رصيد خزينة الشركاء غير كافٍ — المتاح: % ج.م', ROUND(_available,2);
  END IF;

  INSERT INTO public.branch_capital_allocations(tenant_id, branch_id, amount, allocation_date, notes, created_by)
  VALUES (_tenant, _branch_id, _amount, _allocation_date, _notes, auth.uid())
  RETURNING id INTO _id;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id)
  VALUES (_partner_branch, 'expense', 'capital_allocation', _amount,
          'ضخ رأس مال لفرع', auth.uid(), _tenant, 'cash', _id);

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id)
  VALUES (_branch_id, 'income', 'capital_allocation', _amount,
          'رأس مال من الشركاء', auth.uid(), _tenant, 'cash', _id);

  RETURN _id;
END; $function$;

-- 2) Block ordinary branch-to-branch transfers touching the system (partner) treasury
CREATE OR REPLACE FUNCTION public.guard_transfer_no_system_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.branches b
              WHERE b.id IN (NEW.from_branch_id, NEW.to_branch_id) AND b.is_system) THEN
    RAISE EXCEPTION 'خزينة الشركاء مش فرع عادي — استخدم شاشة رأس مال الفروع لضخ أو سحب رأس المال';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_transfer_no_system_branch ON public.treasury_transfers;
CREATE TRIGGER trg_guard_transfer_no_system_branch
BEFORE INSERT ON public.treasury_transfers
FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_no_system_branch();

-- 3) No future-dated vouchers
CREATE OR REPLACE FUNCTION public.guard_voucher_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.voucher_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'مينفعش تسجّل سند بتاريخ في المستقبل';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_voucher_date ON public.vouchers;
CREATE TRIGGER trg_guard_voucher_date
BEFORE INSERT OR UPDATE OF voucher_date ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.guard_voucher_date();