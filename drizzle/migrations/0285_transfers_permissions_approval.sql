-- 0285 — money and goods transfers between branches (owner 2026-11-25, answers «أ ب ج» + «نفذ»):
--  1) Permissions per person per branch, set by the owner in settings → «الموظفين»:
--       money_transfers.view   «يتبلغ ويشوف»   money_transfers.create «يبعت / يعدّل / يلغي قبل الاستلام»
--       money_transfers.update «يستلم / يرفض»  — and the same three on goods: transfers.view / .create / .update (new).
--     Defaults = how it worked: branch manager all six, warehouse the goods three, accountant both «يتبلغ», cashier none.
--     A «عرض فقط» branch never gets a send / receive key (write keys) — only «يتبلغ», which the owner can close too.
--     The server checks them: before, ANY user of the branch could send / receive (a cashier and a «عرض فقط» manager did).
--  2) Owner approval above a limit he sets in settings (`transfer_approval_limits` = {money, goods}; 0 = never): a
--     non-owner's transfer above it waits («مستني موافقة المالك») — NOTHING moves (no till row, no stock) until he approves
--     on «طلبات الموافقة» (approval_requests entity 'treasury_transfer' / 'stock_transfer' = the group); approval moves it
--     that day, refusal leaves everything as it was. Goods are valued at the sender's average cost.
--  3) The sender may edit (amount + fee / quantity) or cancel a transfer while it is not received: money reverses its till
--     rows on their own day (`till_cancel_on_original_date` + the leg's entry) and posts the new ones on the transfer day;
--     goods move the difference with a stock movement on the transfer day. An increase above the limit by a non-owner is
--     refused («الغي واعمل تحويل جديد»).
--  4) The receiver picks the vessel / number the money really arrived on (the rest goes back to the sender's vessel).
--  5) The fee of a money transfer is typed by the sender: none / fixed / percent of the amount (never on cash).
--  6) Notifications go only to people with one of the three keys of that kind in the sending or receiving branch (and the
--     owner / managers), never to the person who did it, with who sent / received what, how much and on which vessel.
--  7) Goods batches: sending never took batches, so a rejection / partial receipt adding a «transfer_return» batch made
--     Σ batches > quantity. They no longer add one (cancel neither).
--  8) `purge_document_log('مسح')` — owner, empties «سجل المستندات» (like purge_audit_log).

CREATE OR REPLACE FUNCTION pg_temp.rep(p_fn regprocedure, p_old text, p_new text) RETURNS void LANGUAGE plpgsql AS $r$
DECLARE d text := pg_get_functiondef(p_fn);
BEGIN
  IF position(p_old IN d) = 0 THEN RAISE EXCEPTION 'anchor not found in %: %', p_fn, left(p_old, 80); END IF;
  EXECUTE replace(d, p_old, p_new);
END $r$;

-- ── permission defaults (mirror DEFAULT_ROLE_PERMISSIONS in src/lib/roles.ts) ──────────────────────────────────────
SELECT pg_temp.rep('public.role_permission_default(text,text)'::regprocedure,
  $$'transfers.view','transfers.create',
      'customers.view'$$,
  $$'transfers.view','transfers.create','transfers.update',
      'money_transfers.view','money_transfers.create','money_transfers.update',
      'customers.view'$$);
SELECT pg_temp.rep('public.role_permission_default(text,text)'::regprocedure,
  $$'reports.view','salaries.create'])
    WHEN 'cashier'$$,
  $$'reports.view','salaries.create','money_transfers.view','transfers.view'])
    WHEN 'cashier'$$);
SELECT pg_temp.rep('public.role_permission_default(text,text)'::regprocedure,
  $$'transfers.view','transfers.create',
      'shipments.view'$$,
  $$'transfers.view','transfers.create','transfers.update',
      'shipments.view'$$);

-- ── approval limits ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_limit(p_tenant uuid, p_kind text)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT nullif(s.value ->> p_kind, '')::numeric FROM public.settings s
                    WHERE s.scope = p_tenant AND s.key = 'transfer_approval_limits'), 0)
