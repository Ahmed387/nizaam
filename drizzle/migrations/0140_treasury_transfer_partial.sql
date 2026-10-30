-- 0140: money transfers between branches — partial acceptance, a date, every vessel, and the books (owner «نفذ», 2026-10-30)
--
-- Before: the receiving branch could only accept ALL or reject ALL; no date (always now); only cash / vodafone /
-- instapay / bank; and nothing was posted to the books, so each branch's cash in the books stayed where it was
-- while its till moved (ledger_gl_reconciliation would show the difference).
-- Now, like stock transfers:
--   شلبى sends 50,000 cash to سكة on 10/3 → شلبى till −50,000 on 10/3 (books: inter-branch 1910 +50,000 / cash −50,000)
--   سكة counts 48,000 → «استلام جزئي» 48,000: سكة till +48,000 and the 2,000 go back to شلبى's till, both on the
--   transfer's day (books: سكة cash +48,000 / 1910 −48,000, شلبى cash +2,000 / 1910 −2,000 → 1910 back to 0).
--   «تأكيد» = receive all, «رفض» = receive 0 (all back). A past date is for the owner / manager only.
--   Same branch → use «تحويل بين الأوعية» (0139).

ALTER TABLE public.treasury_transfers
  ADD COLUMN IF NOT EXISTS transfer_date date,
  ADD COLUMN IF NOT EXISTS received_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS returned_amount numeric(14,2);
UPDATE public.treasury_transfers SET transfer_date = (created_at AT TIME ZONE 'Africa/Cairo')::date WHERE transfer_date IS NULL;

-- journal entries of a till row get the till row's branch
DO $mig$
DECLARE d text := pg_get_functiondef('public.je_fill_branch_from_source()'::regprocedure);
  o text := $o$    WHEN 'expense' THEN$o$;
  n text := $n$    WHEN 'treasury_row' THEN
      SELECT branch_id INTO v_b FROM public.treasury WHERE id = NEW.source_id;
    WHEN 'expense' THEN$n$;
