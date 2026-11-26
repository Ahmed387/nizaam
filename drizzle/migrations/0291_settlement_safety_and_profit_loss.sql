-- 0291 (owner 2026-11-26 «نفذ»): «تسوية رصيد» made safe + a new «تسوية برصيد — الفرق ربح أو خسارة».
--  1. The two vouchers of a settlement can't be cancelled / edited / restored one by one (screen of vouchers, edit,
--     «استرجاع من الملغاة») — only the settlement itself, from the account's file.
--  2. Cancelling a settlement finishes even when one of its vouchers was already cancelled.
--  3. TS00189 (both vouchers cancelled one by one on 21/11, the settlement still «active») is marked cancelled.
--  4. A settlement reads the account's balance in THAT branch: no balance there → refused; a direction against the
--     balance → refused; an amount above the balance → refused unless the owner chose «كمّل» (p_allow_flip).
--  5. «تسوية برصيد» (settle_contact_to_balance): the owner types the balance the account should have; the difference is
--     a 2026 LOSS (account 6910 «خسائر تسوية أرصدة») or a 2026 GAIN («إيرادات أخرى» 4200) in the settlement's month —
--     two vouchers in the book vessel like the old settlement, real tills never move. Cancel = the same door.

-- ---------- accounts and categories ----------
INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, parent_id, is_system, is_active)
SELECT a.tenant_id, '6910', 'Balance settlement losses', 'خسائر تسوية أرصدة', 'expense', 'debit', a.parent_id, true, true
  FROM public.chart_of_accounts a
 WHERE a.code = '6900' AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts b WHERE b.tenant_id = a.tenant_id AND b.code = '6910');

INSERT INTO public.voucher_categories (tenant_id, name, type, is_system, system_key, is_active, is_deductible_from_profit, gl_account_code, is_added_to_profit)
SELECT t.id, 'خسائر تسوية أرصدة', 'payment', true, 'balance_settle_loss', true, true, '6910', false
  FROM public.tenants t
 WHERE EXISTS (SELECT 1 FROM public.chart_of_accounts a WHERE a.tenant_id = t.id AND a.code = '6910')
   AND NOT EXISTS (SELECT 1 FROM public.voucher_categories c WHERE c.tenant_id = t.id AND c.system_key = 'balance_settle_loss');
INSERT INTO public.voucher_categories (tenant_id, name, type, is_system, system_key, is_active, is_deductible_from_profit, gl_account_code, is_added_to_profit)
SELECT t.id, 'أرباح تسوية أرصدة', 'receipt', true, 'balance_settle_gain', true, false, '4200', true
  FROM public.tenants t
 WHERE EXISTS (SELECT 1 FROM public.chart_of_accounts a WHERE a.tenant_id = t.id AND a.code = '4200')
   AND NOT EXISTS (SELECT 1 FROM public.voucher_categories c WHERE c.tenant_id = t.id AND c.system_key = 'balance_settle_gain');

-- ---------- the settlement row ----------
ALTER TABLE public.contact_settlements
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'prior_years',   -- 'prior_years' (0148) | 'profit_loss' (0291)
  ADD COLUMN IF NOT EXISTS result text,                                 -- profit_loss: 'gain' | 'loss'
  ADD COLUMN IF NOT EXISTS balance_before numeric,
  ADD COLUMN IF NOT EXISTS balance_after numeric;
ALTER TABLE public.contact_settlements DROP CONSTRAINT IF EXISTS contact_settlements_direction_check;
ALTER TABLE public.contact_settlements ADD CONSTRAINT contact_settlements_direction_check
  CHECK (direction = ANY (ARRAY['we_owe_less', 'he_owes_less', 'we_owe_more', 'he_owes_more']));
CREATE INDEX IF NOT EXISTS contact_settlements_contact_voucher_idx ON public.contact_settlements (contact_voucher_id);
CREATE INDEX IF NOT EXISTS contact_settlements_offset_voucher_idx ON public.contact_settlements (offset_voucher_id);

