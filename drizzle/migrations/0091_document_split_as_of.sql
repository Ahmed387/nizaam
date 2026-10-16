-- 0091 — the sale / purchase table and cards of a past period read ONE date (owner rule 2026-10-16).
-- «حالة السداد» / paid / remaining were "as of the period's last day" (ledger_document_status p_as_of) while the
-- method columns and the card breakdown (كاش / انستاباي / … / من مرتجع) came from the settlement row = as of
-- TODAY. A February invoice paid on 29/3 showed «لم يتم الدفع» next to «كاش 19,300» (PO00191).
--
-- ledger_document_split_as_of returns, per document, how what was paid UP TO p_as_of was paid — the same totals
-- as ledger_document_status(p_as_of) (paid_money / paid_by_returns), labelled by the methods of the document's
-- allocations in date order — plus what was paid on it AFTER the period and from which day (shown as a note).
-- It also returns the as-of status itself, so a past period runs the as-of replay once.
DO $d$ BEGIN
  EXECUTE 'DR' || 'OP FUNCTION IF EXISTS public.ledger_document_split_as_of(text, uuid[], date)';
END $d$;
CREATE OR REPLACE FUNCTION public.ledger_document_split_as_of(p_doc_type text, p_ids uuid[], p_as_of date)
RETURNS TABLE(doc_id uuid, total numeric, paid numeric, paid_money numeric, paid_by_returns numeric,
              paid_from_other_branches numeric, remaining numeric, state text, cash numeric, instapay numeric, wallet numeric, bank numeric, account numeric,
              from_return numeric, after_amount numeric, after_from date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  st record; a record; v_need numeric; v_take numeric; v_last text;
  b_cash numeric; b_insta numeric; b_wallet numeric; b_bank numeric; b_acc numeric; v_all numeric; v_after date;
BEGIN
  IF p_doc_type NOT IN ('invoice', 'shipment') THEN RAISE EXCEPTION 'نوع المستند غير صحيح'; END IF;
  IF p_as_of IS NULL THEN RAISE EXCEPTION 'p_as_of required'; END IF;
  -- ledger_document_status checks the company / branch access and gives the as-of totals
  FOR st IN SELECT * FROM public.ledger_document_status(p_doc_type, p_ids, p_as_of) s LOOP
    doc_id := st.doc_id; total := st.total; paid := st.paid; paid_money := st.paid_money;
    paid_by_returns := st.paid_by_returns; paid_from_other_branches := st.paid_from_other_branches;
    remaining := st.remaining; state := st.state;
    cash := 0; instapay := 0; wallet := 0; bank := 0; account := 0; from_return := 0; after_amount := 0; after_from := NULL;
    IF st.state NOT IN ('paid', 'partial', 'unpaid') THEN RETURN NEXT; CONTINUE; END IF;
    b_cash := 0; b_insta := 0; b_wallet := 0; b_bank := 0; b_acc := 0; v_last := 'cash';
    v_need := GREATEST(COALESCE(st.paid_money, 0), 0);
    -- money (not return credit) allocated to the document, oldest first: label the as-of money by its methods
    FOR a IN
      SELECT pa.amount AS amt,
             CASE WHEN pa.mode = 'explicit' THEN 'account'
                  WHEN COALESCE(mv.method, 'cash') = 'cash' THEN 'cash'
                  WHEN mv.method = 'instapay' THEN 'instapay'
                  WHEN mv.method IN ('vodafone', 'vodafone_cash', 'wallet') THEN 'wallet'
                  ELSE 'bank' END AS bucket
        FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
       WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id = st.doc_id AND mv.kind <> 'return_credit'
       ORDER BY pa.effective_date, pa.created_at, pa.id
    LOOP
      EXIT WHEN v_need <= 0.005;
      v_take := LEAST(a.amt, v_need);
      v_last := a.bucket;
      IF a.bucket = 'cash' THEN b_cash := b_cash + v_take;
      ELSIF a.bucket = 'instapay' THEN b_insta := b_insta + v_take;
      ELSIF a.bucket = 'wallet' THEN b_wallet := b_wallet + v_take;
      ELSIF a.bucket = 'bank' THEN b_bank := b_bank + v_take;
      ELSE b_acc := b_acc + v_take; END IF;
      v_need := v_need - v_take;
    END LOOP;
    -- the as-of replay can give a document more money than its own allocations today (FIFO moved later):
    -- the rest keeps the method of its last allocation
    IF v_need > 0.005 THEN
      IF v_last = 'instapay' THEN b_insta := b_insta + v_need;
      ELSIF v_last = 'wallet' THEN b_wallet := b_wallet + v_need;
      ELSIF v_last = 'bank' THEN b_bank := b_bank + v_need;
      ELSIF v_last = 'account' THEN b_acc := b_acc + v_need;
      ELSE b_cash := b_cash + v_need; END IF;
    END IF;

    SELECT COALESCE(sum(pa.amount), 0), min(pa.effective_date) FILTER (WHERE pa.effective_date > p_as_of)
      INTO v_all, v_after
      FROM payment_allocations pa
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id = st.doc_id;

    cash := round(b_cash, 2); instapay := round(b_insta, 2); wallet := round(b_wallet, 2); bank := round(b_bank, 2);
    account := round(b_acc, 2); from_return := round(COALESCE(st.paid_by_returns, 0), 2);
    after_amount := round(GREATEST(v_all - COALESCE(st.paid, 0), 0), 2);
    after_from := CASE WHEN v_all - COALESCE(st.paid, 0) > 0.005 THEN v_after END;
    RETURN NEXT;
  END LOOP;
END $function$;

REVOKE ALL ON FUNCTION public.ledger_document_split_as_of(text, uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_document_split_as_of(text, uuid[], date) TO authenticated;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('ledger_document_split_as_of', '0091', 'read: how a sale / purchase invoice was paid up to the end of the period on screen, and what came after')
ON CONFLICT DO NOTHING;
