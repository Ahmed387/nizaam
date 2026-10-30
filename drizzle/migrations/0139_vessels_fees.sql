-- 0139: the money vessels (owner «نفذ», 2026-10-30)
--
-- 1) «تحويل بين الأوعية» in ONE branch (cash ↔ wallet ↔ bank ↔ PayMob …), the owner decides the fee each time:
--    none, a fixed amount or a percentage; the fee is an expense («عمولات تحويل»).
--    Example: سكة تلة moves 10,000 from فودافون كاش to the cash drawer with 1% → vodafone −10,100, cash +10,000,
--    expense 100. The books do not move between cash and wallets (they are all «النقدية»); only the fee is posted.
--    Cancel = both rows and the fee reversed on the transfer's own day.
-- 2) The transfer fee of a sale / a payment «على العميل» was not recorded anywhere: the customer sent 10,150 (10,000 +
--    1.5%) and the till showed 10,000. Now the 150 is its own till row in the same vessel (category «customer_fee»,
--    receipt voucher «إيرادات أخرى» → the profit line «إيرادات أخرى»). «على الشركة» stays an expense. Voiding the
--    payment voids its fee row too (invoice_payments.fee_treasury_id / payment_transactions.fee_treasury_id).
-- 3) «QA رسوم» (a test vessel, never used) is removed.
-- 4) A «virtual» vessel (`transfer_fees.kind = 'virtual'`): money that is not real cash, e.g. «خصومات / عروض الشركات»
--    (a supplier's commission booked as receipt + payment). It needs no transfer number, has no fee and may go below
--    zero; it is added for A & N and shows in settings like the other vessels.

-- ── 3 + 4: settings rows ──────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.transfer_fees ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'wallet';
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_fees_kind_chk') THEN
    ALTER TABLE public.transfer_fees ADD CONSTRAINT transfer_fees_kind_chk CHECK (kind IN ('wallet', 'virtual'));
  END IF;
END $mig$;

DELETE FROM public.transfer_fees f
 WHERE f.payment_method = '__qa_method'
   AND NOT EXISTS (SELECT 1 FROM public.treasury t WHERE t.tenant_id = f.tenant_id AND t.payment_method = f.payment_method);

INSERT INTO public.transfer_fees (tenant_id, payment_method, fee_type, fee_value, is_enabled, label, kind)
SELECT '5316fbfe-b862-4c91-b48b-1d81c8aa5a71', 'company_offers', 'fixed', 0, true, 'خصومات / عروض الشركات', 'virtual'
 WHERE EXISTS (SELECT 1 FROM public.tenants WHERE id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71')
   AND NOT EXISTS (SELECT 1 FROM public.transfer_fees WHERE tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND payment_method = 'company_offers');

-- every vessel of the company can be used on vouchers / payments / expenses (the old CHECKs allowed only the four
-- built-ins, so PayMob or «خصومات / عروض الشركات» could never reach the till): a trigger now accepts a built-in or a
-- vessel of that company in settings
CREATE OR REPLACE FUNCTION public.guard_payment_method()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.payment_method IS NULL OR NEW.payment_method IN ('cash', 'vodafone', 'instapay', 'bank')
     OR (TG_TABLE_NAME = 'payment_transactions' AND NEW.payment_method IN ('settlement', 'credit_balance'))
     OR EXISTS (SELECT 1 FROM public.transfer_fees f WHERE f.tenant_id = coalesce(NEW.tenant_id, public.current_tenant_id()) AND f.payment_method = NEW.payment_method) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'وعاء الفلوس «%» مش موجود في الإعدادات', NEW.payment_method USING ERRCODE = 'check_violation';
END $function$;
ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_payment_method_check;
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_payment_method_check;
ALTER TABLE public.payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_payment_method_check;
DROP TRIGGER IF EXISTS a0_guard_payment_method ON public.vouchers;
DROP TRIGGER IF EXISTS a0_guard_payment_method ON public.expenses;
DROP TRIGGER IF EXISTS a0_guard_payment_method ON public.payment_transactions;
CREATE TRIGGER a0_guard_payment_method BEFORE INSERT OR UPDATE OF payment_method ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_method();
CREATE TRIGGER a0_guard_payment_method BEFORE INSERT OR UPDATE OF payment_method ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_method();
CREATE TRIGGER a0_guard_payment_method BEFORE INSERT OR UPDATE OF payment_method ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_method();

-- a virtual vessel never charges a fee
CREATE OR REPLACE FUNCTION public.calculate_payment_fee(p_method text, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_fee_type TEXT; v_fee_value NUMERIC; v_kind text;
BEGIN
  IF p_method = 'cash' OR p_method IS NULL THEN RETURN 0; END IF;
  SELECT fee_type, fee_value, kind INTO v_fee_type, v_fee_value, v_kind
    FROM public.transfer_fees
    WHERE tenant_id = current_tenant_id()
      AND payment_method = p_method
      AND COALESCE(is_enabled, true) = true
    LIMIT 1;
  IF v_fee_value IS NULL OR v_kind = 'virtual' THEN RETURN 0; END IF;
  IF v_fee_type = 'percentage' THEN RETURN ROUND(p_amount * v_fee_value / 100.0, 2);
  ELSE RETURN v_fee_value; END IF;
END;
$function$;

-- a virtual vessel may go below zero (it is not money in hand)
DO $mig$
DECLARE d text := pg_get_functiondef('public.check_treasury_balance()'::regprocedure);
  o text := $o$  IF NEW.type = 'expense' THEN
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.treasury WHERE branch_id = NEW.branch_id;$o$;
  n text := $n$  -- 0139: a virtual vessel («خصومات / عروض الشركات») is not money in hand and may go below zero
  IF NEW.type = 'expense' AND EXISTS (SELECT 1 FROM public.transfer_fees f
       WHERE f.tenant_id = NEW.tenant_id AND f.payment_method = v_pm AND f.kind = 'virtual') THEN
    RETURN NEW;
  END IF;
  IF NEW.type = 'expense' THEN
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.treasury WHERE branch_id = NEW.branch_id;$n$;
BEGIN
  IF position('0139' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0139: check_treasury_balance not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

-- ── 1: transfer between two vessels of one branch ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vessel_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  from_method text NOT NULL,
  to_method text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  fee_mode text NOT NULL DEFAULT 'none' CHECK (fee_mode IN ('none', 'fixed', 'percent')),
  fee_value numeric(14,4) NOT NULL DEFAULT 0,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  transfer_date date NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  out_treasury_id uuid, in_treasury_id uuid, fee_treasury_id uuid,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_by uuid, cancelled_at timestamptz, cancel_reason text,
  CHECK (from_method <> to_method)
);
CREATE INDEX IF NOT EXISTS vessel_transfers_branch_idx ON public.vessel_transfers (branch_id, transfer_date DESC);
ALTER TABLE public.vessel_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vessel_transfers_read ON public.vessel_transfers;
CREATE POLICY vessel_transfers_read ON public.vessel_transfers FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND (branch_id = ANY ((SELECT public.my_branch_ids())::uuid[]) OR (SELECT public.is_admin((SELECT auth.uid())))
              OR (SELECT public.has_central_access((SELECT auth.uid())))));
DROP POLICY IF EXISTS suspended_block_write ON public.vessel_transfers;
CREATE POLICY suspended_block_write ON public.vessel_transfers AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()));
DROP POLICY IF EXISTS branch_paused_read ON public.vessel_transfers;
CREATE POLICY branch_paused_read ON public.vessel_transfers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (branch_id = ANY ((SELECT public.paused_branch_ids())::uuid[]))
         OR (SELECT public.is_super_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid())))
         OR (SELECT public.is_admin((SELECT auth.uid()))));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vessel_transfers FROM authenticated, anon;