-- ---------- 1. a settlement voucher moves only with its settlement ----------
CREATE OR REPLACE FUNCTION public.guard_settlement_voucher()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE s record;
BEGIN
  IF coalesce(current_setting('app.settlement_op', true), '') = '1' THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id AND NEW.party_id IS NOT DISTINCT FROM OLD.party_id
     AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method AND NEW.voucher_date IS NOT DISTINCT FROM OLD.voucher_date
     AND NEW.type IS NOT DISTINCT FROM OLD.type THEN
    RETURN NEW;
  END IF;
  SELECT cs.settlement_number, c.name INTO s FROM public.contact_settlements cs JOIN public.contacts c ON c.id = cs.contact_id
   WHERE cs.contact_voucher_id = OLD.id OR cs.offset_voucher_id = OLD.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ده سند من التسوية % — مينفعش يتلغي أو يتعدل أو يترجع لوحده. الغي التسوية كلها من ملف «%»', s.settlement_number, s.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS a0_guard_settlement_voucher ON public.vouchers;
CREATE TRIGGER a0_guard_settlement_voucher BEFORE UPDATE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_voucher();
REVOKE ALL ON FUNCTION public.guard_settlement_voucher() FROM PUBLIC, anon, authenticated;

-- a receipt «from» a supplier exists only inside a settlement (we owe him more, the difference a loss)
CREATE OR REPLACE FUNCTION public.guard_voucher_receipt_party()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF public.sahl_import_mode() THEN RETURN NEW; END IF;  -- 0156 import mode
  IF coalesce(current_setting('app.settlement_op', true), '') = '1' THEN RETURN NEW; END IF;  -- 0291 settlement
  IF NEW.type = 'receipt' AND NEW.party_type::text = 'supplier' AND COALESCE(NEW.status::text, 'active') = 'active' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'مينفعش سند قبض من مورد. فلوس جاية من فرع تاني → «التحويلات بين الفروع» (تحويل خزنة). فلوس رجعها مورد → «مرتجع شراء». سند القبض للعملاء أو «أخرى» بس.';
  END IF;
  RETURN NEW;
END $function$;

-- ---------- balances per branch ----------
-- the account's balance on one side in one branch: customer + = he owes us, supplier + = we owe him
CREATE OR REPLACE FUNCTION public._contact_side_net(p_contact uuid, p_branch uuid, p_side text)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT round(coalesce((SELECT CASE WHEN p_side = 'customer' THEN b.customer_open - b.customer_advance ELSE b.supplier_open - b.supplier_advance END
                           FROM public.contact_side_balances(ARRAY[p_contact], p_branch) b), 0), 2)
$$;
REVOKE ALL ON FUNCTION public._contact_side_net(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- what the settlement forms show: every branch with the account's two sides there (owner only)
CREATE OR REPLACE FUNCTION public.contact_settle_info(p_contact uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'للمالك بس' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact AND tenant_id = v_t) THEN RAISE EXCEPTION 'الحساب غير موجود'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', b.id, 'branch', b.name,
           'customer', public._contact_side_net(p_contact, b.id, 'customer'), 'supplier', public._contact_side_net(p_contact, b.id, 'supplier'))
           ORDER BY b.name)
    FROM public.branches b WHERE b.tenant_id = v_t AND NOT coalesce(b.is_system, false)), '[]'::jsonb);
END $function$;

