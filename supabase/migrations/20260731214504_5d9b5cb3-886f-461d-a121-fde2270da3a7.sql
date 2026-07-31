CREATE OR REPLACE FUNCTION public.trg_invoice_journal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_net NUMERIC(18,2); v_lines JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    v_net := COALESCE(NEW.total,0) - COALESCE(NEW.vat_amount,0);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1200','debit',NEW.total,'credit',0,'description','Invoice '||NEW.invoice_number),
      jsonb_build_object('account_code','4100','debit',0,'credit',v_net,'description','Sales revenue'),
      jsonb_build_object('account_code','2200','debit',0,'credit',COALESCE(NEW.vat_amount,0),'description','VAT payable')
    );
    PERFORM public.post_journal(NEW.tenant_id, NEW.invoice_date::date, 'Sale Invoice '||NEW.invoice_number,
      'invoice', NEW.id, v_lines);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'invoice', NEW.id,
      'Invoice '||NEW.invoice_number||' cancelled');
  END IF;
  RETURN NEW;
END $function$;