GRANT SELECT ON public.vessel_transfers TO authenticated;
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.vessel_transfers;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.vessel_transfers FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- the two till rows of a vessel transfer are not income / expense: no journal (both are «النقدية» in the books)
DO $mig$
DECLARE d text := pg_get_functiondef('public.post_voucher_journal(uuid)'::regprocedure);
  o text := $o$'branch_transfer_out','branch_transfer_in','transfer','transfer_in','capital_allocation',$o$;
  n text := $n$'branch_transfer_out','branch_transfer_in','transfer','transfer_in','vessel_transfer','capital_allocation',$n$;
BEGIN
  IF position('vessel_transfer' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0139: post_voucher_journal not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

-- the permission «التحويل بين أوعية الفرع» — on for the branch manager (the owner / manager always)
DO $mig$
DECLARE d text := pg_get_functiondef('public.role_permission_default(text,text)'::regprocedure);
  o text := $o$'doc_class.update'])$o$;
  n text := $n$'doc_class.update','vessel_transfers.create'])$n$;
BEGIN
  IF position('vessel_transfers.create' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0139: role_permission_default not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

CREATE OR REPLACE FUNCTION public.vessel_is_known(p_tenant uuid, p_method text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT p_method IN ('cash', 'vodafone', 'instapay', 'bank')
      OR EXISTS (SELECT 1 FROM public.transfer_fees f WHERE f.tenant_id = p_tenant AND f.payment_method = p_method
                                                        AND coalesce(f.is_enabled, true));
$function$;
REVOKE ALL ON FUNCTION public.vessel_is_known(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transfer_between_vessels(p_branch uuid, p_from text, p_to text, p_amount numeric,
  p_fee_mode text DEFAULT 'none', p_fee_value numeric DEFAULT 0, p_date date DEFAULT NULL, p_notes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_t uuid; v_day date := public.cairo_today(); v_fee numeric := 0; v_id uuid;
  v_out uuid; v_in uuid; v_fee_row uuid; v_ts timestamptz; v_note text := nullif(trim(coalesce(p_notes, '')), '');
BEGIN
  PERFORM public.assert_access(p_branch, 'vessel_transfers.create');
  SELECT tenant_id INTO v_t FROM public.branches WHERE id = p_branch;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'اكتب مبلغ التحويل'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RAISE EXCEPTION 'اختار وعاءين مختلفين'; END IF;
  IF NOT public.vessel_is_known(v_t, p_from) OR NOT public.vessel_is_known(v_t, p_to) THEN
    RAISE EXCEPTION 'الوعاء مش موجود أو موقوف من الإعدادات';
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

  INSERT INTO public.vessel_transfers (tenant_id, branch_id, from_method, to_method, amount, fee_mode, fee_value, fee_amount,
                                       transfer_date, notes, created_by)
  VALUES (v_t, p_branch, p_from, p_to, round(p_amount, 2), coalesce(p_fee_mode, 'none'), coalesce(p_fee_value, 0), v_fee,
          v_day, v_note, v_uid)
  RETURNING id INTO v_id;

  -- out of the first vessel (the balance check of the till runs here)
  INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                               payment_method, transaction_date, created_at)
  VALUES (p_branch, v_t, 'expense', 'vessel_transfer', round(p_amount, 2),
          'تحويل بين الأوعية: ' || p_from || ' ← ' || p_to || coalesce(' — ' || v_note, ''), v_id, v_uid, p_from, v_day, v_ts)
  RETURNING id INTO v_out;
  INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                               payment_method, transaction_date, created_at)
  VALUES (p_branch, v_t, 'income', 'vessel_transfer', round(p_amount, 2),
          'تحويل بين الأوعية: ' || p_from || ' → ' || p_to || coalesce(' — ' || v_note, ''), v_id, v_uid, p_to, v_day, v_ts)
  RETURNING id INTO v_in;
  IF v_fee > 0 THEN
    -- the fee is an expense («عمولات تحويل»), paid from the first vessel
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                                 payment_method, is_fee, transaction_date, created_at)
    VALUES (p_branch, v_t, 'expense', 'transfer_fee', v_fee, 'عمولة تحويل بين الأوعية (' || p_from || ' → ' || p_to || ')',
            v_id, v_uid, p_from, true, v_day, v_ts)
    RETURNING id INTO v_fee_row;
  END IF;

  UPDATE public.vessel_transfers SET out_treasury_id = v_out, in_treasury_id = v_in, fee_treasury_id = v_fee_row WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'amount', round(p_amount, 2), 'fee', v_fee, 'date', v_day);
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_vessel_transfer(p_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); x public.vessel_transfers%ROWTYPE; r uuid;
BEGIN
  SELECT * INTO x FROM public.vessel_transfers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل مش موجود'; END IF;
  PERFORM public.assert_access(x.branch_id, 'vessel_transfers.create');
  IF x.status = 'cancelled' THEN RAISE EXCEPTION 'التحويل ملغي قبل كده'; END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  -- the incoming row first: if its money was already spent the till refuses and nothing is cancelled
  FOREACH r IN ARRAY ARRAY[x.in_treasury_id, x.out_treasury_id, x.fee_treasury_id] LOOP
    IF r IS NOT NULL THEN PERFORM public.till_cancel_on_original_date(r, 'إلغاء تحويل بين الأوعية — ' || p_reason); END IF;
  END LOOP;
  UPDATE public.vessel_transfers SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_reason = p_reason WHERE id = x.id;
  RETURN jsonb_build_object('id', x.id, 'status', 'cancelled');