-- ---------- 4. «تسوية بدون فلوس» (prior years) reads the balance ----------
DROP FUNCTION IF EXISTS public.settle_contact_without_money(uuid, uuid, text, text, numeric, date, text);
CREATE OR REPLACE FUNCTION public.settle_contact_without_money(p_branch uuid, p_contact uuid, p_side text, p_direction text, p_amount numeric,
                                                               p_date date, p_reason text, p_allow_flip boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id(); c public.contacts%ROWTYPE; v_amt numeric := round(p_amount, 2);
  v_vessel text; v_cat_contact uuid; v_cat_offset uuid; v_cv uuid; v_ov uuid; v_id uuid; v_num text; v_desc text; v_net numeric; v_after numeric;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'التسوية بدون فلوس للمالك بس' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_access(p_branch, NULL);
  SELECT * INTO c FROM public.contacts WHERE id = p_contact AND tenant_id = v_t;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب غير موجود'; END IF;
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'اختار: حساب العميل ولا حساب المورد'; END IF;
  IF p_direction NOT IN ('we_owe_less', 'he_owes_less') THEN RAISE EXCEPTION 'اختار: نقلل اللي علينا ليه ولا اللي عليه'; END IF;
  IF p_side = 'supplier' AND p_direction = 'he_owes_less' THEN
    RAISE EXCEPTION 'تقليل اللي على المورد بيبقى «مرتجع شراء» — مفيش سند قبض من مورد';
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF p_date IS NULL OR p_date < DATE '2026-01-01' OR p_date > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ لازم يكون في 2026 ومش في المستقبل'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب التسوية'; END IF;
  -- 0291: his balance in THIS branch decides
  v_net := public._contact_side_net(c.id, p_branch, p_side);
  IF abs(v_net) < 0.01 THEN RAISE EXCEPTION 'ملوش رصيد على حساب ال% في الفرع ده — اختار الفرع اللي عليه / ليه فيه رصيد', CASE p_side WHEN 'customer' THEN 'عميل' ELSE 'مورد' END; END IF;
  IF p_side = 'customer' AND p_direction = 'he_owes_less' AND v_net < 0 THEN RAISE EXCEPTION 'مش عليه حاجة في الفرع ده — هو ليه % عندنا', abs(v_net); END IF;
  IF p_side = 'customer' AND p_direction = 'we_owe_less' AND v_net > 0 THEN RAISE EXCEPTION 'مش ليه حاجة عندنا في الفرع ده — هو عليه %', v_net; END IF;
  IF p_side = 'supplier' AND v_net < 0 THEN RAISE EXCEPTION 'مش علينا له حاجة في الفرع ده — هو عليه % لينا', abs(v_net); END IF;
  IF v_amt > abs(v_net) + 0.005 AND NOT coalesce(p_allow_flip, false) THEN
    RAISE EXCEPTION 'المبلغ % أكبر من رصيده % — اختار: سوّي لحد الصفر بس، ولا كمّل وهو يقلب للناحية التانية', v_amt, abs(v_net);
  END IF;
  v_after := CASE WHEN v_net > 0 THEN v_net - v_amt ELSE v_net + v_amt END;
  SELECT payment_method INTO v_vessel FROM public.transfer_fees WHERE tenant_id = v_t AND kind = 'virtual' AND coalesce(is_enabled, true)
   ORDER BY created_at LIMIT 1;
  IF v_vessel IS NULL THEN RAISE EXCEPTION 'مفيش وعاء دفتري («خصومات / عروض الشركات») — شغّله من الإعدادات ← طرق الدفع'; END IF;
  SELECT id INTO v_cat_contact FROM public.voucher_categories WHERE tenant_id = v_t AND coalesce(is_active, true)
     AND system_key = ANY (CASE WHEN p_side = 'supplier' THEN ARRAY['supplier_payment']
                                WHEN p_direction = 'we_owe_less' THEN ARRAY['customer_return', 'other_payment'] ELSE ARRAY['installment'] END)
   ORDER BY (system_key = 'customer_return') DESC, is_system DESC LIMIT 1;
  SELECT id INTO v_cat_offset FROM public.voucher_categories WHERE tenant_id = v_t
     AND system_key = CASE WHEN p_direction = 'we_owe_less' THEN 'prior_years_settle_in' ELSE 'prior_years_settle_out' END LIMIT 1;
  IF v_cat_contact IS NULL OR v_cat_offset IS NULL THEN RAISE EXCEPTION 'تصنيفات التسوية مش موجودة'; END IF;

  v_num := 'TS' || lpad(nextval('public.contact_settlement_seq')::text, 5, '0');
  v_desc := 'تسوية بدون فلوس ' || v_num || ' على أرباح السنين اللي فاتت — ' || btrim(p_reason);
  IF p_direction = 'we_owe_less' THEN
    v_cv := public.create_manual_voucher(p_branch, 'payment', v_cat_contact, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
              p_side::voucher_party_type, c.id, c.name, v_desc, p_date, 'تسوية دفترية');
    v_ov := public.create_manual_voucher(p_branch, 'receipt', v_cat_offset, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
              'other', NULL, 'أرباح السنين اللي فاتت', v_desc, p_date, 'تسوية دفترية');
  ELSE
    v_cv := public.create_manual_voucher(p_branch, 'receipt', v_cat_contact, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
              'customer', c.id, c.name, v_desc, p_date, 'تسوية دفترية');
    v_ov := public.create_manual_voucher(p_branch, 'payment', v_cat_offset, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
              'other', NULL, 'أرباح السنين اللي فاتت', v_desc, p_date, 'تسوية دفترية');
  END IF;
  UPDATE public.vouchers SET flow_class = 'internal' WHERE id IN (v_cv, v_ov);

  INSERT INTO public.contact_settlements (tenant_id, branch_id, contact_id, side, direction, settlement_number, settlement_date, amount, reason,
                                          contact_voucher_id, offset_voucher_id, created_by, kind, balance_before, balance_after)
  VALUES (v_t, p_branch, c.id, p_side, p_direction, v_num, p_date, v_amt, btrim(p_reason), v_cv, v_ov, auth.uid(), 'prior_years', v_net, v_after)
  RETURNING id INTO v_id;

  PERFORM public.ledger_refresh_contact(c.id);
  PERFORM public.ledger_gl_sync(v_t, c.id, NULL);
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), v_t, p_branch, 'CREATE', 'contact_settlement', v_id::text,
          jsonb_build_object('number', v_num, 'contact', c.name, 'side', p_side, 'direction', p_direction, 'amount', v_amt, 'date', p_date,
                             'reason', btrim(p_reason), 'before', v_net, 'after', v_after));
  RETURN jsonb_build_object('id', v_id, 'settlement_number', v_num, 'contact_voucher_id', v_cv, 'offset_voucher_id', v_ov,
                            'balance_before', v_net, 'balance_after', v_after);
