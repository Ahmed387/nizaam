-- 1) Manual vouchers: cash box line inherits voucher_date (only new inserts)
CREATE OR REPLACE FUNCTION public.voucher_sync_treasury_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.source = 'manual' AND NEW.treasury_id IS NOT NULL
     AND NEW.voucher_date <> (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    UPDATE public.treasury
       SET created_at = (NEW.voucher_date + time '12:00') AT TIME ZONE 'Africa/Cairo'
     WHERE id = NEW.treasury_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_voucher_sync_treasury_date ON public.vouchers;
CREATE TRIGGER trg_voucher_sync_treasury_date AFTER INSERT ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.voucher_sync_treasury_date();

-- 2) Returns: date guards (new rows / date changes only)
CREATE OR REPLACE FUNCTION public.guard_return_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_orig timestamptz; v_ret date; v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice_date IS NOT DISTINCT FROM OLD.invoice_date THEN RETURN NEW; END IF;
  IF NEW.migration_batch_id IS NOT NULL THEN RETURN NEW; END IF;
  v_ret := (NEW.invoice_date AT TIME ZONE 'Africa/Cairo')::date;
  IF v_ret > v_today THEN
    RAISE EXCEPTION 'مينفعش تسجّل مرتجع بتاريخ في المستقبل';
  END IF;
  IF TG_TABLE_NAME = 'returns' THEN
    SELECT invoice_date INTO v_orig FROM public.invoices WHERE id = NEW.invoice_id;
  ELSE
    SELECT invoice_date INTO v_orig FROM public.shipments WHERE id = NEW.shipment_id;
  END IF;
  IF v_orig IS NOT NULL AND v_ret < (v_orig AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'لا يمكن تسجيل مرتجع بتاريخ يسبق تاريخ الفاتورة الأصلية';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_return_dates ON public.returns;
CREATE TRIGGER trg_guard_return_dates BEFORE INSERT OR UPDATE OF invoice_date ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.guard_return_dates();
DROP TRIGGER IF EXISTS trg_guard_return_dates ON public.purchase_returns;
CREATE TRIGGER trg_guard_return_dates BEFORE INSERT OR UPDATE OF invoice_date ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.guard_return_dates();

-- 3) Refund cash box lines use the return date
CREATE OR REPLACE FUNCTION public.process_return_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_cash_out numeric; v_ts timestamptz;
BEGIN
  v_cash_out := COALESCE(NEW.refund_cash_amount, 0) + COALESCE(NEW.refund_transfer_amount, 0);
  IF COALESCE(NEW.status, 'active') = 'active' AND v_cash_out > 0 THEN
    v_ts := CASE WHEN NEW.invoice_date IS NULL
                   OR (NEW.invoice_date AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date
                 THEN now() ELSE NEW.invoice_date END;
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id, payment_method, reference_number, transfer_to_account, created_at)
    VALUES (NEW.branch_id, 'expense', 'return', v_cash_out, 'مرتجع فاتورة', NEW.id, NEW.created_by, NEW.tenant_id,
            NEW.refund_method, NEW.refund_reference, NEW.refund_account, v_ts);
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.process_purchase_return_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_in numeric; v_ts timestamptz;
BEGIN
  v_in := COALESCE(NEW.refund_cash_amount, 0) + COALESCE(NEW.refund_transfer_amount, 0);
  IF COALESCE(NEW.status, 'active') = 'active' AND v_in > 0 THEN
    v_ts := CASE WHEN NEW.invoice_date IS NULL
                   OR (NEW.invoice_date AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date
                 THEN now() ELSE NEW.invoice_date END;
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id,
                                created_by, tenant_id, payment_method, reference_number, transfer_from_account, created_at)
    VALUES (NEW.branch_id, 'income', 'purchase_return', v_in,
            'مرتجع شراء ' || COALESCE(NEW.return_number, ''), NEW.id, NEW.created_by, NEW.tenant_id,
            NEW.refund_method, NEW.refund_reference, NEW.refund_account, v_ts);
  END IF;
  RETURN NEW;
END $function$;

-- 4) Transfers: operational date
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS transfer_date date;
UPDATE public.stock_transfers SET transfer_date = (created_at AT TIME ZONE 'Africa/Cairo')::date WHERE transfer_date IS NULL;
ALTER TABLE public.stock_transfers ALTER COLUMN transfer_date SET DEFAULT ((now() AT TIME ZONE 'Africa/Cairo')::date);

DROP TRIGGER IF EXISTS trg_stock_transfers_closed_period_guard ON public.stock_transfers;
CREATE TRIGGER trg_stock_transfers_closed_period_guard BEFORE INSERT OR UPDATE OF transfer_date ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.enforce_closed_period_doc_guard('transfer_date');

CREATE OR REPLACE FUNCTION public.set_transfer_group_date(p_group_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_from uuid; v_n int; v_short jsonb;
BEGIN
  IF NOT (is_admin(auth.uid()) OR is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'تعديل تاريخ التحويل متاح للإدارة فقط';
  END IF;
  IF p_date > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'مينفعش تسجّل تحويل بتاريخ في المستقبل';
  END IF;
  SELECT from_branch_id INTO v_from FROM stock_transfers
   WHERE (group_id = p_group_id OR id = p_group_id) AND tenant_id = current_tenant_id() LIMIT 1;
  IF v_from IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  UPDATE stock_transfers SET transfer_date = p_date
   WHERE (group_id = p_group_id OR id = p_group_id) AND tenant_id = current_tenant_id();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_n);
END $$;
REVOKE ALL ON FUNCTION public.set_transfer_group_date(uuid, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_transfer_group_date(uuid, date) TO authenticated;