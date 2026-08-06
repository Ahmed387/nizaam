-- Remove the half-transfers created during the E2E test (no sender deduction)
DELETE FROM public.treasury WHERE reference_id IN (
  SELECT id FROM public.treasury_transfers
  WHERE reason IN ('E2E تحويل','E2E فوق الرصيد')
);
DELETE FROM public.treasury WHERE description = 'تحويل وارد: E2E تحويل';
DELETE FROM public.treasury_transfers WHERE reason IN ('E2E تحويل','E2E فوق الرصيد');

-- Guard: only SECURITY DEFINER flows (transfer_treasury_atomic) may create transfers
CREATE OR REPLACE FUNCTION public.guard_treasury_transfer_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.transfer_ctx', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'مينفعش تسجّل تحويل خزنة مباشر — استخدم شاشة التحويل عشان الفلوس تتخصم من الفرع المرسِل'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_treasury_transfer_insert ON public.treasury_transfers;
CREATE TRIGGER trg_guard_treasury_transfer_insert
BEFORE INSERT ON public.treasury_transfers
FOR EACH ROW EXECUTE FUNCTION public.guard_treasury_transfer_insert();