
-- =========================================================
-- Phase 3 Part B: Auto-Journal Triggers
-- =========================================================

-- Add mapping column on voucher categories
ALTER TABLE public.voucher_categories
  ADD COLUMN IF NOT EXISTS gl_account_code TEXT;

-- ---------------------------------------------------------
-- Helper: post_journal (SECURITY DEFINER, callable by triggers)
-- lines JSONB: [{account_code, debit, credit, description}, ...]
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_journal(
  p_tenant_id UUID,
  p_entry_date DATE,
  p_description TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_lines JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entry_id UUID; v_entry_number TEXT; v_line JSONB;
  v_account_id UUID; v_seq INTEGER;
  v_debit NUMERIC(18,2); v_credit NUMERIC(18,2);
  v_total_debit NUMERIC(18,2) := 0; v_total_credit NUMERIC(18,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'-',3) AS INTEGER)),0)+1 INTO v_seq
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id
     AND entry_number LIKE 'JE-'||to_char(p_entry_date,'YYYYMM')||'-%';
  v_entry_number := 'JE-'||to_char(p_entry_date,'YYYYMM')||'-'||LPAD(v_seq::TEXT,4,'0');

  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source_type, source_id, status)
  VALUES (p_tenant_id, v_entry_number, p_entry_date, p_description, p_source_type, p_source_id, 'draft')
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_debit  := COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);
    IF v_debit = 0 AND v_credit = 0 THEN CONTINUE; END IF;

    SELECT id INTO v_account_id FROM public.chart_of_accounts
      WHERE tenant_id = p_tenant_id AND code = v_line->>'account_code' LIMIT 1;
    IF v_account_id IS NULL THEN
      RAISE WARNING 'Account % not found for tenant %, skipping', v_line->>'account_code', p_tenant_id;
      CONTINUE;
    END IF;

    INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description)
    VALUES (p_tenant_id, v_entry_id, v_account_id, v_debit, v_credit, v_line->>'description');

    v_total_debit  := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF ROUND(v_total_debit,2) <> ROUND(v_total_credit,2) OR v_total_debit = 0 THEN
    -- Rollback this entry silently to avoid breaking business flow
    DELETE FROM public.journal_entries WHERE id = v_entry_id;
    RAISE WARNING 'Skipped unbalanced auto-entry for %/%: debit=% credit=%', p_source_type, p_source_id, v_total_debit, v_total_credit;
    RETURN NULL;
  END IF;

  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_entry_id;
  RETURN v_entry_id;
END $$;

-- ---------------------------------------------------------
-- Helper: reverse existing posted entries for a source
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_journal_for_source(
  p_tenant_id UUID, p_source_type TEXT, p_source_id UUID, p_reason TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      'debit', l.credit,      -- swap!
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
      UPDATE public.journal_entries SET status='reversed', reversed_by = v_new_id WHERE id = v_orig.id;
    END IF;
  END LOOP;
END $$;

-- =========================================================
-- 1) INVOICES → sale journal
--   Dr Accounts Receivable (1200) = total
--   Cr Sales Revenue (4100)       = subtotal - discount
--   Cr VAT Payable (2200)         = vat_amount
-- =========================================================
CREATE OR REPLACE FUNCTION public.trg_invoice_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_net NUMERIC(18,2);
  v_lines JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    v_net := COALESCE(NEW.subtotal,0) - COALESCE(NEW.discount_amount,0);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1200','debit',NEW.total,'credit',0,'description','Invoice '||NEW.invoice_number),
      jsonb_build_object('account_code','4100','debit',0,'credit',v_net,'description','Sales revenue'),
      jsonb_build_object('account_code','2200','debit',0,'credit',COALESCE(NEW.vat_amount,0),'description','VAT payable')
    );
    PERFORM public.post_journal(NEW.tenant_id, NEW.invoice_date, 'Sale Invoice '||NEW.invoice_number,
      'invoice', NEW.id, v_lines);

  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'invoice', NEW.id,
      'Invoice '||NEW.invoice_number||' cancelled');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoices_journal ON public.invoices;
CREATE TRIGGER trg_invoices_journal
AFTER INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_journal();

-- =========================================================
-- 2) INVOICE PAYMENTS → collection journal
--   Dr Cash (1100) = amount
--   Cr Accounts Receivable (1200) = amount
-- =========================================================
CREATE OR REPLACE FUNCTION public.trg_invoice_payment_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lines JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.voided_at IS NULL AND COALESCE(NEW.amount,0) > 0 THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1100','debit',NEW.amount,'credit',0,'description','Payment received'),
      jsonb_build_object('account_code','1200','debit',0,'credit',NEW.amount,'description','AR settlement')
    );
    PERFORM public.post_journal(NEW.tenant_id, CURRENT_DATE, 'Invoice payment',
      'invoice_payment', NEW.id, v_lines);
  ELSIF TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'invoice_payment', NEW.id, 'Payment voided');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_payments_journal ON public.invoice_payments;
CREATE TRIGGER trg_invoice_payments_journal
AFTER INSERT OR UPDATE OF voided_at ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_payment_journal();