$function$;
REVOKE ALL ON FUNCTION public.transfer_limit(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_transfer_approval_limits()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('money', public.transfer_limit(public.current_tenant_id(), 'money'),
                            'goods', public.transfer_limit(public.current_tenant_id(), 'goods'))
$function$;

CREATE OR REPLACE FUNCTION public.set_transfer_approval_limits(p_money numeric, p_goods numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حد موافقة التحويلات بيحدده صاحب الشركة بس' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_money, 0) < 0 OR coalesce(p_goods, 0) < 0 THEN RAISE EXCEPTION 'الحد لازم يكون صفر أو أكبر'; END IF;
  INSERT INTO public.settings (key, value, tenant_id, updated_at, updated_by)
  VALUES ('transfer_approval_limits',
          jsonb_build_object('money', round(coalesce(p_money, 0), 2), 'goods', round(coalesce(p_goods, 0), 2)), v_t, now(), auth.uid())
  ON CONFLICT (scope, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
  RETURN public.get_transfer_approval_limits();
END $function$;

-- ── notifications: only the people allowed on that kind of transfer ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_notify(p_tenant uuid, p_kind text, p_from uuid, p_to uuid, p_title text,
  p_body text, p_entity text, p_entity_id uuid)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pre text := CASE WHEN p_kind = 'money' THEN 'money_transfers' ELSE 'transfers' END;
  r record; n int := 0; v_me uuid := auth.uid(); v_br uuid;
BEGIN
  FOR r IN
    WITH cand AS (
      SELECT bu.user_id, bu.branch_id FROM public.branch_users bu JOIN public.profiles p ON p.id = bu.user_id
       WHERE bu.branch_id IN (p_from, p_to) AND p.tenant_id = p_tenant AND coalesce(p.is_active, true)
      UNION
      SELECT ur.user_id, NULL::uuid FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
       WHERE p.tenant_id = p_tenant AND ur.role::text IN ('owner', 'admin') AND coalesce(p.is_active, true)
    )
    SELECT c.user_id, array_agg(c.branch_id) AS branches
      FROM cand c
     WHERE c.user_id IS DISTINCT FROM v_me
       AND (public.perm_resolve(c.user_id, v_pre || '.view', c.branch_id)
            OR public.perm_resolve(c.user_id, v_pre || '.create', c.branch_id)
            OR public.perm_resolve(c.user_id, v_pre || '.update', c.branch_id))
     GROUP BY c.user_id
  LOOP
    v_br := CASE WHEN p_to = ANY (r.branches) THEN p_to WHEN p_from = ANY (r.branches) THEN p_from ELSE p_to END;
    INSERT INTO public.notifications (user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    VALUES (r.user_id, p_tenant, p_title, p_body, CASE WHEN p_kind = 'money' THEN 'treasury_transfer' ELSE 'stock_transfer' END,
            p_entity, p_entity_id,
            '/branch/' || v_br || CASE WHEN p_kind = 'money' THEN '/treasury' ELSE '/transfers' END);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.transfer_notify(uuid, text, uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tr_person(p uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce((SELECT name FROM public.profiles WHERE id = p), 'حد') $function$;
CREATE OR REPLACE FUNCTION public.tr_branch(b uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce((SELECT btrim(name) FROM public.branches WHERE id = b), 'فرع') $function$;
REVOKE ALL ON FUNCTION public.tr_person(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tr_branch(uuid) FROM PUBLIC, anon, authenticated;

-- the old row triggers notified fixed roles per row; the functions below notify now
CREATE OR REPLACE FUNCTION public.notify_treasury_transfer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RETURN NEW; END $function$;
CREATE OR REPLACE FUNCTION public.notify_stock_transfer_recipient() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RETURN NEW; END $function$;
CREATE OR REPLACE FUNCTION public.notify_stock_transfer_decision()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_product text; v_body text;
BEGIN
  IF NEW.status = OLD.status OR OLD.status <> 'pending' OR NEW.status NOT IN ('confirmed', 'rejected') THEN RETURN NEW; END IF;
  SELECT name INTO v_product FROM public.products WHERE id = NEW.product_id;
  IF NEW.status = 'rejected' THEN
    v_body := public.tr_person(NEW.confirmed_by) || ' في ' || public.tr_branch(NEW.to_branch_id) || ' رفض ' || coalesce(v_product, 'صنف')
              || ' (' || NEW.quantity || ') اللي بعته ' || public.tr_person(NEW.transferred_by) || ' من ' || public.tr_branch(NEW.from_branch_id)
              || coalesce(' — السبب: ' || NEW.rejection_reason, '');
    PERFORM public.transfer_notify(NEW.tenant_id, 'goods', NEW.from_branch_id, NEW.to_branch_id, '❌ رفض تحويل بضاعة', v_body, 'stock_transfer', NEW.id);
  ELSE
    v_body := public.tr_person(NEW.confirmed_by) || ' في ' || public.tr_branch(NEW.to_branch_id) || ' استلم ' || coalesce(NEW.received_quantity, NEW.quantity)
              || ' من ' || NEW.quantity || ' ' || coalesce(v_product, 'صنف') || ' بعتهم ' || public.tr_person(NEW.transferred_by)
              || ' من ' || public.tr_branch(NEW.from_branch_id)
              || CASE WHEN coalesce(NEW.received_quantity, NEW.quantity) < NEW.quantity
                      THEN ' — رجع ' || (NEW.quantity - coalesce(NEW.received_quantity, 0)) || ' للفرع المرسل' ELSE '' END;
    PERFORM public.transfer_notify(NEW.tenant_id, 'goods', NEW.from_branch_id, NEW.to_branch_id, '✅ استلام تحويل بضاعة', v_body, 'stock_transfer', NEW.id);
  END IF;
  RETURN NEW;
END $function$;

-- ═════════════════════════════════════ MONEY ═════════════════════════════════════════════════════════════════════
ALTER TABLE public.treasury_transfers
  ADD COLUMN IF NOT EXISTS approval_status text CHECK (approval_status IN ('waiting', 'approved', 'refused')),
  ADD COLUMN IF NOT EXISTS send_row_id uuid,
  ADD COLUMN IF NOT EXISTS fee_row_id uuid,
  ADD COLUMN IF NOT EXISTS fee_mode text,
  ADD COLUMN IF NOT EXISTS fee_value numeric,
  ADD COLUMN IF NOT EXISTS received_method text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edit_note text;
UPDATE public.treasury_transfers tr SET
  send_row_id = (SELECT t.id FROM public.treasury t WHERE t.reference_id = tr.id AND t.branch_id = tr.from_branch_id
                   AND t.type = 'expense' AND t.category = 'transfer' ORDER BY t.created_at LIMIT 1),
  fee_row_id = (SELECT t.id FROM public.treasury t WHERE t.reference_id = tr.id AND t.branch_id = tr.from_branch_id
                  AND t.type = 'expense' AND t.category = 'transfer_fee' ORDER BY t.created_at LIMIT 1)
 WHERE tr.send_row_id IS NULL;

CREATE OR REPLACE FUNCTION public.money_transfer_fee(p_method text, p_amount numeric, p_mode text, p_value numeric)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN coalesce(nullif(p_method, ''), 'cash') = 'cash' THEN 0
              WHEN p_mode = 'fixed' THEN round(greatest(coalesce(p_value, 0), 0), 2)
              WHEN p_mode = 'percent' THEN round(greatest(coalesce(p_amount, 0), 0) * greatest(coalesce(p_value, 0), 0) / 100, 2)
              ELSE 0 END
$function$;

-- writes the sender's till rows (+ fee) of a transfer that is allowed to move
CREATE OR REPLACE FUNCTION public._money_transfer_post(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE tr public.treasury_transfers%ROWTYPE; v_bal numeric; v_row uuid; v_fee_row uuid; v_ts timestamptz; v_fee numeric;
BEGIN
  SELECT * INTO tr FROM public.treasury_transfers WHERE id = p_id FOR UPDATE;
  v_fee := CASE WHEN coalesce(tr.fee_actually_charged, true) THEN coalesce(tr.fee_amount, 0) ELSE 0 END;
  v_ts := CASE WHEN (tr.created_at AT TIME ZONE 'Africa/Cairo')::date = tr.transfer_date THEN tr.created_at
               ELSE (tr.transfer_date + time '12:00') AT TIME ZONE 'Africa/Cairo' END;
  SELECT coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) INTO v_bal
    FROM public.treasury WHERE branch_id = tr.from_branch_id AND coalesce(nullif(payment_method, ''), 'cash') = tr.payment_method;
  IF v_bal < tr.amount + v_fee
     AND NOT EXISTS (SELECT 1 FROM public.transfer_fees f WHERE f.tenant_id = tr.tenant_id AND f.payment_method = tr.payment_method AND f.kind = 'virtual') THEN
    RAISE EXCEPTION 'رصيد الوعاء غير كافٍ — المتاح: % ج.م', v_bal;
  END IF;
  INSERT INTO public.treasury (branch_id, type, category, amount, description, created_by, tenant_id, payment_method,
                               reference_number, transfer_to_account, reference_id, transaction_date, created_at, transfer_from_account)
  VALUES (tr.from_branch_id, 'expense', 'transfer', tr.amount, 'تحويل لفرع ' || public.tr_branch(tr.to_branch_id) || ': ' || coalesce(tr.reason, ''),
          coalesce(auth.uid(), tr.transferred_by), tr.tenant_id, tr.payment_method, tr.reference_number, tr.transfer_to_account, tr.id,
          tr.transfer_date, v_ts, tr.transfer_from_account)
  RETURNING id INTO v_row;
  PERFORM public.post_treasury_transfer_leg(v_row);
  IF v_fee > 0 THEN
    INSERT INTO public.treasury (branch_id, type, category, amount, description, created_by, tenant_id, payment_method, is_fee,
                                 reference_number, reference_id, transaction_date, created_at, transfer_from_account)
    VALUES (tr.from_branch_id, 'expense', 'transfer_fee', v_fee, 'عمولة تحويل لفرع ' || public.tr_branch(tr.to_branch_id),
            coalesce(auth.uid(), tr.transferred_by), tr.tenant_id, tr.payment_method, true, tr.reference_number, tr.id,
            tr.transfer_date, v_ts, tr.transfer_from_account)
    RETURNING id INTO v_fee_row;
  END IF;
  UPDATE public.treasury_transfers SET send_row_id = v_row, fee_row_id = v_fee_row WHERE id = tr.id;
END $function$;

-- reverses the sender's rows on their own day
CREATE OR REPLACE FUNCTION public._money_transfer_unpost(p_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE tr public.treasury_transfers%ROWTYPE; r uuid;
BEGIN
  SELECT * INTO tr FROM public.treasury_transfers WHERE id = p_id FOR UPDATE;
  PERFORM set_config('app.reverse_on_original_date', '1', true);
  FOREACH r IN ARRAY array_remove(ARRAY[tr.send_row_id, tr.fee_row_id], NULL) LOOP
    PERFORM public.till_cancel_on_original_date(r, p_reason);
    PERFORM public.reverse_journal_for_source(tr.tenant_id, 'treasury_row', r, p_reason);
  END LOOP;
  PERFORM set_config('app.reverse_on_original_date', '0', true);
  UPDATE public.treasury_transfers SET send_row_id = NULL, fee_row_id = NULL WHERE id = tr.id;
END $function$;
REVOKE ALL ON FUNCTION public._money_transfer_post(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._money_transfer_unpost(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.money_transfer_text(p_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT to_char(tr.amount, 'FM999,999,999,990.00') || ' ج.م ' || public.tg_method_label(tr.tenant_id, tr.payment_method)
         || ' من ' || public.tr_branch(tr.from_branch_id) || ' لـ ' || public.tr_branch(tr.to_branch_id)
         || ' — بعته ' || public.tr_person(tr.transferred_by)
         || CASE WHEN coalesce(tr.fee_amount, 0) > 0 THEN ' — عمولة ' || tr.fee_amount ELSE '' END
         || coalesce(' — ' || nullif(btrim(tr.reason), ''), '')
    FROM public.treasury_transfers tr WHERE tr.id = p_id
$function$;
REVOKE ALL ON FUNCTION public.money_transfer_text(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.transfer_treasury_atomic(uuid, uuid, numeric, text, text, numeric, text, text, boolean, date, text);
CREATE OR REPLACE FUNCTION public.transfer_treasury_atomic(p_from_branch uuid, p_to_branch uuid, p_amount numeric, p_reason text,
  p_payment_method text DEFAULT 'cash', p_fee_amount numeric DEFAULT 0, p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL, p_fee_actually_charged boolean DEFAULT true, p_date date DEFAULT NULL,
  p_transfer_from_account text DEFAULT NULL, p_fee_mode text DEFAULT NULL, p_fee_value numeric DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_tenant uuid; v_id uuid; v_owner boolean; v_limit numeric; v_wait boolean;
  v_fee numeric; v_fee_charged boolean := coalesce(p_fee_actually_charged, true);
  v_pm text := coalesce(nullif(p_payment_method, ''), 'cash'); v_day date := public.cairo_today(); v_ts timestamptz; v_req uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;
  IF p_from_branch = p_to_branch THEN RAISE EXCEPTION 'نفس الفرع؟ استخدم «تحويل بين الأوعية»'; END IF;
  PERFORM public.assert_access(p_from_branch, NULL);
  PERFORM public.require_switch('money_transfers.create', p_from_branch, 'تحويل الفلوس بين الفروع ← يبعت');
  v_owner := public.is_owner(v_user) OR public.is_super_admin(v_user);
  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_to_branch AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'الفرع المستلم مش موجود'; END IF;
  IF NOT public.vessel_is_known(v_tenant, v_pm) THEN RAISE EXCEPTION 'الوعاء مش موجود أو موقوف من الإعدادات'; END IF;
  IF EXISTS (SELECT 1 FROM public.vessel_accounts va WHERE va.tenant_id = v_tenant AND va.payment_method = v_pm AND va.is_active) THEN
    IF NOT EXISTS (SELECT 1 FROM public.vessel_accounts va WHERE va.tenant_id = v_tenant AND va.payment_method = v_pm AND va.is_active
                     AND va.number_key = public.vessel_account_key(p_transfer_from_account)) THEN
      RAISE EXCEPTION 'اختار الحساب اللي هيتحول منه';
    END IF;
  END IF;
  IF p_date IS NOT NULL AND p_date <> v_day THEN
    IF NOT (public.is_admin(v_user) OR v_owner) THEN RAISE EXCEPTION 'تاريخ قديم للمالك والمدير بس'; END IF;
    IF p_date > v_day THEN RAISE EXCEPTION 'مينفعش تاريخ بعد النهارده'; END IF;
    v_day := p_date;
  END IF;
  v_ts := CASE WHEN v_day = public.cairo_today() THEN now() ELSE (v_day + time '12:00') AT TIME ZONE 'Africa/Cairo' END;
  -- 0285: the sender types the fee (none / fixed / percent); never on cash
  IF p_fee_mode IS NOT NULL THEN
    IF p_fee_mode NOT IN ('none', 'fixed', 'percent') THEN RAISE EXCEPTION 'نوع العمولة غلط'; END IF;
    v_fee := public.money_transfer_fee(v_pm, p_amount, p_fee_mode, p_fee_value);
  ELSE
    v_fee := CASE WHEN v_pm = 'cash' THEN 0 ELSE round(greatest(coalesce(p_fee_amount, 0), 0), 2) END;
  END IF;
  IF v_fee >= p_amount THEN RAISE EXCEPTION 'العمولة أكبر من المبلغ'; END IF;
  v_limit := public.transfer_limit(v_tenant, 'money');
  v_wait := NOT v_owner AND v_limit > 0 AND p_amount > v_limit;

  PERFORM set_config('app.transfer_ctx', 'on', true);
  INSERT INTO public.treasury_transfers (from_branch_id, to_branch_id, amount, reason, transferred_by, tenant_id, payment_method,
    fee_amount, reference_number, transfer_to_account, fee_actually_charged, transfer_date, created_at, transfer_from_account,
    fee_mode, fee_value, approval_status)
  VALUES (p_from_branch, p_to_branch, round(p_amount, 2), p_reason, v_user, v_tenant, v_pm, v_fee, p_reference_number,
    nullif(btrim(p_transfer_to_account), ''), v_fee_charged, v_day, v_ts, nullif(btrim(p_transfer_from_account), ''),
    coalesce(p_fee_mode, CASE WHEN v_fee > 0 THEN 'fixed' ELSE 'none' END), coalesce(p_fee_value, v_fee),
    CASE WHEN v_wait THEN 'waiting' END)
  RETURNING id INTO v_id;
  PERFORM set_config('app.transfer_ctx', 'off', true);

  IF v_wait THEN
    INSERT INTO public.approval_requests (tenant_id, branch_id, entity_type, entity_id, entity_label, action, payload, reason,
                                          requested_by, requested_by_name)
    VALUES (v_tenant, p_from_branch, 'treasury_transfer', v_id, 'تحويل فلوس ' || public.money_transfer_text(v_id), 'update',
            jsonb_build_object('kind', 'money_transfer', 'amount', round(p_amount, 2), 'limit', v_limit, 'from', p_from_branch,
                               'to', p_to_branch, 'method', v_pm, 'fee', v_fee),
            coalesce(nullif(btrim(p_reason), ''), 'تحويل فوق حد موافقة المالك'), v_user, public.tr_person(v_user))
    RETURNING id INTO v_req;
  ELSE
    PERFORM public._money_transfer_post(v_id);
    PERFORM public.transfer_notify(v_tenant, 'money', p_from_branch, p_to_branch, '💰 تحويل فلوس بين الفروع',
                                   public.money_transfer_text(v_id) || ' — مستني الاستلام', 'treasury_transfer', v_id);
  END IF;
  RETURN v_id;
END $function$;

DROP FUNCTION IF EXISTS public.receive_treasury_transfer(uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.receive_treasury_transfer(p_transfer_id uuid, p_received numeric, p_note text DEFAULT NULL,
  p_method text DEFAULT NULL, p_account text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user uuid := auth.uid(); tr public.treasury_transfers%ROWTYPE; v_back numeric; v_row uuid; v_day date; v_ts timestamptz;
  v_in text; v_acc text; v_body text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO tr FROM public.treasury_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.assert_same_tenant(tr.tenant_id);
  IF NOT (public.is_owner(v_user) OR public.is_super_admin(v_user)) THEN
    PERFORM public.assert_access(tr.to_branch_id, NULL);
    PERFORM public.require_switch('money_transfers.update', tr.to_branch_id, 'تحويل الفلوس بين الفروع ← يستلم / يرفض');
  END IF;
  IF tr.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'التحويل ده اتلغى من الفرع المرسل'; END IF;
  IF tr.approval_status = 'waiting' THEN RAISE EXCEPTION 'التحويل ده لسه مستني موافقة المالك'; END IF;
  IF tr.approval_status = 'refused' THEN RAISE EXCEPTION 'المالك رفض التحويل ده'; END IF;
  IF tr.acknowledged_at IS NOT NULL OR tr.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'التحويل اتقفل قبل كده'; END IF;
  IF p_received IS NULL OR p_received < 0 OR p_received > tr.amount THEN RAISE EXCEPTION 'المبلغ المستلم لازم يكون بين 0 و %', tr.amount; END IF;
  IF p_received < tr.amount AND coalesce(trim(p_note), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الفرق'; END IF;

  -- 0285: the vessel / number it really arrived on (the sender's vessel when not chosen)
  v_in := coalesce(nullif(p_method, ''), tr.payment_method, 'cash');
  v_acc := CASE WHEN v_in = tr.payment_method THEN coalesce(nullif(btrim(p_account), ''), tr.transfer_to_account) ELSE nullif(btrim(p_account), '') END;
  IF p_received > 0 THEN
    IF NOT public.vessel_is_known(tr.tenant_id, v_in) THEN RAISE EXCEPTION 'الوعاء مش موجود أو موقوف من الإعدادات'; END IF;
    IF EXISTS (SELECT 1 FROM public.vessel_accounts va WHERE va.tenant_id = tr.tenant_id AND va.payment_method = v_in AND va.is_active)
       AND NOT EXISTS (SELECT 1 FROM public.vessel_accounts va WHERE va.tenant_id = tr.tenant_id AND va.payment_method = v_in AND va.is_active
                         AND va.number_key = public.vessel_account_key(v_acc)) THEN
      RAISE EXCEPTION 'اختار الرقم / الحساب اللي الفلوس وصلت عليه';
    END IF;
  END IF;

  v_day := public.ledger_effective_date(tr.tenant_id, coalesce(tr.transfer_date, (tr.created_at AT TIME ZONE 'Africa/Cairo')::date));
  v_ts := greatest(tr.created_at + interval '1 second', (v_day + time '00:00') AT TIME ZONE 'Africa/Cairo');
  v_back := round(tr.amount - p_received, 2);
  IF p_received > 0 THEN
    INSERT INTO public.treasury (branch_id, type, category, amount, description, created_by, tenant_id, payment_method,
                                 reference_number, reference_id, transaction_date, created_at, transfer_to_account)
    VALUES (tr.to_branch_id, 'income', 'transfer', round(p_received, 2),
            'تحويل وارد من ' || public.tr_branch(tr.from_branch_id) || CASE WHEN v_back > 0 THEN ' (جزئي)' ELSE '' END || ': ' || coalesce(tr.reason, ''),
            v_user, tr.tenant_id, v_in, tr.reference_number, tr.id, v_day, v_ts, v_acc)
    RETURNING id INTO v_row;
    PERFORM public.post_treasury_transfer_leg(v_row);
  END IF;
  IF v_back > 0 THEN
    INSERT INTO public.treasury (branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id,
                                 transaction_date, created_at, transfer_to_account)
    VALUES (tr.from_branch_id, 'income', 'transfer', v_back,
            'رجع من تحويل' || CASE WHEN p_received = 0 THEN ' مرفوض' ELSE ' (الفرق)' END || ': ' || coalesce(p_note, ''),
            v_user, tr.tenant_id, tr.payment_method, tr.id, v_day, v_ts, tr.transfer_from_account)
    RETURNING id INTO v_row;
    PERFORM public.post_treasury_transfer_leg(v_row);
  END IF;

  UPDATE public.treasury_transfers
     SET received_amount = round(p_received, 2), returned_amount = v_back, received_method = CASE WHEN p_received > 0 THEN v_in END,
         received_by = public.tr_person(v_user),
         acknowledged_at = CASE WHEN p_received > 0 THEN now() END, acknowledged_by = CASE WHEN p_received > 0 THEN v_user END,
         rejected_at = CASE WHEN p_received = 0 THEN now() END, rejected_by = CASE WHEN p_received = 0 THEN v_user END,
         rejection_reason = CASE WHEN p_received < tr.amount THEN p_note END,
         dest_credited_at = CASE WHEN p_received > 0 THEN now() END
   WHERE id = tr.id;

  v_body := public.tr_person(v_user) || ' في ' || public.tr_branch(tr.to_branch_id)
            || CASE WHEN p_received = 0 THEN ' رفض ' ELSE ' استلم ' || to_char(p_received, 'FM999,999,999,990.00') || ' على '
                    || public.tg_method_label(tr.tenant_id, v_in) || ' من ' END
            || to_char(tr.amount, 'FM999,999,999,990.00') || ' بعتهم ' || public.tr_person(tr.transferred_by) || ' من ' || public.tr_branch(tr.from_branch_id)
            || CASE WHEN v_back > 0 THEN ' — رجع ' || to_char(v_back, 'FM999,999,999,990.00') || ' للمرسل' || coalesce(' (' || p_note || ')', '') ELSE '' END;
  PERFORM public.transfer_notify(tr.tenant_id, 'money', tr.from_branch_id, tr.to_branch_id,
    CASE WHEN p_received = tr.amount THEN '✅ استلام تحويل فلوس' WHEN p_received = 0 THEN '❌ رفض تحويل فلوس' ELSE '⚠️ استلام جزئي لتحويل فلوس' END,
    v_body, 'treasury_transfer', tr.id);
  RETURN jsonb_build_object('id', tr.id, 'received', round(p_received, 2), 'returned', v_back, 'method', v_in);
END $function$;

CREATE OR REPLACE FUNCTION public.money_transfer_guard_sender(tr public.treasury_transfers)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_same_tenant(tr.tenant_id);
  IF NOT (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    PERFORM public.assert_access(tr.from_branch_id, NULL);
    PERFORM public.require_switch('money_transfers.create', tr.from_branch_id, 'تحويل الفلوس بين الفروع ← يبعت / يعدّل / يلغي');
  END IF;
  IF tr.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'التحويل ده متلغي قبل كده'; END IF;
  IF tr.acknowledged_at IS NOT NULL OR tr.rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'التحويل اتستلم / اترفض خلاص — مينفعش يتعدّل أو يتلغي';
  END IF;
  IF tr.approval_status = 'refused' THEN RAISE EXCEPTION 'المالك رفض التحويل ده'; END IF;
END $function$;
REVOKE ALL ON FUNCTION public.money_transfer_guard_sender(public.treasury_transfers) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_money_transfer(p_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE tr public.treasury_transfers%ROWTYPE; v_why text := nullif(btrim(p_reason), ''); v_txt text;
BEGIN
  SELECT * INTO tr FROM public.treasury_transfers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.money_transfer_guard_sender(tr);
  IF v_why IS NULL THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  v_txt := public.money_transfer_text(tr.id);
  IF coalesce(tr.approval_status, '') <> 'waiting' THEN
    PERFORM public._money_transfer_unpost(tr.id, 'إلغاء تحويل لفرع: ' || v_why);
  END IF;
  UPDATE public.treasury_transfers SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_why WHERE id = tr.id;
  UPDATE public.approval_requests SET status = 'rejected', admin_note = 'اتلغى من الفرع المرسل: ' || v_why
   WHERE entity_type = 'treasury_transfer' AND entity_id = tr.id AND status = 'pending';
  PERFORM public.transfer_notify(tr.tenant_id, 'money', tr.from_branch_id, tr.to_branch_id, '🚫 اتلغى تحويل فلوس',
    public.tr_person(auth.uid()) || ' لغى ' || v_txt || ' — السبب: ' || v_why, 'treasury_transfer', tr.id);
  RETURN jsonb_build_object('id', tr.id, 'cancelled', true, 'was_waiting', coalesce(tr.approval_status, '') = 'waiting');
END $function$;

CREATE OR REPLACE FUNCTION public.edit_money_transfer(p_id uuid, p_amount numeric, p_fee_mode text, p_fee_value numeric, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE tr public.treasury_transfers%ROWTYPE; v_why text := nullif(btrim(p_reason), ''); v_fee numeric; v_limit numeric;
  v_owner boolean := public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid()); v_old text;
BEGIN
  SELECT * INTO tr FROM public.treasury_transfers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.money_transfer_guard_sender(tr);
  IF v_why IS NULL THEN RAISE EXCEPTION 'اكتب سبب التعديل'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;
  IF coalesce(p_fee_mode, 'none') NOT IN ('none', 'fixed', 'percent') THEN RAISE EXCEPTION 'نوع العمولة غلط'; END IF;
  v_fee := public.money_transfer_fee(tr.payment_method, p_amount, coalesce(p_fee_mode, 'none'), p_fee_value);
  IF v_fee >= p_amount THEN RAISE EXCEPTION 'العمولة أكبر من المبلغ'; END IF;
  v_limit := public.transfer_limit(tr.tenant_id, 'money');
  IF NOT v_owner AND v_limit > 0 AND p_amount > v_limit AND p_amount > tr.amount AND coalesce(tr.approval_status, '') <> 'waiting' THEN
    RAISE EXCEPTION 'المبلغ الجديد فوق حد موافقة المالك (%) — الغي التحويل ده واعمل تحويل جديد عشان يروح للمالك', v_limit;
  END IF;
  v_old := public.money_transfer_text(tr.id);
  IF coalesce(tr.approval_status, '') <> 'waiting' THEN
    PERFORM public._money_transfer_unpost(tr.id, 'تعديل تحويل لفرع: ' || v_why);
  END IF;
  UPDATE public.treasury_transfers
     SET amount = round(p_amount, 2), fee_amount = v_fee, fee_mode = coalesce(p_fee_mode, 'none'), fee_value = coalesce(p_fee_value, 0),
         fee_actually_charged = true, edited_at = now(),
         edit_note = concat_ws(' | ', edit_note, to_char(now() AT TIME ZONE 'Africa/Cairo', 'DD/MM HH24:MI') || ' ' || public.tr_person(auth.uid())
                     || ': ' || tr.amount || ' ← ' || round(p_amount, 2) || ' — ' || v_why)
   WHERE id = tr.id;
  IF coalesce(tr.approval_status, '') <> 'waiting' THEN
    PERFORM public._money_transfer_post(tr.id);
  ELSE
    UPDATE public.approval_requests
       SET entity_label = 'تحويل فلوس ' || public.money_transfer_text(tr.id),
           payload = payload || jsonb_build_object('amount', round(p_amount, 2), 'fee', v_fee)
     WHERE entity_type = 'treasury_transfer' AND entity_id = tr.id AND status = 'pending';
  END IF;
  PERFORM public.transfer_notify(tr.tenant_id, 'money', tr.from_branch_id, tr.to_branch_id, '✏️ اتعدّل تحويل فلوس',
    public.tr_person(auth.uid()) || ' عدّل التحويل: كان ' || v_old || ' — بقى ' || public.money_transfer_text(tr.id) || ' — السبب: ' || v_why,
    'treasury_transfer', tr.id);
  RETURN jsonb_build_object('id', tr.id, 'amount', round(p_amount, 2), 'fee', v_fee);
END $function$;

CREATE OR REPLACE FUNCTION public._money_transfer_approve(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE tr public.treasury_transfers%ROWTYPE;
BEGIN
  SELECT * INTO tr FROM public.treasury_transfers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR tr.cancelled_at IS NOT NULL OR coalesce(tr.approval_status, '') <> 'waiting' THEN
    RAISE EXCEPTION 'التحويل ده مش مستني موافقة (اتلغى أو اتقفل)';
  END IF;
  -- nothing moved while it waited: it moves the day the owner approves
  UPDATE public.treasury_transfers SET approval_status = 'approved', transfer_date = public.cairo_today(), created_at = now() WHERE id = tr.id;
  PERFORM public._money_transfer_post(tr.id);
  PERFORM public.transfer_notify(tr.tenant_id, 'money', tr.from_branch_id, tr.to_branch_id, '💰 المالك وافق على تحويل فلوس',
    public.money_transfer_text(tr.id) || ' — اتخصم من المرسل ومستني الاستلام', 'treasury_transfer', tr.id);
END $function$;
REVOKE ALL ON FUNCTION public._money_transfer_approve(uuid) FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════ GOODS ═════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.stock_transfer_group_value(p_group uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(round(sum(st.quantity * coalesce(nullif(p.avg_cost, 0), p.cost_price, 0)), 2), 0)
    FROM public.stock_transfers st JOIN public.products p ON p.id = st.product_id
   WHERE st.group_id = p_group AND st.status::text IN ('pending', 'awaiting_approval')
$function$;

CREATE OR REPLACE FUNCTION public.stock_transfer_group_text(p_group uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.tr_branch(min(st.from_branch_id::text)::uuid) || ' ← ' || public.tr_branch(min(st.to_branch_id::text)::uuid) || ': '
         || string_agg(p.name || ' × ' || st.quantity, '، ' ORDER BY p.name)
         || ' — بعته ' || public.tr_person(min(st.transferred_by::text)::uuid)
    FROM public.stock_transfers st JOIN public.products p ON p.id = st.product_id
   WHERE st.group_id = p_group AND st.status::text IN ('pending', 'awaiting_approval')
$function$;
REVOKE ALL ON FUNCTION public.stock_transfer_group_text(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transfer_stock_multi_atomic(p_from_branch uuid, p_to_branch uuid, p_items jsonb, p_reason text, p_transfer_date date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_tenant uuid; v_group uuid := gen_random_uuid(); v_item jsonb; v_pid uuid; v_qty int; v_current int;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date; v_date date; v_hist numeric; v_name text; v_id uuid;
  v_value numeric := 0; v_limit numeric; v_wait boolean; v_owner boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  PERFORM public.assert_access(p_from_branch, NULL);
  PERFORM public.require_switch('transfers.create', p_from_branch, 'تحويل البضاعة بين الفروع ← يبعت');
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'لا توجد أصناف للنقل'; END IF;
  v_owner := public.is_owner(v_user) OR public.is_super_admin(v_user);
  v_date := COALESCE(p_transfer_date, v_today);
  IF v_date > v_today THEN RAISE EXCEPTION 'مينفعش تسجّل تحويل بتاريخ في المستقبل'; END IF;
  IF v_date <> v_today AND NOT (public.is_admin(v_user) OR v_owner) THEN RAISE EXCEPTION 'تسجيل تحويل بتاريخ سابق متاح للإدارة فقط'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_to_branch AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'الفرع المستلم مش موجود'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    SELECT quantity, name INTO v_current, v_name FROM public.products WHERE id = v_pid AND branch_id = p_from_branch FOR UPDATE;
    IF v_current IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في الفرع'; END IF;
    IF v_current < v_qty THEN RAISE EXCEPTION '% : الكمية المتاحة غير كافية (متاح: %)', v_name, v_current; END IF;
    IF v_date <> v_today THEN
      v_hist := public.stock_balance_as_of(p_from_branch, v_pid, v_date);
      IF v_qty > v_hist THEN
        RAISE EXCEPTION '% : الرصيد في تاريخ التحويل المحدد غير كافٍ (الرصيد المتاح في هذا التاريخ: %)', v_name, trim(to_char(v_hist, 'FM999999999990.99'));
      END IF;
    END IF;
    v_value := v_value + v_qty * coalesce((SELECT coalesce(nullif(avg_cost, 0), cost_price, 0) FROM public.products WHERE id = v_pid), 0);
  END LOOP;
  v_limit := public.transfer_limit(v_tenant, 'goods');
  v_wait := NOT v_owner AND v_limit > 0 AND v_value > v_limit;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'quantity')::int;
    INSERT INTO public.stock_transfers (from_branch_id, to_branch_id, product_id, quantity, reason, transferred_by, status, tenant_id, group_id, transfer_date)
    VALUES (p_from_branch, p_to_branch, v_pid, v_qty, p_reason, v_user,
            CASE WHEN v_wait THEN 'awaiting_approval' ELSE 'pending' END::public.transfer_status, v_tenant, v_group, v_date)
    RETURNING id INTO v_id;
    IF NOT v_wait THEN
      PERFORM public.stock_mv_ctx('transfer', 'stock_transfer', v_id, v_pid, (v_date + time '12:00') AT TIME ZONE 'Africa/Cairo');
      UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_wait THEN
    INSERT INTO public.approval_requests (tenant_id, branch_id, entity_type, entity_id, entity_label, action, payload, reason, requested_by, requested_by_name)
    VALUES (v_tenant, p_from_branch, 'stock_transfer', v_group,
            'تحويل بضاعة قيمتها ' || to_char(round(v_value, 2), 'FM999,999,999,990.00') || ' — ' || public.stock_transfer_group_text(v_group), 'update',
            jsonb_build_object('kind', 'stock_transfer', 'value', round(v_value, 2), 'limit', v_limit, 'from', p_from_branch, 'to', p_to_branch),
            coalesce(nullif(btrim(p_reason), ''), 'تحويل فوق حد موافقة المالك'), v_user, public.tr_person(v_user));
  ELSE
    PERFORM public.transfer_notify(v_tenant, 'goods', p_from_branch, p_to_branch, '📦 تحويل بضاعة بين الفروع',
      public.stock_transfer_group_text(v_group) || ' — مستني الاستلام', 'stock_transfer', v_id);
  END IF;
  RETURN v_group;
END $function$;

CREATE OR REPLACE FUNCTION public._stock_transfer_approve(p_group uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; v_cur int; v_name text; v_ts timestamptz := now(); v_any uuid; v_from uuid; v_to uuid; v_tenant uuid;
BEGIN
  FOR t IN SELECT * FROM public.stock_transfers WHERE group_id = p_group AND status = 'awaiting_approval' ORDER BY created_at FOR UPDATE LOOP
    SELECT quantity, name INTO v_cur, v_name FROM public.products WHERE id = t.product_id FOR UPDATE;
    IF coalesce(v_cur, 0) < t.quantity THEN RAISE EXCEPTION '% : الكمية المتاحة دلوقتي غير كافية (متاح: %)', v_name, coalesce(v_cur, 0); END IF;
    UPDATE public.stock_transfers SET status = 'pending', transfer_date = public.cairo_today() WHERE id = t.id;
    PERFORM public.stock_mv_ctx('transfer', 'stock_transfer', t.id, t.product_id, v_ts);
    UPDATE public.products SET quantity = quantity - t.quantity WHERE id = t.product_id;
    v_any := t.id; v_from := t.from_branch_id; v_to := t.to_branch_id; v_tenant := t.tenant_id;
  END LOOP;
  IF v_any IS NULL THEN RAISE EXCEPTION 'التحويل ده مش مستني موافقة (اتلغى أو اتقفل)'; END IF;
  PERFORM public.transfer_notify(v_tenant, 'goods', v_from, v_to, '📦 المالك وافق على تحويل بضاعة',
    public.stock_transfer_group_text(p_group) || ' — طلعت من المرسل ومستنية الاستلام', 'stock_transfer', v_any);
END $function$;
REVOKE ALL ON FUNCTION public._stock_transfer_approve(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stock_transfer_guard_sender(t public.stock_transfers)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_same_tenant(t.tenant_id);
  IF NOT (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    PERFORM public.assert_access(t.from_branch_id, NULL);
    PERFORM public.require_switch('transfers.create', t.from_branch_id, 'تحويل البضاعة بين الفروع ← يبعت / يعدّل / يلغي');
  END IF;
  IF t.status::text NOT IN ('pending', 'awaiting_approval') THEN
    RAISE EXCEPTION 'التحويل ده اتستلم / اترفض / اتلغى خلاص — مينفعش يتعدّل أو يتلغي';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.stock_transfer_guard_sender(public.stock_transfers) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t public.stock_transfers%ROWTYPE; v_why text := nullif(btrim(p_reason), ''); v_product text; v_was text;
BEGIN
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.stock_transfer_guard_sender(t);
  IF v_why IS NULL THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  v_was := t.status::text;
  IF t.status = 'pending' THEN
    -- the pieces come back to the sender on the transfer day (sending took no batch, so none is added back)
    PERFORM public.stock_mv_ctx('transfer', 'stock_transfer', t.id, t.product_id,
      (coalesce(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00') AT TIME ZONE 'Africa/Cairo');
    UPDATE public.products SET quantity = coalesce(quantity, 0) + t.quantity WHERE id = t.product_id;
  END IF;
  UPDATE public.stock_transfers SET status = 'cancelled', confirmed_by = auth.uid(), received_quantity = 0, rejection_reason = 'إلغاء من المرسل: ' || v_why
   WHERE id = t.id;
  IF NOT EXISTS (SELECT 1 FROM public.stock_transfers WHERE group_id = t.group_id AND status = 'awaiting_approval') THEN
    UPDATE public.approval_requests SET status = 'rejected', admin_note = 'اتلغى من الفرع المرسل: ' || v_why
     WHERE entity_type = 'stock_transfer' AND entity_id = t.group_id AND status = 'pending';
  END IF;
  SELECT name INTO v_product FROM public.products WHERE id = t.product_id;
  PERFORM public.transfer_notify(t.tenant_id, 'goods', t.from_branch_id, t.to_branch_id, '🚫 اتلغى تحويل بضاعة',
    public.tr_person(auth.uid()) || ' لغى تحويل ' || coalesce(v_product, 'صنف') || ' × ' || t.quantity || ' من ' || public.tr_branch(t.from_branch_id)
    || ' لـ ' || public.tr_branch(t.to_branch_id) || ' — السبب: ' || v_why, 'stock_transfer', t.id);
  RETURN jsonb_build_object('id', t.id, 'returned', CASE WHEN v_was = 'pending' THEN t.quantity ELSE 0 END);
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_stock_transfer_group(p_group uuid, p_reason text)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.stock_transfers WHERE group_id = p_group AND status::text IN ('pending', 'awaiting_approval') ORDER BY created_at LOOP
    PERFORM public.cancel_stock_transfer(r.id, p_reason); n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'مفيش حاجة في التحويل ده لسه ممكن تتلغي'; END IF;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.edit_stock_transfer(p_transfer_id uuid, p_quantity int, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t public.stock_transfers%ROWTYPE; v_why text := nullif(btrim(p_reason), ''); v_diff int; v_cur int; v_name text; v_limit numeric;
  v_owner boolean := public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid()); v_unit numeric;
BEGIN
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.stock_transfer_guard_sender(t);
  IF v_why IS NULL THEN RAISE EXCEPTION 'اكتب سبب التعديل'; END IF;
  IF coalesce(p_quantity, 0) <= 0 THEN RAISE EXCEPTION 'الكمية لازم تكون 1 أو أكتر — ولو عاوز تشيله خالص استخدم «إلغاء»'; END IF;
  v_diff := p_quantity - t.quantity;
  IF v_diff = 0 THEN RETURN jsonb_build_object('id', t.id, 'quantity', t.quantity); END IF;
  SELECT quantity, name, coalesce(nullif(avg_cost, 0), cost_price, 0) INTO v_cur, v_name, v_unit FROM public.products WHERE id = t.product_id FOR UPDATE;
  IF t.status = 'pending' THEN
    v_limit := public.transfer_limit(t.tenant_id, 'goods');
    IF v_diff > 0 AND NOT v_owner AND v_limit > 0 AND public.stock_transfer_group_value(t.group_id) + v_diff * v_unit > v_limit THEN
      RAISE EXCEPTION 'الزيادة دي بتعدّي حد موافقة المالك (%) — الغي التحويل ده واعمل تحويل جديد عشان يروح للمالك', v_limit;
    END IF;
    IF v_diff > 0 AND coalesce(v_cur, 0) < v_diff THEN RAISE EXCEPTION '% : الكمية المتاحة غير كافية (متاح: %)', v_name, coalesce(v_cur, 0); END IF;
    PERFORM public.stock_mv_ctx('transfer', 'stock_transfer', t.id, t.product_id,
      (coalesce(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00') AT TIME ZONE 'Africa/Cairo');
    UPDATE public.products SET quantity = coalesce(quantity, 0) - v_diff WHERE id = t.product_id;
  END IF;
  UPDATE public.stock_transfers
     SET quantity = p_quantity,
         notes = concat_ws(' | ', notes, to_char(now() AT TIME ZONE 'Africa/Cairo', 'DD/MM HH24:MI') || ' ' || public.tr_person(auth.uid())
                 || ': ' || t.quantity || ' ← ' || p_quantity || ' — ' || v_why)
   WHERE id = t.id;
  IF t.status = 'awaiting_approval' THEN
    UPDATE public.approval_requests
       SET entity_label = 'تحويل بضاعة قيمتها ' || to_char(public.stock_transfer_group_value(t.group_id), 'FM999,999,999,990.00') || ' — '
                          || public.stock_transfer_group_text(t.group_id),
           payload = payload || jsonb_build_object('value', public.stock_transfer_group_value(t.group_id))
     WHERE entity_type = 'stock_transfer' AND entity_id = t.group_id AND status = 'pending';
  END IF;
  PERFORM public.transfer_notify(t.tenant_id, 'goods', t.from_branch_id, t.to_branch_id, '✏️ اتعدّل تحويل بضاعة',
    public.tr_person(auth.uid()) || ' عدّل ' || v_name || ': ' || t.quantity || ' ← ' || p_quantity || ' (' || public.tr_branch(t.from_branch_id)
    || ' ← ' || public.tr_branch(t.to_branch_id) || ') — السبب: ' || v_why, 'stock_transfer', t.id);
  RETURN jsonb_build_object('id', t.id, 'quantity', p_quantity, 'diff', v_diff);
END $function$;

-- receiving / rejecting goods needs «يستلم / يرفض» in the receiving branch; no batch is added for pieces going back
SELECT pg_temp.rep('public.partial_confirm_transfer(uuid,integer)'::regprocedure,
  $$  IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user) OR public.has_role(v_user,'owner')
          OR public.user_in_branch(v_user, v_t.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تأكيد هذا التحويل';
  END IF;$$,
  $$  IF NOT (public.is_super_admin(v_user) OR public.has_role(v_user,'owner')) THEN
    PERFORM public.assert_access(v_t.to_branch_id, NULL);
    PERFORM public.require_switch('transfers.update', v_t.to_branch_id, 'تحويل البضاعة بين الفروع ← يستلم / يرفض');
  END IF;$$);
SELECT pg_temp.rep('public.partial_confirm_transfer(uuid,integer)'::regprocedure,
  $$    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + diff
     WHERE id = t.product_id;
    INSERT INTO public.product_batches (
      product_id, branch_id, quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, batch_type, tenant_id
    ) VALUES (
      t.product_id, t.from_branch_id, diff, diff,
      fallback_cost, fallback_cost, 'transfer_return', t.tenant_id
    );$$,
  $$    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + diff
     WHERE id = t.product_id;$$);
SELECT pg_temp.rep('public.reject_transfer(uuid,text)'::regprocedure,
  $$  IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user)
          OR public.has_role(v_user, 'owner')
          OR public.user_in_branch(v_user, t.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
  END IF;$$,
  $$  IF NOT (public.is_super_admin(v_user) OR public.has_role(v_user, 'owner')) THEN
    PERFORM public.assert_access(t.to_branch_id, NULL);
    PERFORM public.require_switch('transfers.update', t.to_branch_id, 'تحويل البضاعة بين الفروع ← يستلم / يرفض');
  END IF;$$);
SELECT pg_temp.rep('public.reject_transfer(uuid,text)'::regprocedure,
  $$  INSERT INTO public.product_batches (
    product_id, branch_id, quantity_purchased, quantity_remaining,
    cost_price, base_purchase_price, batch_type, tenant_id
  ) VALUES (
    t.product_id, t.from_branch_id, t.quantity, t.quantity,
    COALESCE(v_cost, 0), COALESCE(v_cost, 0), 'transfer_return', t.tenant_id
  );$$, '');
CREATE OR REPLACE FUNCTION public.reject_transfer_group(p_group uuid)
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public.reject_transfer_group(p_group, NULL::text) $function$;

-- ═════════════════════════════ the owner's approval («طلبات الموافقة») ═══════════════════════════════════════════
SELECT pg_temp.rep('public.process_approval_request()'::regprocedure,
  $$    NEW.decided_at = now();
    IF NEW.action = 'delete' THEN
      IF NEW.entity_type = 'contact' THEN$$,
  $$    NEW.decided_at = now();
    IF NEW.entity_type IN ('treasury_transfer', 'stock_transfer') THEN
      -- 0285: a transfer above the owner's limit moves only when he approves
      IF NOT (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'الموافقة على التحويلات لصاحب الشركة بس';
      END IF;
      NEW.admin_id := coalesce(NEW.admin_id, auth.uid());
      IF NEW.entity_type = 'treasury_transfer' THEN PERFORM public._money_transfer_approve(NEW.entity_id);
      ELSE PERFORM public._stock_transfer_approve(NEW.entity_id); END IF;
    ELSIF NEW.action = 'delete' THEN
      IF NEW.entity_type = 'contact' THEN$$);
SELECT pg_temp.rep('public.process_approval_request()'::regprocedure,
  $$  ELSIF NEW.status = 'rejected' THEN
    NEW.decided_at = now();$$,
  $$  ELSIF NEW.status = 'rejected' THEN
    NEW.decided_at = now();
    IF NEW.entity_type = 'treasury_transfer' THEN
      UPDATE public.treasury_transfers SET approval_status = 'refused', rejection_reason = coalesce(NEW.admin_note, 'المالك رفض')
       WHERE id = NEW.entity_id AND approval_status = 'waiting' AND cancelled_at IS NULL;
    ELSIF NEW.entity_type = 'stock_transfer' THEN
      UPDATE public.stock_transfers SET status = 'refused', rejection_reason = coalesce(NEW.admin_note, 'المالك رفض'), confirmed_by = auth.uid()
       WHERE group_id = NEW.entity_id AND status = 'awaiting_approval';
    END IF;$$);
SELECT pg_temp.rep('public.process_approval_request()'::regprocedure,
  $$    v_body  = 'تمت الموافقة على طلب ' || (CASE WHEN NEW.action='delete' THEN 'إلغاء' ELSE 'تعديل' END) || ' ' || NEW.entity_label;$$,
  $$    v_body  = 'تمت الموافقة على طلب ' || (CASE WHEN NEW.entity_type IN ('treasury_transfer', 'stock_transfer') THEN ''
                                               WHEN NEW.action='delete' THEN 'إلغاء ' ELSE 'تعديل ' END) || NEW.entity_label;$$);
SELECT pg_temp.rep('public.process_approval_request()'::regprocedure,
  $$    v_body  = 'تم رفض طلب ' || (CASE WHEN NEW.action='delete' THEN 'إلغاء' ELSE 'تعديل' END) || ' ' || NEW.entity_label$$,
  $$    v_body  = 'تم رفض طلب ' || (CASE WHEN NEW.entity_type IN ('treasury_transfer', 'stock_transfer') THEN ''
                                       WHEN NEW.action='delete' THEN 'إلغاء ' ELSE 'تعديل ' END) || NEW.entity_label$$);
SELECT pg_temp.rep('public.notify_admins_new_approval()'::regprocedure,
  $$(CASE WHEN NEW.action='delete' THEN 'حذف' ELSE 'تعديل' END) || ' ' || NEW.entity_label$$,
  $$(CASE WHEN NEW.entity_type IN ('treasury_transfer', 'stock_transfer') THEN 'موافقتك على ' WHEN NEW.action='delete' THEN 'حذف ' ELSE 'تعديل ' END) || NEW.entity_label$$);

-- ═════════════════════════════ «سجل المستندات» purge ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.purge_document_log(p_confirm text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v_n bigint; v_size bigint;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'مسح سجل المستندات للمالك بس' USING ERRCODE = '42501'; END IF;
  IF btrim(coalesce(p_confirm, '')) <> 'مسح' THEN RAISE EXCEPTION 'اكتب كلمة «مسح» للتأكيد'; END IF;
  IF EXISTS (SELECT 1 FROM public.document_events WHERE tenant_id IS DISTINCT FROM v_t) THEN
    RAISE EXCEPTION 'السجل فيه بيانات شركة تانية — المسح الكامل مش متاح';
  END IF;
  SELECT count(*) INTO v_n FROM public.document_events;
  v_size := pg_total_relation_size('public.document_events');
  TRUNCATE public.document_events;
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, action, entity, entity_id, details)
  VALUES (auth.uid(), public.tr_person(auth.uid()), v_t, 'DELETE', 'document_events', NULL,
          jsonb_build_object('purged_rows', v_n, 'freed_bytes', v_size, 'note', 'المالك مسح سجل المستندات كله'));
  RETURN jsonb_build_object('rows', v_n, 'freed', pg_size_pretty(v_size));
END $function$;

-- ═════════════════════════════ grants ════════════════════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.transfer_treasury_atomic(uuid, uuid, numeric, text, text, numeric, text, text, boolean, date, text, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_treasury_transfer(uuid, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_money_transfer(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_money_transfer(uuid, numeric, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_stock_transfer(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_stock_transfer_group(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_stock_transfer(uuid, int, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_transfer_approval_limits() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_transfer_approval_limits(numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_document_log(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_transfer_group_value(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.money_transfer_fee(text, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_treasury_atomic(uuid, uuid, numeric, text, text, numeric, text, text, boolean, date, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_treasury_transfer(uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_money_transfer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_money_transfer(uuid, numeric, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer_group(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_stock_transfer(uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_transfer_approval_limits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_transfer_approval_limits(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_document_log(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_transfer_group_value(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.money_transfer_fee(text, numeric, text, numeric) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('cancel_money_transfer', '0285', 'sender (money_transfers.create) / owner: before it is received'),
  ('edit_money_transfer', '0285', 'sender / owner: amount + fee before it is received'),
  ('cancel_stock_transfer', '0285', 'sender (transfers.create) / owner: before it is received'),
  ('cancel_stock_transfer_group', '0285', 'sender / owner: every item still pending'),
  ('edit_stock_transfer', '0285', 'sender / owner: quantity before it is received'),
  ('get_transfer_approval_limits', '0285', 'read the owner''s approval limits'),
  ('set_transfer_approval_limits', '0285', 'owner only'),
  ('purge_document_log', '0285', 'owner only, typed confirmation'),
  ('stock_transfer_group_value', '0285', 'read, value at average cost'),
  ('money_transfer_fee', '0285', 'pure calculation')
ON CONFLICT DO NOTHING;
