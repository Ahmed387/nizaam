-- 0244 — حسابات الأوعية (owner 2026-11-16): every vessel (محفظة / فودافون كاش / انستاباي / بنك …) has company-wide
-- accounts the money lands on (an employee's number or an outside number), added by the company owner from
-- الإعدادات ← طرق الدفع. Choosing the account is REQUIRED on a vessel that has accounts; «رقم العملية» is now optional
-- everywhere. A balance per account: `treasury.vessel_account_id` is filled by a trigger from the company-side number the
-- screens already send (income → transfer_to_account, expense → transfer_from_account, then the other one; a reversal
-- row with no number takes the account of the document's opposite row) — so the ~40 money RPCs stay untouched.
-- Vessel transfers can name the account on each side (and move money between two accounts of one vessel).

CREATE OR REPLACE FUNCTION public.vessel_account_key(p text)
 RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(regexp_replace(lower(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')),
                               '[^a-z0-9]', '', 'g'), '')
$$;

CREATE TABLE IF NOT EXISTS public.vessel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_method text NOT NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  holder_name text NOT NULL CHECK (btrim(holder_name) <> ''),
  account_number text NOT NULL CHECK (btrim(account_number) <> ''),
  number_key text GENERATED ALWAYS AS (public.vessel_account_key(account_number)) STORED,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vessel_accounts_number_uq ON public.vessel_accounts (tenant_id, payment_method, number_key);
ALTER TABLE public.vessel_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS va_read ON public.vessel_accounts;
CREATE POLICY va_read ON public.vessel_accounts FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.is_super_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS va_write ON public.vessel_accounts;
CREATE POLICY va_write ON public.vessel_accounts FOR ALL TO authenticated
  USING ((tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.is_owner((SELECT auth.uid()))))
         OR (SELECT public.is_super_admin((SELECT auth.uid()))))
  WITH CHECK ((tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.is_owner((SELECT auth.uid()))))
         OR (SELECT public.is_super_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS va_suspended ON public.vessel_accounts;
CREATE POLICY va_suspended ON public.vessel_accounts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()))
  WITH CHECK ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vessel_accounts TO authenticated;

ALTER TABLE public.treasury ADD COLUMN IF NOT EXISTS vessel_account_id uuid REFERENCES public.vessel_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS treasury_vessel_account_idx ON public.treasury (vessel_account_id) WHERE vessel_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.vessel_account_of(p_tenant uuid, p_method text, p_number text)
 RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT id FROM vessel_accounts
   WHERE tenant_id = p_tenant AND payment_method = p_method AND number_key = vessel_account_key(p_number)
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.trg_treasury_vessel_account()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid;
BEGIN
  IF NEW.payment_method IS NULL OR NEW.payment_method = 'cash' THEN NEW.vessel_account_id := NULL; RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.vessel_account_id IS NOT DISTINCT FROM OLD.vessel_account_id
     AND NEW.transfer_to_account IS NOT DISTINCT FROM OLD.transfer_to_account
     AND NEW.transfer_from_account IS NOT DISTINCT FROM OLD.transfer_from_account
     AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.vessel_account_id IS NOT NULL THEN RETURN NEW; END IF;
  v := vessel_account_of(NEW.tenant_id, NEW.payment_method,
                         CASE WHEN NEW.type = 'income' THEN NEW.transfer_to_account ELSE NEW.transfer_from_account END);
  IF v IS NULL THEN
    v := vessel_account_of(NEW.tenant_id, NEW.payment_method,
                           CASE WHEN NEW.type = 'income' THEN NEW.transfer_from_account ELSE NEW.transfer_to_account END);
  END IF;
  IF v IS NULL AND TG_OP = 'INSERT' AND NEW.reference_id IS NOT NULL
     AND coalesce(NEW.transfer_to_account, NEW.transfer_from_account) IS NULL THEN
    SELECT t.vessel_account_id INTO v FROM treasury t
     WHERE t.tenant_id = NEW.tenant_id AND t.reference_id = NEW.reference_id AND t.payment_method = NEW.payment_method
       AND t.vessel_account_id IS NOT NULL AND t.type <> NEW.type
     ORDER BY t.created_at DESC LIMIT 1;
  END IF;
  NEW.vessel_account_id := v;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_treasury_vessel_account ON public.treasury;
CREATE TRIGGER zz_treasury_vessel_account BEFORE INSERT OR UPDATE ON public.treasury
  FOR EACH ROW EXECUTE FUNCTION public.trg_treasury_vessel_account();

-- the account is required when the vessel has active accounts: one of the two numbers must be one of them
CREATE OR REPLACE FUNCTION public.assert_vessel_account(p_method text, p_from text, p_to text)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  IF p_method IS NULL OR p_method IN ('cash', 'credit_balance') OR v_t IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_method AND is_active) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_method AND is_active
                   AND number_key IN (vessel_account_key(p_from), vessel_account_key(p_to))) THEN
    RAISE EXCEPTION 'اختار الحساب اللي الفلوس اتحولت عليه / منه من ليستة حسابات الوعاء';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._validate_transfer_payment(p_method text, p_reference text, p_from text, p_to text)
 RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
