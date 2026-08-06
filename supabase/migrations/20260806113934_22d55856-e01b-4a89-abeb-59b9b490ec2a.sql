CREATE OR REPLACE FUNCTION public.post_invoice_cogs(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  inv RECORD;
  v_cogs_total numeric := 0;
  v_cogs_acct uuid;
  v_inv_acct uuid;
  v_entry_id uuid;
  v_entry_no text;
  v_existing uuid;
BEGIN
  SELECT i.id, i.tenant_id, i.branch_id, i.invoice_number, i.created_at::date AS entry_date, i.status
    INTO inv
    FROM public.invoices i
    WHERE i.id = p_invoice_id;

  IF NOT FOUND OR inv.status <> 'active' THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
           COALESCE(NULLIF(unit_cost_at_sale, 0), NULLIF(cost_price, 0), 0)
           * COALESCE(net_quantity, quantity - COALESCE(returned_quantity, 0))
         ), 0)
    INTO v_cogs_total
    FROM public.invoice_items
    WHERE invoice_id = inv.id;

  SELECT id INTO v_cogs_acct FROM public.chart_of_accounts
    WHERE tenant_id = inv.tenant_id AND code = '5100' LIMIT 1;
  SELECT id INTO v_inv_acct FROM public.chart_of_accounts
    WHERE tenant_id = inv.tenant_id AND code = '1300' LIMIT 1;

  IF v_cogs_acct IS NULL OR v_inv_acct IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_existing FROM public.journal_entries
    WHERE source_type = 'invoice_cogs' AND source_id = inv.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entry_lines WHERE entry_id = v_existing;
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF v_cogs_total <= 0 THEN
    RETURN;
  END IF;

  v_entry_no := 'COGS-' || inv.invoice_number;

  INSERT INTO public.journal_entries (tenant_id, branch_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit)
  VALUES (inv.tenant_id, inv.branch_id, v_entry_no, inv.entry_date,
          'تكلفة بضاعة مباعة — فاتورة ' || inv.invoice_number,
          'invoice_cogs', inv.id, 'posted', v_cogs_total, v_cogs_total)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES
    (inv.tenant_id, v_entry_id, v_cogs_acct, v_cogs_total, 0, 'COGS — ' || inv.invoice_number, 1),
    (inv.tenant_id, v_entry_id, v_inv_acct, 0, v_cogs_total, 'Inventory out — ' || inv.invoice_number, 2);
END;
$function$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status = 'active' LOOP
    PERFORM public.post_invoice_cogs(r.id);
  END LOOP;
END $$;