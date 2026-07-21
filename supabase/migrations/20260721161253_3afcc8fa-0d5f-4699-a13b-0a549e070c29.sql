
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  currency TEXT NOT NULL DEFAULT 'EGP',
  gl_account_id UUID REFERENCES public.chart_of_accounts(id),
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  opening_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage bank accounts" ON public.bank_accounts FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.bank_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  statement_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  closing_balance NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statements TO authenticated;
GRANT ALL ON public.bank_statements TO service_role;
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage statements" ON public.bank_statements FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  txn_date DATE NOT NULL,
  description TEXT,
  reference TEXT,
  debit NUMERIC NOT NULL DEFAULT 0,
  credit NUMERIC NOT NULL DEFAULT 0,
  is_matched BOOLEAN NOT NULL DEFAULT false,
  matched_journal_line_id UUID REFERENCES public.journal_entry_lines(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  matched_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_lines TO authenticated;
GRANT ALL ON public.bank_statement_lines TO service_role;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage statement lines" ON public.bank_statement_lines FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_bsl_statement ON public.bank_statement_lines(statement_id);
CREATE INDEX idx_bsl_account_date ON public.bank_statement_lines(bank_account_id, txn_date);
CREATE INDEX idx_bsl_matched ON public.bank_statement_lines(is_matched);

CREATE TRIGGER trg_bank_accounts_updated BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bank_statements_updated BEFORE UPDATE ON public.bank_statements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bank_statement_lines_updated BEFORE UPDATE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.get_bank_reconciliation_summary(
  p_bank_account_id UUID,
  p_period_start DATE,
  p_period_end DATE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_gl_account UUID;
  v_book_balance NUMERIC := 0;
  v_stmt_debits NUMERIC := 0;
  v_stmt_credits NUMERIC := 0;
  v_matched_lines INT := 0;
  v_unmatched_lines INT := 0;
  v_unmatched_journal INT := 0;
BEGIN
  SELECT gl_account_id INTO v_gl_account FROM public.bank_accounts WHERE id = p_bank_account_id;

  IF v_gl_account IS NOT NULL THEN
    SELECT COALESCE(SUM(l.debit - l.credit), 0) INTO v_book_balance
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.entry_id
    WHERE l.account_id = v_gl_account
      AND j.entry_date <= p_period_end
      AND j.status = 'posted';
  END IF;

  SELECT
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0),
    COUNT(*) FILTER (WHERE is_matched),
    COUNT(*) FILTER (WHERE NOT is_matched)
  INTO v_stmt_debits, v_stmt_credits, v_matched_lines, v_unmatched_lines
  FROM public.bank_statement_lines
  WHERE bank_account_id = p_bank_account_id
    AND txn_date BETWEEN p_period_start AND p_period_end;

  IF v_gl_account IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unmatched_journal
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.entry_id
    WHERE l.account_id = v_gl_account
      AND j.entry_date BETWEEN p_period_start AND p_period_end
      AND j.status = 'posted'
      AND NOT EXISTS (
        SELECT 1 FROM public.bank_statement_lines bsl
        WHERE bsl.matched_journal_line_id = l.id
      );
  END IF;

  RETURN jsonb_build_object(
    'book_balance', v_book_balance,
    'statement_debits', v_stmt_debits,
    'statement_credits', v_stmt_credits,
    'statement_net', v_stmt_debits - v_stmt_credits,
    'matched_lines', v_matched_lines,
    'unmatched_statement_lines', v_unmatched_lines,
    'unmatched_journal_lines', v_unmatched_journal
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bank_reconciliation_summary(UUID, DATE, DATE) TO authenticated;
