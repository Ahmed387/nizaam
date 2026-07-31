CREATE OR REPLACE FUNCTION public.repost_invoice_journal(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE inv RECORD; v_net NUMERIC(18,2); v_lines JSONB;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR inv.status <> 'active' THEN RETURN; END IF;

  PERFORM public.reverse_journal_for_source(
    inv.tenant_id, 'invoice', inv.id,
    'Invoice '||inv.invoice_number||' edited — reversing old GL');

  v_net := COALESCE(inv.total,0) - COALESCE(inv.vat_amount,0);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1200','debit', inv.total, 'credit', 0, 'description','Invoice '||inv.invoice_number||' (edited)'),
    jsonb_build_object('account_code','4100','debit', 0, 'credit', v_net, 'description','Sales revenue (edited)'),
    jsonb_build_object('account_code','2200','debit', 0, 'credit', COALESCE(inv.vat_amount,0), 'description','VAT payable (edited)')
  );
  PERFORM public.post_journal(inv.tenant_id, inv.invoice_date::date,
    'Sale Invoice '||inv.invoice_number||' (edited)', 'invoice', inv.id, v_lines);

  PERFORM public.post_invoice_cogs(inv.id);
END; $function$;