-- 0246 — sending limits per vessel account (owner 2026-11-16): a daily and a monthly limit on the money SENT from an
-- account (each vessel's account its own limit; the month = the calendar month, Cairo). A send that would pass a
-- limit is refused with the amount still allowed. Usage = expense rows of the account (fee rows excluded) by
-- transaction_date. `vessel_account_usage(ids)` → limits / used today / used this month / balance (progress bars);
-- `vessel_account_statement(account, from, to)` → movements for the PDF.
ALTER TABLE public.vessel_accounts
  ADD COLUMN IF NOT EXISTS daily_limit numeric CHECK (daily_limit IS NULL OR daily_limit > 0),
  ADD COLUMN IF NOT EXISTS monthly_limit numeric CHECK (monthly_limit IS NULL OR monthly_limit > 0);
CREATE INDEX IF NOT EXISTS treasury_vessel_account_day_idx ON public.treasury (vessel_account_id, transaction_date)
  WHERE vessel_account_id IS NOT NULL AND type = 'expense';

CREATE OR REPLACE FUNCTION public.vessel_account_sent(p_account uuid, p_from date, p_to date)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT coalesce(sum(amount), 0) FROM treasury
   WHERE vessel_account_id = p_account AND type = 'expense' AND NOT coalesce(is_fee, false)
     AND transaction_date BETWEEN p_from AND p_to
$$;

CREATE OR REPLACE FUNCTION public.trg_treasury_account_limit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; v_day date; v_m0 date; v_used_d numeric; v_used_m numeric; v_left numeric;
BEGIN
  IF NEW.vessel_account_id IS NULL OR NEW.type <> 'expense' OR coalesce(NEW.is_fee, false) THEN RETURN NEW; END IF;
  SELECT * INTO a FROM vessel_accounts WHERE id = NEW.vessel_account_id;
  IF a.daily_limit IS NULL AND a.monthly_limit IS NULL THEN RETURN NEW; END IF;
  v_day := coalesce(NEW.transaction_date, public.cairo_today());
  v_m0 := date_trunc('month', v_day)::date;
  v_used_d := vessel_account_sent(a.id, v_day, v_day);
  v_used_m := vessel_account_sent(a.id, v_m0, (v_m0 + interval '1 month' - interval '1 day')::date);
  v_left := least(coalesce(a.daily_limit - v_used_d, 'Infinity'::numeric), coalesce(a.monthly_limit - v_used_m, 'Infinity'::numeric));
  IF NEW.amount > v_left + 0.001 THEN
    RAISE EXCEPTION '%', format('حساب «%s» (%s) هيعدّي الليميت: %s%s — المسموح دلوقتي %s ج.م',
      a.holder_name, a.account_number,
      CASE WHEN a.daily_limit IS NOT NULL THEN format('اليومي %s واتبعت %s يوم %s', a.daily_limit, v_used_d, v_day) ELSE '' END,
      CASE WHEN a.monthly_limit IS NOT NULL THEN format('%sالشهري %s واتبعت %s', CASE WHEN a.daily_limit IS NOT NULL THEN '، ' ELSE '' END,
                                                        a.monthly_limit, v_used_m) ELSE '' END,
      round(greatest(v_left, 0), 2))
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zzz_treasury_account_limit ON public.treasury;
CREATE TRIGGER zzz_treasury_account_limit BEFORE INSERT ON public.treasury
  FOR EACH ROW EXECUTE FUNCTION public.trg_treasury_account_limit();

CREATE OR REPLACE FUNCTION public.vessel_account_usage(p_ids uuid[] DEFAULT NULL)
 RETURNS TABLE (id uuid, payment_method text, holder_name text, account_number text, is_active boolean,
                daily_limit numeric, monthly_limit numeric, sent_today numeric, sent_month numeric, balance numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid; v_day date := public.cairo_today(); v_m0 date := date_trunc('month', public.cairo_today())::date;
BEGIN
  v_t := public.assert_company_access(NULL);
  RETURN QUERY
  SELECT a.id, a.payment_method, a.holder_name, a.account_number, a.is_active, a.daily_limit, a.monthly_limit,
         vessel_account_sent(a.id, v_day, v_day),
         vessel_account_sent(a.id, v_m0, (v_m0 + interval '1 month' - interval '1 day')::date),
         coalesce((SELECT round(sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 2)
                     FROM treasury t WHERE t.vessel_account_id = a.id), 0)
    FROM vessel_accounts a
   WHERE a.tenant_id = v_t AND (p_ids IS NULL OR a.id = ANY (p_ids))
   ORDER BY a.payment_method, a.sort_order, a.holder_name;
END $$;

CREATE OR REPLACE FUNCTION public.vessel_account_statement(p_account uuid, p_from date, p_to date)
 RETURNS TABLE (id uuid, transaction_date date, created_at timestamptz, branch_name text, type text, category text,
                amount numeric, is_fee boolean, description text, reference_number text, other_account text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT EXISTS (SELECT 1 FROM vessel_accounts va WHERE va.id = p_account AND va.tenant_id = v_t) THEN
    RAISE EXCEPTION 'الحساب مش موجود';
  END IF;
  RETURN QUERY
  SELECT t.id, t.transaction_date, t.created_at, b.name, t.type, t.category, t.amount, coalesce(t.is_fee, false), t.description,
         t.reference_number, CASE WHEN t.type = 'income' THEN t.transfer_from_account ELSE t.transfer_to_account END
    FROM treasury t LEFT JOIN branches b ON b.id = t.branch_id
   WHERE t.vessel_account_id = p_account AND t.transaction_date BETWEEN p_from AND p_to
   ORDER BY t.transaction_date, t.created_at;
END $$;

REVOKE ALL ON FUNCTION public.vessel_account_usage(uuid[]), public.vessel_account_statement(uuid, date, date),
  public.vessel_account_sent(uuid, date, date), public.trg_treasury_account_limit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vessel_account_usage(uuid[]), public.vessel_account_statement(uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.vessel_account_sent(uuid, date, date), public.trg_treasury_account_limit() FROM authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('vessel_account_usage', '0246', 'limits / sent / balance per vessel account'),
  ('vessel_account_statement', '0246', 'movements of one vessel account (PDF)')
ON CONFLICT DO NOTHING;
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN RAISE EXCEPTION '0246: exposed'; END IF;
END $chk$;