END $function$;

REVOKE ALL ON FUNCTION public.transfer_between_vessels(uuid, text, text, numeric, text, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_vessel_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_between_vessels(uuid, text, text, numeric, text, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_vessel_transfer(uuid, text) TO authenticated;

-- ── 2: the fee the customer pays on top is income in the same vessel ──────────────────────────────────────────────
ALTER TABLE public.invoice_payments ADD COLUMN IF NOT EXISTS fee_treasury_id uuid;

CREATE OR REPLACE FUNCTION public.record_customer_fee_income(p_branch uuid, p_tenant uuid, p_method text, p_fee numeric,
  p_ts timestamptz, p_label text, p_reference text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF coalesce(p_fee, 0) <= 0 OR coalesce(p_method, 'cash') = 'cash' THEN RETURN NULL; END IF;
  -- no customer / invoice link on purpose: it is income of the company, not money on the customer's account
  INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, created_by, payment_method,
                               reference_number, transaction_date, created_at)
  VALUES (p_branch, p_tenant, 'income', 'customer_fee', round(p_fee, 2),
          'عمولة تحويل على العميل — ' || coalesce(p_label, ''), auth.uid(), p_method, p_reference,
          (p_ts AT TIME ZONE 'Africa/Cairo')::date, p_ts)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.record_customer_fee_income(uuid, uuid, text, numeric, timestamptz, text, text) FROM PUBLIC, anon, authenticated;

-- process_sale: one income row per payment line with the fee on the customer
DO $mig$
DECLARE d text := pg_get_functiondef('public.process_sale(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date)'::regprocedure);
  o1 text := $o$        v_fee, v_fee_on_cust, v_ts
      );
$o$;
  n1 text := $n$        v_fee, v_fee_on_cust, v_ts
      ) RETURNING id INTO v_fee_pay_id;

      -- 0139: the fee the customer paid on top is income in the same vessel
      IF v_fee > 0 AND v_fee_on_cust THEN
        UPDATE public.invoice_payments
           SET fee_treasury_id = public.record_customer_fee_income(p_branch_id, v_tenant, v_pm, v_fee, v_ts,
                 'فاتورة ' || v_invoice_number, NULLIF(v_pay->>'reference_number',''))
         WHERE id = v_fee_pay_id;
      END IF;
