CREATE OR REPLACE FUNCTION public.contact_has_legacy_docs(p_contact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.invoices WHERE contact_id = p_contact AND migration_batch_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.shipments WHERE contact_id = p_contact AND migration_batch_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.purchase_returns WHERE contact_id = p_contact AND migration_batch_id IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.guard_contact_opening_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.opening_balance,0) <> 0
     AND COALESCE(NEW.opening_balance,0) IS DISTINCT FROM COALESCE(OLD.opening_balance,0)
     AND public.contact_has_legacy_docs(NEW.id) THEN
    RAISE EXCEPTION '% له/عليه فواتير تاريخية مسجّلة بالفعل، مينفعش تضيفله رصيد افتتاحي كمان عشان الدين هيتحسب مرتين.', NEW.name;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_contact_opening_balance ON public.contacts;
CREATE TRIGGER trg_guard_contact_opening_balance
BEFORE UPDATE OF opening_balance ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.guard_contact_opening_balance();

CREATE OR REPLACE FUNCTION public.guard_legacy_doc_vs_opening()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text; v_bal numeric;
BEGIN
  IF NEW.migration_batch_id IS NOT NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT name, COALESCE(opening_balance,0) INTO v_name, v_bal FROM public.contacts WHERE id = NEW.contact_id;
    IF COALESCE(v_bal,0) <> 0 THEN
      RAISE EXCEPTION '% مسجّل له رصيد افتتاحي إجمالي بالفعل، امسح الرصيد الافتتاحي الأول قبل ما ترحّل له فواتير تاريخية عشان الدين ميتحسبش مرتين.', v_name;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_legacy_invoice ON public.invoices;
CREATE TRIGGER trg_guard_legacy_invoice BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_doc_vs_opening();

DROP TRIGGER IF EXISTS trg_guard_legacy_shipment ON public.shipments;
CREATE TRIGGER trg_guard_legacy_shipment BEFORE INSERT ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_doc_vs_opening();

DROP TRIGGER IF EXISTS trg_guard_legacy_purchase_return ON public.purchase_returns;
CREATE TRIGGER trg_guard_legacy_purchase_return BEFORE INSERT ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_doc_vs_opening();