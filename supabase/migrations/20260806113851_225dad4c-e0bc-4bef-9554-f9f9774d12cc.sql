-- 1) Reversal handling: keep both original and reversal posted so reports net to zero
CREATE OR REPLACE FUNCTION public.reverse_journal_for_source(p_tenant_id uuid, p_source_type text, p_source_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orig RECORD; v_new_id UUID; v_lines JSONB;
BEGIN
  FOR v_orig IN
    SELECT * FROM public.journal_entries
     WHERE tenant_id = p_tenant_id AND source_type = p_source_type
       AND source_id = p_source_id AND status = 'posted'
       AND reversed_by IS NULL
  LOOP
    SELECT jsonb_agg(jsonb_build_object(
      'account_code', a.code,
      'debit', l.credit,
      'credit', l.debit,
      'description', COALESCE(p_reason,'Reversal: ')||COALESCE(l.description,'')
    )) INTO v_lines
    FROM public.journal_entry_lines l
    JOIN public.chart_of_accounts a ON a.id = l.account_id
    WHERE l.entry_id = v_orig.id;

    v_new_id := public.post_journal(
      p_tenant_id, CURRENT_DATE,
      COALESCE(p_reason,'Reversal')||' — '||v_orig.entry_number,
      p_source_type||'_reversal', p_source_id, v_lines
    );

    IF v_new_id IS NOT NULL THEN
      -- keep status 'posted': the reversing entry cancels it out in every report
      UPDATE public.journal_entries SET reversed_by = v_new_id WHERE id = v_orig.id;
    END IF;
  END LOOP;
END $function$;

UPDATE public.journal_entries
   SET status = 'posted'
 WHERE status = 'reversed' AND reversed_by IS NOT NULL;

-- 2) COGS must be posted for every active invoice, not only on status change
CREATE OR REPLACE FUNCTION public.trg_invoice_cogs_ai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM public.post_invoice_cogs(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_invoices_cogs_ai ON public.invoices;
CREATE TRIGGER trg_invoices_cogs_ai
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_cogs_ai();

-- Re-post COGS when invoice items change (sales returns update net_quantity)
CREATE OR REPLACE FUNCTION public.trg_invoice_items_cogs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.post_invoice_cogs(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_invoice_items_cogs_aiud ON public.invoice_items;
CREATE TRIGGER trg_invoice_items_cogs_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_items_cogs();

-- 3) Backfill COGS for existing active invoices
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status = 'active' LOOP
    PERFORM public.post_invoice_cogs(r.id);
  END LOOP;
END $$;