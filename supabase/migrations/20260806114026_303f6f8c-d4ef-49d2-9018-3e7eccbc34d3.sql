CREATE OR REPLACE FUNCTION public.sync_shipment_journal(p_shipment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s RECORD; v_lines jsonb; v_existing uuid;
BEGIN
  SELECT id, tenant_id, invoice_date, shipment_number, total_cost
    INTO s FROM public.shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_existing FROM public.journal_entries
   WHERE source_type = 'shipment' AND source_id = s.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entry_lines WHERE entry_id = v_existing;
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF COALESCE(s.total_cost, 0) <= 0 THEN RETURN; END IF;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1300','debit',s.total_cost,'credit',0,'description','Shipment '||s.shipment_number||' inventory received'),
    jsonb_build_object('account_code','2100','debit',0,'credit',s.total_cost,'description','Shipment '||s.shipment_number||' payable to supplier')
  );
  PERFORM public.post_journal(s.tenant_id, s.invoice_date::date, 'Shipment '||s.shipment_number, 'shipment', s.id, v_lines);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_shipment_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.skip_journal', true),'') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR NEW.total_cost IS DISTINCT FROM OLD.total_cost THEN
    PERFORM public.sync_shipment_journal(NEW.id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_shipments_journal ON public.shipments;
CREATE TRIGGER trg_shipments_journal
AFTER INSERT OR UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.trg_shipment_journal();

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.shipments LOOP
    PERFORM public.sync_shipment_journal(r.id);
  END LOOP;
END $$;