-- =========================================================
-- 3) VOUCHERS → receipt/payment journal
--   Receipt: Dr Cash 1100, Cr (category.gl_account_code or 4200)
--   Payment: Dr (category.gl_account_code or 5500), Cr Cash 1100
-- =========================================================
CREATE OR REPLACE FUNCTION public.trg_voucher_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat_code TEXT; v_lines JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' AND COALESCE(NEW.amount,0) > 0 THEN
    SELECT gl_account_code INTO v_cat_code FROM public.voucher_categories WHERE id = NEW.category_id;

    IF NEW.type = 'receipt' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1100','debit',NEW.amount,'credit',0,'description','Receipt '||NEW.voucher_number),
        jsonb_build_object('account_code',COALESCE(v_cat_code,'4200'),'debit',0,'credit',NEW.amount,'description',COALESCE(NEW.description,'Receipt'))
      );
    ELSIF NEW.type = 'payment' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code',COALESCE(v_cat_code,'5500'),'debit',NEW.amount,'credit',0,'description',COALESCE(NEW.description,'Payment')),
        jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount,'description','Payment '||NEW.voucher_number)
      );
    ELSE
      RETURN NEW;
    END IF;

    PERFORM public.post_journal(NEW.tenant_id, NEW.voucher_date, NEW.type::text||' voucher '||NEW.voucher_number,
      'voucher', NEW.id, v_lines);

  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'voucher', NEW.id,
      'Voucher '||NEW.voucher_number||' cancelled');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vouchers_journal ON public.vouchers;
CREATE TRIGGER trg_vouchers_journal
AFTER INSERT OR UPDATE OF status ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.trg_voucher_journal();

-- =========================================================
-- 4) PARTNER TRANSACTIONS → equity journal
--   contribution : Dr Cash 1100,       Cr Partner Capital 3100
--   drawing      : Dr Drawings 3200,   Cr Cash 1100
--   profit_share : Dr Retained 3300,   Cr Partner Capital 3100
-- =========================================================
CREATE OR REPLACE FUNCTION public.trg_partner_tx_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lines JSONB;
BEGIN
  IF TG_OP <> 'INSERT' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;

  IF NEW.transaction_type ILIKE 'contribution%' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1100','debit',NEW.amount,'credit',0,'description','Partner contribution'),
      jsonb_build_object('account_code','3100','debit',0,'credit',NEW.amount,'description',COALESCE(NEW.description,'Contribution'))
    );
  ELSIF NEW.transaction_type ILIKE 'drawing%' OR NEW.transaction_type ILIKE 'withdraw%' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','3200','debit',NEW.amount,'credit',0,'description',COALESCE(NEW.description,'Drawing')),
      jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount,'description','Partner drawing')
    );
  ELSIF NEW.transaction_type ILIKE 'profit%' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','3300','debit',NEW.amount,'credit',0,'description','Profit distribution'),
      jsonb_build_object('account_code','3100','debit',0,'credit',NEW.amount,'description',COALESCE(NEW.description,'Profit share'))
    );
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.post_journal(NEW.tenant_id, CURRENT_DATE,
    'Partner '||NEW.transaction_type, 'partner_transaction', NEW.id, v_lines);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_partner_transactions_journal ON public.partner_transactions;
CREATE TRIGGER trg_partner_transactions_journal
AFTER INSERT ON public.partner_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_partner_tx_journal();

-- =========================================================
-- 5) PARTNER ADVANCES → disbursement journal (on creation)
--   Dr Partner Advances Receivable 1400
--   Cr Cash 1100
-- =========================================================
CREATE OR REPLACE FUNCTION public.trg_partner_advance_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lines JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND COALESCE(NEW.amount,0) > 0 THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1400','debit',NEW.amount,'credit',0,'description','Advance to partner'),
      jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount,'description',COALESCE(NEW.reason,'Partner advance'))
    );
    PERFORM public.post_journal(NEW.tenant_id, NEW.advance_date,
      'Partner advance disbursement', 'partner_advance', NEW.id, v_lines);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_partner_advances_journal ON public.partner_advances;
CREATE TRIGGER trg_partner_advances_journal
AFTER INSERT ON public.partner_advances
FOR EACH ROW EXECUTE FUNCTION public.trg_partner_advance_journal();

-- =========================================================
-- 6) PARTNER ADVANCE PAYMENTS → repayment journal
--   treasury / manual : Dr Cash 1100,       Cr Partner Advances Receivable 1400
--   profit_deduction  : Dr Retained 3300,   Cr Partner Advances Receivable 1400
-- =========================================================
CREATE OR REPLACE FUNCTION public.trg_partner_advance_payment_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lines JSONB; v_tenant UUID; v_dr_code TEXT;
BEGIN
  IF TG_OP <> 'INSERT' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;

  SELECT tenant_id INTO v_tenant FROM public.partner_advances WHERE id = NEW.advance_id;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  IF NEW.payment_method = 'profit_deduction' THEN
    v_dr_code := '3300';
  ELSE
    v_dr_code := '1100';
  END IF;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code',v_dr_code,'debit',NEW.amount,'credit',0,'description','Advance repayment'),
    jsonb_build_object('account_code','1400','debit',0,'credit',NEW.amount,'description','Partner advance settlement')
  );
  PERFORM public.post_journal(v_tenant, NEW.payment_date,
    'Partner advance repayment', 'partner_advance_payment', NEW.id, v_lines);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_partner_advance_payments_journal ON public.partner_advance_payments;
CREATE TRIGGER trg_partner_advance_payments_journal
AFTER INSERT ON public.partner_advance_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_partner_advance_payment_journal();
