
-- ============================================================
-- COGS automation: auto-post Dr COGS / Cr Inventory per invoice
-- ============================================================

CREATE OR REPLACE FUNCTION public.post_invoice_cogs(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Total COGS = sum(unit_cost_at_sale * net_quantity)
  SELECT COALESCE(SUM(COALESCE(unit_cost_at_sale, cost_price, 0) * COALESCE(net_quantity, quantity - COALESCE(returned_quantity,0))), 0)
    INTO v_cogs_total
    FROM public.invoice_items
    WHERE invoice_id = inv.id;

  -- Resolve accounts (tenant-scoped)
  SELECT id INTO v_cogs_acct FROM public.chart_of_accounts
    WHERE tenant_id = inv.tenant_id AND code = '5100' LIMIT 1;
  SELECT id INTO v_inv_acct FROM public.chart_of_accounts
    WHERE tenant_id = inv.tenant_id AND code = '1300' LIMIT 1;

  IF v_cogs_acct IS NULL OR v_inv_acct IS NULL THEN
    RETURN; -- accounts not configured for this tenant
  END IF;

  -- Delete any existing COGS entry for this invoice (rebuild)
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
$$;

-- Trigger on invoice_items to (re)post COGS for the parent invoice
CREATE OR REPLACE FUNCTION public.trg_invoice_items_cogs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice uuid;
BEGIN
  v_invoice := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_invoice IS NOT NULL THEN
    PERFORM public.post_invoice_cogs(v_invoice);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_items_cogs_aiud ON public.invoice_items;
CREATE TRIGGER trg_invoice_items_cogs_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_items_cogs();

-- Also react to invoice status changes (cancel/reactivate)
CREATE OR REPLACE FUNCTION public.trg_invoice_status_cogs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      PERFORM public.post_invoice_cogs(NEW.id);
    ELSE
      -- non-active: remove COGS entry
      DELETE FROM public.journal_entry_lines
        WHERE entry_id IN (SELECT id FROM public.journal_entries
                           WHERE source_type='invoice_cogs' AND source_id=NEW.id);
      DELETE FROM public.journal_entries
        WHERE source_type='invoice_cogs' AND source_id=NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_status_cogs_au ON public.invoices;
CREATE TRIGGER trg_invoice_status_cogs_au
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_status_cogs();

-- Backfill for all existing active invoices
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status = 'active' LOOP
    PERFORM public.post_invoice_cogs(r.id);
  END LOOP;
END $$;
