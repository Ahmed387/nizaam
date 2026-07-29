-- Generic guard for documents with a single date column
CREATE OR REPLACE FUNCTION public.enforce_closed_period_doc_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_date   date;
  v_col    text := TG_ARGV[0];
  v_closed_period record;
BEGIN
  v_tenant := COALESCE(
    (CASE WHEN TG_OP='DELETE' THEN row_to_json(OLD) ELSE row_to_json(NEW) END)->>'tenant_id',
    NULL
  )::uuid;

  v_date := (
    (CASE WHEN TG_OP='DELETE' THEN row_to_json(OLD) ELSE row_to_json(NEW) END)->>v_col
  )::date;

  IF v_tenant IS NULL OR v_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- On UPDATE: if the date wasn't changed AND row already existed in closed period,
  -- still block edits (any change inside closed period is disallowed).
  SELECT id, period_start, period_end
    INTO v_closed_period
    FROM public.fiscal_periods
   WHERE tenant_id = v_tenant
     AND status = 'closed'
     AND v_date BETWEEN period_start AND period_end
   LIMIT 1;

  IF v_closed_period.id IS NOT NULL THEN
    -- Log attempt (best-effort, don't fail if audit_log unavailable)
    BEGIN
      INSERT INTO public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_tenant,
        auth.uid(),
        'closed_period_block',
        TG_TABLE_NAME,
        COALESCE((CASE WHEN TG_OP='DELETE' THEN row_to_json(OLD) ELSE row_to_json(NEW) END)->>'id', '')::uuid,
        jsonb_build_object(
          'op', TG_OP,
          'doc_date', v_date,
          'period_start', v_closed_period.period_start,
          'period_end', v_closed_period.period_end
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RAISE EXCEPTION 'لا يمكن تسجيل أو تعديل معاملات في فترة مالية مقفولة (% إلى %)',
      v_closed_period.period_start, v_closed_period.period_end
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Drop any prior versions to keep this idempotent
DROP TRIGGER IF EXISTS trg_invoices_closed_period_guard ON public.invoices;
DROP TRIGGER IF EXISTS trg_vouchers_closed_period_guard ON public.vouchers;
DROP TRIGGER IF EXISTS trg_returns_closed_period_guard ON public.returns;
DROP TRIGGER IF EXISTS trg_purchase_returns_closed_period_guard ON public.purchase_returns;

CREATE TRIGGER trg_invoices_closed_period_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.enforce_closed_period_doc_guard('invoice_date');

CREATE TRIGGER trg_vouchers_closed_period_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.enforce_closed_period_doc_guard('voucher_date');

CREATE TRIGGER trg_returns_closed_period_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.enforce_closed_period_doc_guard('invoice_date');

CREATE TRIGGER trg_purchase_returns_closed_period_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.enforce_closed_period_doc_guard('invoice_date');