BEGIN
  IF p_method IS NULL OR p_method = 'cash' THEN RETURN; END IF;
  -- 0244: «رقم العملية» is optional
  IF COALESCE(BTRIM(p_from), '') = '' THEN
    RAISE EXCEPTION 'رقم/حساب المُحوَّل منه مطلوب للدفع غير النقدي';
  END IF;
  IF COALESCE(BTRIM(p_to), '') = '' THEN
    RAISE EXCEPTION 'رقم/حساب المُحوَّل إليه مطلوب للدفع غير النقدي';
  END IF;
  PERFORM public.assert_vessel_account(p_method, p_from, p_to);
END;
$function$;

DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.process_sale(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date)'::regprocedure);
  n := replace(d, $a$        IF COALESCE(NULLIF(v_pay->>'reference_number',''), '') = '' THEN
          RAISE EXCEPTION 'رقم العملية مطلوب للتحويلات الإلكترونية';
        END IF;
$a$, $b$        PERFORM public.assert_vessel_account(v_pm, v_pay->>'transfer_from_account', v_pay->>'transfer_to_account');
$b$);
  IF n = d THEN RAISE EXCEPTION '0244: process_sale anchor'; END IF;
  EXECUTE n;
END $m$;

-- vessel transfers: the account on each side; one vessel ↔ itself is allowed between two different accounts
DROP FUNCTION IF EXISTS public.transfer_between_vessels(uuid, text, text, numeric, text, numeric, date, text);
CREATE OR REPLACE FUNCTION public.transfer_between_vessels(p_branch uuid, p_from text, p_to text, p_amount numeric,
  p_fee_mode text DEFAULT 'none'::text, p_fee_value numeric DEFAULT 0, p_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text,
  p_from_account text DEFAULT NULL, p_to_account text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_t uuid; v_day date := public.cairo_today(); v_fee numeric := 0; v_id uuid;
  v_out uuid; v_in uuid; v_fee_row uuid; v_ts timestamptz; v_note text := nullif(trim(coalesce(p_notes, '')), '');
  v_fa text := nullif(btrim(coalesce(p_from_account, '')), ''); v_ta text := nullif(btrim(coalesce(p_to_account, '')), '');
  v_fl text; v_tl text;
BEGIN
  PERFORM public.assert_access(p_branch, 'vessel_transfers.create');
  SELECT tenant_id INTO v_t FROM public.branches WHERE id = p_branch;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'اكتب مبلغ التحويل'; END IF;
  IF p_from IS NULL OR p_to IS NULL THEN RAISE EXCEPTION 'اختار وعاءين مختلفين'; END IF;
  IF p_from = p_to AND (v_fa IS NULL OR v_ta IS NULL OR public.vessel_account_key(v_fa) = public.vessel_account_key(v_ta)) THEN
    RAISE EXCEPTION 'اختار وعاءين مختلفين أو حسابين مختلفين في نفس الوعاء';
  END IF;
  IF NOT public.vessel_is_known(v_t, p_from) OR NOT public.vessel_is_known(v_t, p_to) THEN
    RAISE EXCEPTION 'الوعاء مش موجود أو موقوف من الإعدادات';
  END IF;
  IF EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_from AND is_active)
     AND (v_fa IS NULL OR NOT EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_from AND is_active
                                       AND number_key = vessel_account_key(v_fa))) THEN
    RAISE EXCEPTION 'اختار الحساب اللي هيتحول منه';
  END IF;
  IF EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_to AND is_active)
     AND (v_ta IS NULL OR NOT EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_to AND is_active
                                       AND number_key = vessel_account_key(v_ta))) THEN
    RAISE EXCEPTION 'اختار الحساب اللي هيتحول عليه';
  END IF;
  IF p_date IS NOT NULL AND p_date <> v_day THEN
    IF NOT (public.is_admin(v_uid) OR public.is_owner(v_uid) OR public.is_super_admin(v_uid)) THEN
      RAISE EXCEPTION 'تاريخ قديم للمالك والمدير بس';
    END IF;
    IF p_date > v_day THEN RAISE EXCEPTION 'مينفعش تاريخ بعد النهارده'; END IF;
    v_day := p_date;
  END IF;
  v_fee := CASE coalesce(p_fee_mode, 'none')
             WHEN 'none' THEN 0
             WHEN 'fixed' THEN round(coalesce(p_fee_value, 0), 2)
             WHEN 'percent' THEN round(p_amount * coalesce(p_fee_value, 0) / 100.0, 2)
             ELSE NULL END;
  IF v_fee IS NULL OR v_fee < 0 THEN RAISE EXCEPTION 'العمولة غلط'; END IF;
  v_ts := CASE WHEN v_day = public.cairo_today() THEN now() ELSE (v_day + time '12:00') AT TIME ZONE 'Africa/Cairo' END;
  v_fl := p_from || coalesce(' (' || v_fa || ')', '');
  v_tl := p_to || coalesce(' (' || v_ta || ')', '');

  INSERT INTO public.vessel_transfers (tenant_id, branch_id, from_method, to_method, amount, fee_mode, fee_value, fee_amount,
                                       transfer_date, notes, created_by)
  VALUES (v_t, p_branch, p_from, p_to, round(p_amount, 2), coalesce(p_fee_mode, 'none'), coalesce(p_fee_value, 0), v_fee,
          v_day, v_note, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                               payment_method, transaction_date, created_at, transfer_from_account, transfer_to_account)
  VALUES (p_branch, v_t, 'expense', 'vessel_transfer', round(p_amount, 2),
          'تحويل بين الأوعية: ' || v_fl || ' ← ' || v_tl || coalesce(' — ' || v_note, ''), v_id, v_uid, p_from, v_day, v_ts, v_fa, v_ta)
  RETURNING id INTO v_out;
  INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                               payment_method, transaction_date, created_at, transfer_from_account, transfer_to_account)
  VALUES (p_branch, v_t, 'income', 'vessel_transfer', round(p_amount, 2),
          'تحويل بين الأوعية: ' || v_fl || ' → ' || v_tl || coalesce(' — ' || v_note, ''), v_id, v_uid, p_to, v_day, v_ts, v_fa, v_ta)
  RETURNING id INTO v_in;
  IF v_fee > 0 THEN
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                                 payment_method, is_fee, transaction_date, created_at, transfer_from_account)
    VALUES (p_branch, v_t, 'expense', 'transfer_fee', v_fee, 'عمولة تحويل بين الأوعية (' || v_fl || ' → ' || v_tl || ')',
            v_id, v_uid, p_from, true, v_day, v_ts, v_fa)
    RETURNING id INTO v_fee_row;
  END IF;

  UPDATE public.vessel_transfers SET out_treasury_id = v_out, in_treasury_id = v_in, fee_treasury_id = v_fee_row WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'amount', round(p_amount, 2), 'fee', v_fee, 'date', v_day);