END $function$;

-- ---------- 5. «تسوية برصيد — الفرق ربح أو خسارة» ----------
CREATE OR REPLACE FUNCTION public.settle_contact_to_balance(p_branch uuid, p_contact uuid, p_side text, p_target numeric, p_date date,
                                                            p_reason text, p_allow_flip boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id(); c public.contacts%ROWTYPE; v_target numeric := round(p_target, 2);
  v_vessel text; v_cat_contact uuid; v_cat_offset uuid; v_cv uuid; v_ov uuid; v_id uuid; v_num text; v_desc text;
  v_net numeric; v_diff numeric; v_amt numeric; v_result text; v_contact_type voucher_type; v_direction text;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'التسوية للمالك بس' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_access(p_branch, NULL);
  SELECT * INTO c FROM public.contacts WHERE id = p_contact AND tenant_id = v_t;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب غير موجود'; END IF;
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'اختار: حساب العميل ولا حساب المورد'; END IF;
  IF v_target IS NULL THEN RAISE EXCEPTION 'اكتب الرصيد اللي اتفقتوا عليه'; END IF;
  IF p_date IS NULL OR p_date < DATE '2026-01-01' OR p_date > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ لازم يكون في 2026 ومش في المستقبل'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب التسوية'; END IF;
  v_net := public._contact_side_net(c.id, p_branch, p_side);
  IF abs(v_net) < 0.01 THEN RAISE EXCEPTION 'ملوش رصيد على حساب ال% في الفرع ده — اختار الفرع اللي عليه / ليه فيه رصيد', CASE p_side WHEN 'customer' THEN 'عميل' ELSE 'مورد' END; END IF;
  v_diff := round(v_net - v_target, 2);
  IF abs(v_diff) < 0.01 THEN RAISE EXCEPTION 'الرصيد ده هو رصيده دلوقتي — مفيش فرق يتسوّى'; END IF;
  IF v_target <> 0 AND sign(v_target) <> sign(v_net) AND NOT coalesce(p_allow_flip, false) THEN
    RAISE EXCEPTION 'الرصيد اللي كتبته في الناحية التانية من رصيده (%) — اختار: صفّر بس، ولا كمّل ويقلب', v_net;
  END IF;
  v_amt := abs(v_diff);
  -- customer + = he owes us: diff > 0 = he owes less = LOSS; diff < 0 = he owes more = GAIN
  -- supplier + = we owe him: diff > 0 = we owe less = GAIN; diff < 0 = we owe more = LOSS
  v_result := CASE WHEN (p_side = 'customer') = (v_diff > 0) THEN 'loss' ELSE 'gain' END;
  -- the contact's voucher: lowers / raises his side
  IF p_side = 'customer' THEN
    v_contact_type := CASE WHEN v_diff > 0 THEN 'receipt' ELSE 'payment' END;
    v_direction := CASE WHEN v_diff > 0 THEN 'he_owes_less' ELSE 'he_owes_more' END;
    SELECT id INTO v_cat_contact FROM public.voucher_categories WHERE tenant_id = v_t AND coalesce(is_active, true)
       AND system_key = ANY (CASE WHEN v_diff > 0 THEN ARRAY['installment'] ELSE ARRAY['customer_return', 'other_payment'] END)
     ORDER BY (system_key = 'customer_return') DESC, is_system DESC LIMIT 1;
  ELSE
    v_contact_type := CASE WHEN v_diff > 0 THEN 'payment' ELSE 'receipt' END;
    v_direction := CASE WHEN v_diff > 0 THEN 'we_owe_less' ELSE 'we_owe_more' END;
    SELECT id INTO v_cat_contact FROM public.voucher_categories WHERE tenant_id = v_t AND coalesce(is_active, true)
       AND system_key = CASE WHEN v_diff > 0 THEN 'supplier_payment' ELSE 'other_receipt' END LIMIT 1;
  END IF;
  SELECT id INTO v_cat_offset FROM public.voucher_categories WHERE tenant_id = v_t
     AND system_key = CASE WHEN v_result = 'loss' THEN 'balance_settle_loss' ELSE 'balance_settle_gain' END LIMIT 1;
  IF v_cat_contact IS NULL OR v_cat_offset IS NULL THEN RAISE EXCEPTION 'تصنيفات التسوية مش موجودة'; END IF;
  SELECT payment_method INTO v_vessel FROM public.transfer_fees WHERE tenant_id = v_t AND kind = 'virtual' AND coalesce(is_enabled, true)
   ORDER BY created_at LIMIT 1;
  IF v_vessel IS NULL THEN RAISE EXCEPTION 'مفيش وعاء دفتري («خصومات / عروض الشركات») — شغّله من الإعدادات ← طرق الدفع'; END IF;

  v_num := 'TS' || lpad(nextval('public.contact_settlement_seq')::text, 5, '0');
  v_desc := 'تسوية برصيد ' || v_num || ' — ' || CASE v_result WHEN 'loss' THEN 'خسارة' ELSE 'ربح' END || ' ' || v_amt
            || ' (من ' || v_net || ' لـ ' || v_target || ') — ' || btrim(p_reason);
  PERFORM set_config('app.settlement_op', '1', true);
  v_cv := public.create_manual_voucher(p_branch, v_contact_type, v_cat_contact, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
            p_side::voucher_party_type, c.id, c.name, v_desc, p_date, 'تسوية دفترية');
  v_ov := public.create_manual_voucher(p_branch, CASE WHEN v_contact_type = 'receipt' THEN 'payment'::voucher_type ELSE 'receipt'::voucher_type END,
            v_cat_offset, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
            'other', NULL, CASE v_result WHEN 'loss' THEN 'خسائر تسوية أرصدة' ELSE 'أرباح تسوية أرصدة' END, v_desc, p_date, 'تسوية دفترية');
  UPDATE public.vouchers SET flow_class = 'internal' WHERE id = v_cv;
  PERFORM set_config('app.settlement_op', '', true);

  INSERT INTO public.contact_settlements (tenant_id, branch_id, contact_id, side, direction, settlement_number, settlement_date, amount, reason,
                                          contact_voucher_id, offset_voucher_id, created_by, kind, result, balance_before, balance_after)
  VALUES (v_t, p_branch, c.id, p_side, v_direction, v_num, p_date, v_amt, btrim(p_reason), v_cv, v_ov, auth.uid(), 'profit_loss', v_result, v_net, v_target)
  RETURNING id INTO v_id;

  PERFORM public.ledger_refresh_contact(c.id);
  PERFORM public.ledger_gl_sync(v_t, c.id, NULL);
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), v_t, p_branch, 'CREATE', 'contact_settlement', v_id::text,
          jsonb_build_object('number', v_num, 'contact', c.name, 'side', p_side, 'kind', 'profit_loss', 'result', v_result, 'amount', v_amt,
                             'date', p_date, 'before', v_net, 'after', v_target, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('id', v_id, 'settlement_number', v_num, 'result', v_result, 'amount', v_amt,
                            'balance_before', v_net, 'balance_after', v_target, 'contact_voucher_id', v_cv, 'offset_voucher_id', v_ov);
END $function$;

-- ---------- 2. cancel finishes even when a voucher was already cancelled ----------
CREATE OR REPLACE FUNCTION public.cancel_contact_settlement(p_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s public.contact_settlements%ROWTYPE; v uuid;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'إلغاء التسوية للمالك بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  SELECT * INTO s FROM public.contact_settlements WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' THEN RAISE EXCEPTION 'التسوية غير موجودة أو ملغية'; END IF;
  PERFORM set_config('app.settlement_op', '1', true);
  FOREACH v IN ARRAY ARRAY[s.contact_voucher_id, s.offset_voucher_id] LOOP
    IF EXISTS (SELECT 1 FROM public.vouchers WHERE id = v AND status::text <> 'cancelled') THEN
      PERFORM public.cancel_voucher(v, 'إلغاء التسوية ' || s.settlement_number || ' — ' || btrim(p_reason));
    END IF;
  END LOOP;
  PERFORM set_config('app.settlement_op', '', true);
  UPDATE public.contact_settlements SET status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid() WHERE id = s.id;
  PERFORM public.ledger_refresh_contact(s.contact_id);
  PERFORM public.ledger_gl_sync(s.tenant_id, s.contact_id, NULL);
  RETURN jsonb_build_object('settlement_number', s.settlement_number, 'cancelled', true);
END $function$;

-- ---------- 3. TS00189: both vouchers were cancelled one by one on 21/11 ----------
UPDATE public.contact_settlements s SET status = 'cancelled',
       cancel_reason = 'السندين اتلغوا كل واحد لوحده يوم 21/11 (خطأ في المعاملة) — اتعلّمت ملغية في 0291',
       cancelled_at = coalesce((SELECT max(v.cancelled_at) FROM public.vouchers v WHERE v.id IN (s.contact_voucher_id, s.offset_voucher_id)), now()),
       cancelled_by = (SELECT v.cancelled_by FROM public.vouchers v WHERE v.id = s.offset_voucher_id)
 WHERE s.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM public.vouchers v WHERE v.id IN (s.contact_voucher_id, s.offset_voucher_id) AND v.status::text <> 'cancelled');

GRANT EXECUTE ON FUNCTION public.settle_contact_without_money(uuid, uuid, text, text, numeric, date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_contact_to_balance(uuid, uuid, text, numeric, date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contact_settle_info(uuid) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('settle_contact_to_balance', '0291', 'owner: settle an account to a balance — the difference a 2026 gain / loss'),
  ('contact_settle_info', '0291', 'owner: the account''s balance per branch for the settlement forms')
ON CONFLICT DO NOTHING;