$n$;
  o2 text := $o$  v_fee_on_cust boolean;$o$;
  n2 text := $n$  v_fee_on_cust boolean;
  v_fee_pay_id uuid;$n$;
BEGIN
  IF position('0139' IN d) > 0 THEN RETURN; END IF;
  IF position(o1 IN d) = 0 OR position(o2 IN d) = 0 THEN RAISE EXCEPTION '0139: process_sale not the expected version'; END IF;
  d := replace(d, o1, n1);
  d := replace(d, o2, n2);
  EXECUTE d;
END
$mig$;

-- record_payment_transaction (plan / contact payments): same, linked as the payment's fee row so a void reverses it
DO $mig$
DECLARE d text := pg_get_functiondef('public.record_payment_transaction(uuid,uuid,numeric,text,text,text,text,numeric,text,boolean,text,text,date)'::regprocedure);
  o text := $o$  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN$o$;
  n text := $n$  -- 0139: the fee the customer paid on top is income in the same vessel
  IF COALESCE(p_fee_amount,0) > 0 AND p_fee_on_customer AND p_direction = 'in' THEN
    v_fee_treasury_id := public.record_customer_fee_income(v_branch, v_tenant, p_payment_method, p_fee_amount, v_ts,
      'دفعة خطة #' || substr(p_payment_plan_id::text,1,8) || ' — ' || COALESCE(v_plan.entity_name, ''), p_reference_number);
  END IF;
  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN$n$;
BEGIN
  IF position('0139' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0139: record_payment_transaction not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

-- void_invoice_payment: the customer's fee row goes back with the payment, on its own day
DO $mig$
DECLARE d text := pg_get_functiondef('public.void_invoice_payment(uuid,text)'::regprocedure);
  o text := $o$  -- Reverse fee if any (fee borne by company)$o$;
  n text := $n$  -- 0139: the fee the customer paid on top (income) is reversed with the payment, on its own day
  IF v_pay.fee_treasury_id IS NOT NULL THEN
    PERFORM public.till_cancel_on_original_date(v_pay.fee_treasury_id,
      'إلغاء عمولة العميل — فاتورة ' || COALESCE(v_inv.invoice_number, '') || COALESCE(' — ' || p_reason, ''));
  END IF;

  -- Reverse fee if any (fee borne by company)$n$;
BEGIN
  IF position('0139' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0139: void_invoice_payment not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('transfer_between_vessels', '0139', 'owner: move money between two vessels of one branch, optional fee (expense)'),
  ('cancel_vessel_transfer', '0139', 'owner: cancel a vessel transfer on its own day')
ON CONFLICT DO NOTHING;

-- a vessel that already has till movements is switched off, never deleted (its rows would point to nothing)
CREATE OR REPLACE FUNCTION public.guard_transfer_fees_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.treasury t WHERE t.tenant_id = OLD.tenant_id AND t.payment_method = OLD.payment_method) THEN
    RAISE EXCEPTION 'الوعاء «%» عليه حركات — عطّله من الإعدادات بدل ما تمسحه', coalesce(OLD.label, OLD.payment_method)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $function$;
DROP TRIGGER IF EXISTS a0_guard_transfer_fees_delete ON public.transfer_fees;
CREATE TRIGGER a0_guard_transfer_fees_delete BEFORE DELETE ON public.transfer_fees
  FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_fees_delete();
