CREATE OR REPLACE FUNCTION public.je_fill_branch_from_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_b uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL OR NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  CASE NEW.source_type
    WHEN 'invoice' THEN
      SELECT branch_id INTO v_b FROM public.invoices WHERE id = NEW.source_id;
    WHEN 'invoice_payment' THEN
      SELECT i.branch_id INTO v_b FROM public.invoice_payments ip
        JOIN public.invoices i ON i.id = ip.invoice_id WHERE ip.id = NEW.source_id;
    WHEN 'voucher', 'voucher_reversal' THEN
      SELECT branch_id INTO v_b FROM public.vouchers WHERE id = NEW.source_id;
    WHEN 'shipment' THEN
      SELECT branch_id INTO v_b FROM public.shipments WHERE id = NEW.source_id;
    WHEN 'return', 'sale_return' THEN
      SELECT branch_id INTO v_b FROM public.returns WHERE id = NEW.source_id;
    WHEN 'purchase_return' THEN
      SELECT branch_id INTO v_b FROM public.purchase_returns WHERE id = NEW.source_id;
    WHEN 'expense' THEN
      SELECT branch_id INTO v_b FROM public.expenses WHERE id = NEW.source_id;
    WHEN 'inventory_session' THEN
      SELECT branch_id INTO v_b FROM public.inventory_sessions WHERE id = NEW.source_id;
    ELSE
      v_b := NULL;
  END CASE;

  NEW.branch_id := v_b;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_je_fill_branch ON public.journal_entries;
CREATE TRIGGER trg_je_fill_branch
BEFORE INSERT ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.je_fill_branch_from_source();

-- Backfill existing entries
UPDATE public.journal_entries je SET branch_id = i.branch_id
FROM public.invoices i WHERE je.branch_id IS NULL AND je.source_type = 'invoice' AND i.id = je.source_id;

UPDATE public.journal_entries je SET branch_id = i.branch_id
FROM public.invoice_payments ip JOIN public.invoices i ON i.id = ip.invoice_id
WHERE je.branch_id IS NULL AND je.source_type = 'invoice_payment' AND ip.id = je.source_id;

UPDATE public.journal_entries je SET branch_id = v.branch_id
FROM public.vouchers v WHERE je.branch_id IS NULL AND je.source_type IN ('voucher','voucher_reversal') AND v.id = je.source_id;

UPDATE public.journal_entries je SET branch_id = s.branch_id
FROM public.shipments s WHERE je.branch_id IS NULL AND je.source_type = 'shipment' AND s.id = je.source_id;

UPDATE public.journal_entries je SET branch_id = r.branch_id
FROM public.returns r WHERE je.branch_id IS NULL AND je.source_type IN ('return','sale_return') AND r.id = je.source_id;

UPDATE public.journal_entries je SET branch_id = pr.branch_id
FROM public.purchase_returns pr WHERE je.branch_id IS NULL AND je.source_type = 'purchase_return' AND pr.id = je.source_id;

UPDATE public.journal_entries je SET branch_id = e.branch_id
FROM public.expenses e WHERE je.branch_id IS NULL AND je.source_type = 'expense' AND e.id = je.source_id;

UPDATE public.journal_entries je SET branch_id = s.branch_id
FROM public.inventory_sessions s WHERE je.branch_id IS NULL AND je.source_type = 'inventory_session' AND s.id = je.source_id;