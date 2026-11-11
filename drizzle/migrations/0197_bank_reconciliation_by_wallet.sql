-- 0197: owner 2026-11-11 «تسوية البنك تطابق كشف فودافون مع حركات وعاء فودافون من جدول الخزنة مباشرة … موافق نفذ».
-- The books keep every non-cash vessel on ONE account (1110), so matching a statement against journal lines mixes vodafone,
-- instapay … of all branches. A bank account of the reconciliation screen can now point at a VESSEL: `branch_id` +
-- `payment_method`. Its statement lines are then matched to the `treasury` movements of that branch and method
-- (`bank_statement_lines.matched_treasury_id`), and «رصيد الدفاتر» is the vessel's balance at the end of the period. No journal
-- entry, till or balance is touched — reconciliation only marks lines as matched. Accounts with a GL account and no vessel
-- keep the old journal-line matching.
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.bank_statement_lines ADD COLUMN IF NOT EXISTS matched_treasury_id uuid REFERENCES public.treasury(id);
CREATE INDEX IF NOT EXISTS bank_statement_lines_matched_treasury_idx ON public.bank_statement_lines (matched_treasury_id) WHERE matched_treasury_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bank_wallet_movements(p_bank_account_id uuid, p_from date, p_to date)
RETURNS TABLE(id uuid, txn_date date, debit numeric, credit numeric, description text, category text, matched boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.bank_accounts%ROWTYPE;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'تسوية البنك للإدارة فقط' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.bank_accounts WHERE bank_accounts.id = p_bank_account_id AND tenant_id = public.current_tenant_id();
  IF a.id IS NULL OR a.branch_id IS NULL OR a.payment_method IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT t.id, t.transaction_date,
         CASE WHEN t.type::text = 'income' THEN t.amount ELSE 0 END, CASE WHEN t.type::text = 'income' THEN 0 ELSE t.amount END,
         t.description, t.category,
         EXISTS (SELECT 1 FROM public.bank_statement_lines l WHERE l.matched_treasury_id = t.id)
    FROM public.treasury t
   WHERE t.tenant_id = a.tenant_id AND t.branch_id = a.branch_id AND t.payment_method = a.payment_method
     AND t.transaction_date BETWEEN p_from AND p_to
   ORDER BY t.transaction_date, t.created_at;
END
$fn$;

CREATE OR REPLACE FUNCTION public.bank_wallet_balance(p_bank_account_id uuid, p_to date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.bank_accounts%ROWTYPE; v numeric;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'تسوية البنك للإدارة فقط' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.bank_accounts WHERE id = p_bank_account_id AND tenant_id = public.current_tenant_id();
  IF a.id IS NULL OR a.branch_id IS NULL OR a.payment_method IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(sum(CASE WHEN t.type::text = 'income' THEN t.amount ELSE -t.amount END), 0) INTO v
    FROM public.treasury t
   WHERE t.tenant_id = a.tenant_id AND t.branch_id = a.branch_id AND t.payment_method = a.payment_method AND t.transaction_date <= p_to;
  RETURN round(v, 2);
END
$fn$;
REVOKE ALL ON FUNCTION public.bank_wallet_movements(uuid, date, date), public.bank_wallet_balance(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_wallet_movements(uuid, date, date), public.bank_wallet_balance(uuid, date) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- an account that is only a vessel has no GL account: its tenant comes from the branch (the old trigger left it NULL and RLS refused the row)
CREATE OR REPLACE FUNCTION public.set_bank_account_tenant_id()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.chart_of_accounts WHERE id = NEW.gl_account_id;
  END IF;
  IF NEW.tenant_id IS NULL AND NEW.branch_id IS NOT NULL THEN  -- 0197: an account that is a vessel of a branch
    SELECT tenant_id INTO NEW.tenant_id FROM public.branches WHERE id = NEW.branch_id;
  END IF;
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id := public.current_tenant_id(); END IF;
  RETURN NEW;
END;
$function$;