END $function$;

-- the balance of every account (company-wide, or one branch); account NULL = movements before the accounts / without one
CREATE OR REPLACE FUNCTION public.vessel_account_balances(p_branch uuid DEFAULT NULL)
 RETURNS TABLE (payment_method text, vessel_account_id uuid, holder_name text, account_number text, is_active boolean,
                balance numeric, movements bigint, last_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(p_branch);
  RETURN QUERY
  WITH m AS (
    SELECT t.payment_method AS pm, t.vessel_account_id AS acc,
           sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END) AS bal, count(*) AS n, max(t.created_at) AS last_at
      FROM treasury t
     WHERE t.tenant_id = v_t AND t.payment_method IS NOT NULL AND t.payment_method <> 'cash'
       AND (p_branch IS NULL OR t.branch_id = p_branch)
     GROUP BY 1, 2)
  SELECT coalesce(a.payment_method, m.pm), coalesce(a.id, m.acc), a.holder_name, a.account_number, coalesce(a.is_active, true),
         round(coalesce(m.bal, 0), 2), coalesce(m.n, 0), m.last_at
    FROM (SELECT * FROM vessel_accounts WHERE tenant_id = v_t) a
    FULL JOIN m ON m.acc = a.id
   WHERE a.id IS NOT NULL OR m.acc IS NULL
   ORDER BY 1, a.sort_order NULLS LAST, a.holder_name NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.vessel_account_balances(uuid), public.assert_vessel_account(text, text, text),
  public.vessel_account_of(uuid, text, text), public.trg_treasury_vessel_account(),
  public.transfer_between_vessels(uuid, text, text, numeric, text, numeric, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vessel_account_balances(uuid),
  public.transfer_between_vessels(uuid, text, text, numeric, text, numeric, date, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.assert_vessel_account(text, text, text), public.vessel_account_of(uuid, text, text),
  public.trg_treasury_vessel_account() FROM authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('vessel_account_balances', '0244', 'balance of each vessel account')
ON CONFLICT DO NOTHING;
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN RAISE EXCEPTION '0244: exposed'; END IF;
END $chk$;