BEGIN
  IF position('treasury_row' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0140: je_fill_branch_from_source not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

-- one inter-branch leg in the books: money out (Dr 1910 / Cr 1100) or in (Dr 1100 / Cr 1910) of the row's branch
CREATE OR REPLACE FUNCTION public.post_treasury_transfer_leg(p_treasury_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t public.treasury%ROWTYPE; v_lines jsonb;
BEGIN
  SELECT * INTO t FROM public.treasury WHERE id = p_treasury_id;
  IF NOT FOUND OR coalesce(t.amount, 0) = 0 THEN RETURN NULL; END IF;
  v_lines := CASE WHEN t.type = 'expense' THEN
      jsonb_build_array(jsonb_build_object('account_code', '1910', 'debit', t.amount, 'credit', 0, 'description', t.description),
                        jsonb_build_object('account_code', '1100', 'debit', 0, 'credit', t.amount, 'description', t.description))
    ELSE
      jsonb_build_array(jsonb_build_object('account_code', '1100', 'debit', t.amount, 'credit', 0, 'description', t.description),
                        jsonb_build_object('account_code', '1910', 'debit', 0, 'credit', t.amount, 'description', t.description))
    END;
  RETURN public.post_journal(t.tenant_id, coalesce(t.transaction_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date),
                             'تحويل بين الفروع', 'treasury_row', t.id, v_lines);
END $function$;
REVOKE ALL ON FUNCTION public.post_treasury_transfer_leg(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.transfer_treasury_atomic(uuid, uuid, numeric, text, text, numeric, text, text, boolean);
CREATE OR REPLACE FUNCTION public.transfer_treasury_atomic(p_from_branch uuid, p_to_branch uuid, p_amount numeric, p_reason text,
  p_payment_method text DEFAULT 'cash', p_fee_amount numeric DEFAULT 0, p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL, p_fee_actually_charged boolean DEFAULT true, p_date date DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_tenant uuid; v_transfer_id uuid; v_wallet_balance numeric; v_row uuid;
  v_fee numeric := COALESCE(p_fee_amount, 0); v_fee_charged boolean := COALESCE(p_fee_actually_charged, true);
  v_pm text := coalesce(nullif(p_payment_method, ''), 'cash'); v_day date := public.cairo_today(); v_ts timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;
  IF p_from_branch = p_to_branch THEN RAISE EXCEPTION 'نفس الفرع؟ استخدم «تحويل بين الأوعية»'; END IF;
  PERFORM public.assert_access(p_from_branch, NULL);
  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_to_branch AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'الفرع المستلم مش موجود'; END IF;
  IF NOT public.vessel_is_known(v_tenant, v_pm) THEN RAISE EXCEPTION 'الوعاء مش موجود أو موقوف من الإعدادات'; END IF;
  IF p_date IS NOT NULL AND p_date <> v_day THEN
    IF NOT (public.is_admin(v_user) OR public.is_owner(v_user) OR public.is_super_admin(v_user)) THEN RAISE EXCEPTION 'تاريخ قديم للمالك والمدير بس'; END IF;
    IF p_date > v_day THEN RAISE EXCEPTION 'مينفعش تاريخ بعد النهارده'; END IF;
    v_day := p_date;
  END IF;
  v_ts := CASE WHEN v_day = public.cairo_today() THEN now() ELSE (v_day + time '12:00') AT TIME ZONE 'Africa/Cairo' END;
  IF v_fee < 0 THEN RAISE EXCEPTION 'عمولة غير صالحة'; END IF;

  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0) INTO v_wallet_balance
    FROM public.treasury WHERE branch_id = p_from_branch AND coalesce(nullif(payment_method, ''), 'cash') = v_pm;
  IF v_wallet_balance < (p_amount + CASE WHEN v_fee_charged THEN v_fee ELSE 0 END)
     AND NOT EXISTS (SELECT 1 FROM public.transfer_fees f WHERE f.tenant_id = v_tenant AND f.payment_method = v_pm AND f.kind = 'virtual') THEN
    RAISE EXCEPTION 'رصيد الوعاء غير كافٍ — المتاح: % ج.م', v_wallet_balance;
  END IF;

  PERFORM set_config('app.transfer_ctx', 'on', true);
  INSERT INTO public.treasury_transfers(from_branch_id, to_branch_id, amount, reason, transferred_by, tenant_id,
    payment_method, fee_amount, reference_number, transfer_to_account, fee_actually_charged, transfer_date, created_at)
  VALUES (p_from_branch, p_to_branch, round(p_amount, 2), p_reason, v_user, v_tenant,
    v_pm, v_fee, p_reference_number, p_transfer_to_account, v_fee_charged, v_day, v_ts)
  RETURNING id INTO v_transfer_id;
  PERFORM set_config('app.transfer_ctx', 'off', true);

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method,
                              reference_number, transfer_to_account, reference_id, transaction_date, created_at)
  VALUES (p_from_branch, 'expense', 'transfer', round(p_amount, 2), 'تحويل لفرع: ' || COALESCE(p_reason, ''), v_user, v_tenant,
          v_pm, p_reference_number, p_transfer_to_account, v_transfer_id, v_day, v_ts)
  RETURNING id INTO v_row;
  PERFORM public.post_treasury_transfer_leg(v_row);

  IF v_fee > 0 AND v_fee_charged THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, is_fee,
                                reference_number, reference_id, transaction_date, created_at)
    VALUES (p_from_branch, 'expense', 'transfer_fee', v_fee, 'عمولة تحويل (' || v_pm || ')', v_user, v_tenant,
            v_pm, true, p_reference_number, v_transfer_id, v_day, v_ts);
  END IF;
  RETURN v_transfer_id;
END;
$function$;

-- receive part (or all, or nothing): the rest goes back to the sender — both on the transfer's day
CREATE OR REPLACE FUNCTION public.receive_treasury_transfer(p_transfer_id uuid, p_received numeric, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_user uuid := auth.uid(); tr public.treasury_transfers%ROWTYPE; v_back numeric; v_row uuid; v_day date; v_ts timestamptz;
  v_pm text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO tr FROM public.treasury_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.assert_same_tenant(tr.tenant_id);
  IF NOT (public.is_admin(v_user) OR public.is_owner(v_user) OR public.user_in_branch(v_user, tr.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية استلام هذا التحويل';
  END IF;
  IF tr.acknowledged_at IS NOT NULL OR tr.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'التحويل اتقفل قبل كده'; END IF;
  IF p_received IS NULL OR p_received < 0 OR p_received > tr.amount THEN RAISE EXCEPTION 'المبلغ المستلم لازم يكون بين 0 و %', tr.amount; END IF;
  IF p_received < tr.amount AND coalesce(trim(p_note), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الفرق'; END IF;

  v_pm := coalesce(tr.payment_method, 'cash');
  v_day := coalesce(tr.transfer_date, (tr.created_at AT TIME ZONE 'Africa/Cairo')::date);
  v_day := public.ledger_effective_date(tr.tenant_id, v_day);
  -- after the sending row in the till's time order, on the transfer's day
  v_ts := greatest(tr.created_at + interval '1 second', (v_day + time '00:00') AT TIME ZONE 'Africa/Cairo');
  v_back := round(tr.amount - p_received, 2);
  -- the fee stays an expense of the sender (the provider took it); nothing else moves

  IF p_received > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method,
                                reference_number, reference_id, transaction_date, created_at)
    VALUES (tr.to_branch_id, 'income', 'transfer', round(p_received, 2),
            'تحويل وارد' || CASE WHEN v_back > 0 THEN ' (جزئي)' ELSE '' END || ': ' || coalesce(tr.reason, ''), v_user, tr.tenant_id,
            v_pm, tr.reference_number, tr.id, v_day, v_ts)
    RETURNING id INTO v_row;
    PERFORM public.post_treasury_transfer_leg(v_row);
  END IF;
  IF v_back > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id,
                                transaction_date, created_at)
    -- category 'transfer' (not '…refund'): a refund category would be read as a customer refund / other income
    VALUES (tr.from_branch_id, 'income', 'transfer', v_back,
            'رجع من تحويل' || CASE WHEN p_received = 0 THEN ' مرفوض' ELSE ' (الفرق)' END || ': ' || coalesce(p_note, ''),
            v_user, tr.tenant_id, v_pm, tr.id, v_day, v_ts)
    RETURNING id INTO v_row;
    PERFORM public.post_treasury_transfer_leg(v_row);
  END IF;

  UPDATE public.treasury_transfers
     SET received_amount = round(p_received, 2), returned_amount = v_back,
         acknowledged_at = CASE WHEN p_received > 0 THEN now() END, acknowledged_by = CASE WHEN p_received > 0 THEN v_user END,
         rejected_at = CASE WHEN p_received = 0 THEN now() END, rejected_by = CASE WHEN p_received = 0 THEN v_user END,
         rejection_reason = CASE WHEN p_received < tr.amount THEN p_note END,
         dest_credited_at = CASE WHEN p_received > 0 THEN now() END
   WHERE id = tr.id;

  INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
  SELECT bu.user_id, tr.tenant_id,
         CASE WHEN p_received = tr.amount THEN '✅ تأكيد استلام تحويل' WHEN p_received = 0 THEN '❌ رفض تحويل خزنة' ELSE '⚠️ استلام جزئي لتحويل' END,
         'استلم ' || p_received || ' من ' || tr.amount || ' ج.م' || CASE WHEN v_back > 0 THEN ' — رجع لكم ' || v_back || coalesce(' (' || p_note || ')', '') ELSE '' END,
         'general', 'treasury_transfer', tr.id, '/branch/' || tr.from_branch_id || '/treasury'
    FROM public.branch_users bu JOIN public.user_roles ur ON ur.user_id = bu.user_id
   WHERE bu.branch_id = tr.from_branch_id AND ur.role = 'branch_manager';

  RETURN jsonb_build_object('id', tr.id, 'received', round(p_received, 2), 'returned', v_back);
END $function$;

-- the old buttons: «تأكيد» = receive all, «رفض» = receive nothing
CREATE OR REPLACE FUNCTION public.acknowledge_treasury_transfer(p_transfer_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.receive_treasury_transfer(p_transfer_id, (SELECT amount FROM public.treasury_transfers WHERE id = p_transfer_id), NULL);
END $function$;
CREATE OR REPLACE FUNCTION public.reject_treasury_transfer(p_transfer_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.receive_treasury_transfer(p_transfer_id, 0, coalesce(nullif(trim(p_reason), ''), 'مرفوض'));
END $function$;

REVOKE ALL ON FUNCTION public.transfer_treasury_atomic(uuid, uuid, numeric, text, text, numeric, text, text, boolean, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_treasury_transfer(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_treasury_atomic(uuid, uuid, numeric, text, text, numeric, text, text, boolean, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_treasury_transfer(uuid, numeric, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('receive_treasury_transfer', '0140', 'owner: receive part / all / nothing of a money transfer; the rest goes back to the sender')
ON CONFLICT DO NOTHING;
