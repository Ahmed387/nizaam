-- Sale return journal
CREATE OR REPLACE FUNCTION public.sync_sale_return_journal(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_existing uuid;
  v_cash numeric(18,2);
  v_balance numeric(18,2);
  v_cost numeric(18,2);
  v_lines jsonb;
BEGIN
  SELECT id, tenant_id, return_number, status, total_refund, invoice_date, created_at,
         COALESCE(refund_cash_amount,0) AS cash_amt,
         COALESCE(refund_transfer_amount,0) AS transfer_amt,
         COALESCE(refund_balance_amount,0) AS balance_amt
    INTO r FROM public.returns WHERE id = p_return_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_existing FROM public.journal_entries
   WHERE source_type = 'sale_return' AND source_id = r.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF r.status IS DISTINCT FROM 'active' OR COALESCE(r.total_refund,0) <= 0 THEN RETURN; END IF;

  v_cash := r.cash_amt + r.transfer_amt;
  v_balance := r.balance_amt;
  IF v_cash + v_balance <> r.total_refund THEN
    -- fall back: treat the whole refund as a customer balance credit
    v_cash := 0;
    v_balance := r.total_refund;
  END IF;

  SELECT COALESCE(SUM(ri.quantity * COALESCE(p.cost_price,0)),0)
    INTO v_cost
    FROM public.return_items ri
    LEFT JOIN public.products p ON p.id = ri.product_id
   WHERE ri.return_id = r.id;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','4100','debit',r.total_refund,'credit',0,'description','مرتجع مبيعات '||r.return_number)
  );
  IF v_cash > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',0,'credit',v_cash,'description','مرتجع مبيعات '||r.return_number||' — نقدي'));
  END IF;
  IF v_balance > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1200','debit',0,'credit',v_balance,'description','مرتجع مبيعات '||r.return_number||' — رصيد العميل'));
  END IF;
  IF v_cost > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code','1300','debit',v_cost,'credit',0,'description','مرتجع مبيعات '||r.return_number||' — إرجاع بضاعة للمخزون'),
      jsonb_build_object('account_code','5100','debit',0,'credit',v_cost,'description','مرتجع مبيعات '||r.return_number||' — عكس تكلفة البضاعة المباعة')
    );
  END IF;

  PERFORM public.post_journal(
    r.tenant_id,
    COALESCE(r.invoice_date, r.created_at)::date,
    'مرتجع مبيعات '||r.return_number,
    'sale_return',
    r.id,
    v_lines
  );
END $$;

CREATE OR REPLACE FUNCTION public.trg_sale_return_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('app.skip_journal', true),'') = '1' THEN RETURN NEW; END IF;
  PERFORM public.sync_sale_return_journal(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_returns_journal ON public.returns;
CREATE TRIGGER trg_returns_journal
AFTER INSERT OR UPDATE OF status, total_refund, refund_cash_amount, refund_transfer_amount, refund_balance_amount
ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.trg_sale_return_journal();

-- Purchase return journal
CREATE OR REPLACE FUNCTION public.sync_purchase_return_journal(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_existing uuid;
  v_cash numeric(18,2);
  v_credit_supplier numeric(18,2);
  v_lines jsonb;
BEGIN
  SELECT id, tenant_id, return_number, status, total_amount, invoice_date, created_at,
         COALESCE(refund_cash_amount,0) AS cash_amt,
         COALESCE(refund_transfer_amount,0) AS transfer_amt,
         COALESCE(refund_balance_amount,0) AS balance_amt
    INTO r FROM public.purchase_returns WHERE id = p_return_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_existing FROM public.journal_entries
   WHERE source_type = 'purchase_return' AND source_id = r.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF r.status IS DISTINCT FROM 'active' OR COALESCE(r.total_amount,0) <= 0 THEN RETURN; END IF;

  v_cash := r.cash_amt + r.transfer_amt;
  v_credit_supplier := r.balance_amt;
  IF v_cash + v_credit_supplier <> r.total_amount THEN
    v_cash := 0;
    v_credit_supplier := r.total_amount;
  END IF;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1300','debit',0,'credit',r.total_amount,'description','مرتجع مشتريات '||r.return_number||' — خروج بضاعة من المخزون')
  );
  IF v_cash > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',v_cash,'credit',0,'description','مرتجع مشتريات '||r.return_number||' — استرداد نقدي'));
  END IF;
  IF v_credit_supplier > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','2100','debit',v_credit_supplier,'credit',0,'description','مرتجع مشتريات '||r.return_number||' — خصم من رصيد المورد'));
  END IF;

  PERFORM public.post_journal(
    r.tenant_id,
    COALESCE(r.invoice_date, r.created_at)::date,
    'مرتجع مشتريات '||r.return_number,
    'purchase_return',
    r.id,
    v_lines
  );
END $$;

CREATE OR REPLACE FUNCTION public.trg_purchase_return_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('app.skip_journal', true),'') = '1' THEN RETURN NEW; END IF;
  PERFORM public.sync_purchase_return_journal(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_returns_journal ON public.purchase_returns;
CREATE TRIGGER trg_purchase_returns_journal
AFTER INSERT OR UPDATE OF status, total_amount, refund_cash_amount, refund_transfer_amount, refund_balance_amount
ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_return_journal();

REVOKE ALL ON FUNCTION public.sync_sale_return_journal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_purchase_return_journal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_sale_return_journal(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_purchase_return_journal(uuid) TO authenticated, service_role;