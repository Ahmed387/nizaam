-- 1) Clean orphaned journal entries (lines cascade)
DELETE FROM public.journal_entries je
WHERE (je.source_type = 'partner_transaction' AND je.source_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.partner_transactions t WHERE t.id = je.source_id))
   OR (je.source_type = 'invoice_payment' AND je.source_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.invoice_payments p WHERE p.id = je.source_id))
   OR (je.source_type IN ('voucher','voucher_reversal') AND je.source_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.vouchers v WHERE v.id = je.source_id));

-- 2) Auto-remove linked journal entries when a source document is deleted
CREATE OR REPLACE FUNCTION public.trg_delete_source_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'vouchers' THEN
    DELETE FROM public.journal_entries
     WHERE source_id = OLD.id AND source_type IN ('voucher','voucher_reversal');
  ELSIF TG_TABLE_NAME = 'invoice_payments' THEN
    DELETE FROM public.journal_entries
     WHERE source_id = OLD.id AND source_type = 'invoice_payment';
  ELSIF TG_TABLE_NAME = 'partner_transactions' THEN
    DELETE FROM public.journal_entries
     WHERE source_id = OLD.id AND source_type = 'partner_transaction';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_vouchers_journal_delete ON public.vouchers;
CREATE TRIGGER trg_vouchers_journal_delete
AFTER DELETE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.trg_delete_source_journal();

DROP TRIGGER IF EXISTS trg_invoice_payments_journal_delete ON public.invoice_payments;
CREATE TRIGGER trg_invoice_payments_journal_delete
AFTER DELETE ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_delete_source_journal();

DROP TRIGGER IF EXISTS trg_partner_transactions_journal_delete ON public.partner_transactions;
CREATE TRIGGER trg_partner_transactions_journal_delete
AFTER DELETE ON public.partner_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_delete_source_journal();

-- 3) Fix variance radar: cash account 1100 only, branch-scoped only
CREATE OR REPLACE VIEW public.v_treasury_gl_variance AS
WITH t AS (
  SELECT tr.tenant_id, tr.branch_id,
         sum(CASE WHEN tr.type = 'income'::treasury_type THEN tr.amount ELSE -tr.amount END) AS treasury_balance
    FROM public.treasury tr
   WHERE tr.branch_id IS NOT NULL
   GROUP BY tr.tenant_id, tr.branch_id
), g AS (
  SELECT je.tenant_id, je.branch_id,
         sum(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)) AS gl_balance
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.entry_id
    JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
   WHERE COALESCE(je.status, 'posted') = 'posted'
     AND coa.code LIKE '1100%'
     AND je.branch_id IS NOT NULL
   GROUP BY je.tenant_id, je.branch_id
)
SELECT COALESCE(t.tenant_id, g.tenant_id) AS tenant_id,
       COALESCE(t.branch_id, g.branch_id) AS branch_id,
       b.name AS branch_name,
       COALESCE(t.treasury_balance, 0) AS treasury_balance,
       COALESCE(g.gl_balance, 0) AS gl_balance,
       round(COALESCE(t.treasury_balance, 0) - COALESCE(g.gl_balance, 0), 2) AS variance
  FROM t
  FULL JOIN g ON g.tenant_id = t.tenant_id AND NOT g.branch_id IS DISTINCT FROM t.branch_id
  LEFT JOIN public.branches b ON b.id = COALESCE(t.branch_id, g.branch_id);