-- 0206: owner 2026-11-14 «كل فرع حسابه فيه مستنداته هو بس، زي سهل» (three approved «نفذ»):
-- 1) A contact's opening balance sits on ITS branch (contacts.opening_branch_id, else the contact's own branch), not on
--    MAIN-TREASURY. `ledger_opening_branch` reads it; the sync moves the opening movement by itself (cancel + new).
--    The books follow: the contacts opening entry is reversed and re-posted per branch (key = section + branch);
--    `post_opening_balances` posts per branch from now on and accepts `branch_id` per contact row.
-- 2) Automatic settlement (FIFO) stays inside ONE branch: a receipt / payment of branch A never settles a document of
--    branch B by itself. Only an explicit choice (credit used on a document) may cross branches. The 1,623 cross-branch
--    allocations are superseded by the re-sync and their 1910 clearing entries reversed by `ledger_gl_sync`.
-- 3) «إيداع تحت الحساب» goes to the till of a chosen branch (`p_branch_id`), not to MAIN-TREASURY.
-- No document, voucher, stock or till row changes; an account's total balance is the same — only its split by branch.
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS opening_branch_id uuid REFERENCES public.branches(id);

CREATE OR REPLACE FUNCTION public.ledger_opening_branch(p_tenant uuid, p_contact uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(
    (SELECT c.opening_branch_id FROM contacts c WHERE c.id = p_contact),
    (SELECT c.branch_id FROM contacts c JOIN branches b ON b.id = c.branch_id WHERE c.id = p_contact AND NOT COALESCE(b.is_system, false)),
    (SELECT b.id FROM branches b WHERE b.tenant_id = p_tenant AND b.code = 'MAIN-TREASURY' LIMIT 1),
    (SELECT c.branch_id FROM contacts c WHERE c.id = p_contact),
    (SELECT b.id FROM branches b WHERE b.tenant_id = p_tenant ORDER BY b.created_at, b.id LIMIT 1))
$function$;

CREATE OR REPLACE FUNCTION public.ledger_opening_branch_is_fallback(p_tenant uuid, p_contact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = p_tenant AND b.code = 'MAIN-TREASURY')
     AND (SELECT c.branch_id IS NULL AND c.opening_branch_id IS NULL FROM contacts c WHERE c.id = p_contact)
$function$;

-- FIFO inside one branch
DO $mig$
DECLARE d text; a text := 'WHERE db.rem > 0.005';
BEGIN
  d := pg_get_functiondef('public.ledger_allocate(uuid,uuid,text,uuid)'::regprocedure);
  IF position('db.branch_id = m.branch_id' in d) = 0 THEN
    IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION '0206: ledger_allocate anchor not unique'; END IF;
    d := replace(d, a, a || ' AND db.branch_id = m.branch_id');
    EXECUTE d;
  END IF;
END
$mig$;

-- the contacts opening section may be one entry per branch
CREATE OR REPLACE FUNCTION public.opening_entry_section(p_entry uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN e.source_id = public.opening_section_key(e.tenant_id, 'contacts') THEN 'contacts'
    WHEN e.source_id = public.opening_section_key(e.tenant_id, 'inventory') THEN 'inventory'
    WHEN e.source_id IS NOT NULL AND e.source_id = public.opening_section_key(e.tenant_id, 'contacts', e.branch_id) THEN 'contacts'
    WHEN e.source_id IS NOT NULL AND e.source_id = public.opening_section_key(e.tenant_id, 'cash', e.branch_id) THEN 'cash'
    WHEN e.source_id IS NULL AND e.description LIKE '%نقدية%' THEN 'cash'
    WHEN e.source_id IS NULL AND e.description LIKE '%العملاء والموردين%' THEN 'contacts'
    WHEN e.source_id IS NULL AND e.description LIKE '%المخزون%' THEN 'inventory'
  END
  FROM journal_entries e WHERE e.id = p_entry
$function$;

-- One opening entry per branch from the contacts' opening balances as they stand (used by the re-post and by this migration).
CREATE OR REPLACE FUNCTION public.post_contacts_opening_entries(p_tenant uuid, p_date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record; v_lines jsonb; v_entry uuid; v_n int := 0; v_net numeric;
BEGIN
  FOR r IN
    SELECT x.br,
           sum(CASE WHEN x.sd = 'customer' AND x.amt > 0 THEN x.amt ELSE 0 END) AS ar,
           sum(CASE WHEN x.sd = 'customer' AND x.amt < 0 THEN -x.amt ELSE 0 END) AS c_adv,
           sum(CASE WHEN x.sd = 'supplier' AND x.amt > 0 THEN x.amt ELSE 0 END) AS ap,
           sum(CASE WHEN x.sd = 'supplier' AND x.amt < 0 THEN -x.amt ELSE 0 END) AS s_adv
      FROM (SELECT public.ledger_opening_branch(c.tenant_id, c.id) AS br,
                   CASE WHEN c.type = 'supplier' THEN 'supplier' WHEN c.type = 'customer' THEN 'customer'
                        WHEN c.opening_balance > 0 THEN 'customer' ELSE 'supplier' END AS sd,
                   round(CASE WHEN c.type = 'supplier' THEN -c.opening_balance WHEN c.type = 'customer' THEN c.opening_balance
                              WHEN c.opening_balance > 0 THEN c.opening_balance ELSE -c.opening_balance END, 2) AS amt
              FROM contacts c WHERE c.tenant_id = p_tenant AND COALESCE(c.opening_balance, 0) <> 0) x
     GROUP BY 1
  LOOP
    v_lines := '[]'::jsonb;
    IF r.ar > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','1200','debit',r.ar,'credit',0,'description','رصيد افتتاحي - مديونية عملاء'); END IF;
    IF r.s_adv > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','1460','debit',r.s_adv,'credit',0,'description','رصيد افتتاحي - مقدمات موردين'); END IF;
    IF r.ap > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','2100','debit',0,'credit',r.ap,'description','رصيد افتتاحي - مستحقات موردين'); END IF;
    IF r.c_adv > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','2150','debit',0,'credit',r.c_adv,'description','رصيد افتتاحي - مقدمات عملاء'); END IF;
    v_net := (r.ar + r.s_adv) - (r.ap + r.c_adv);
    IF v_net > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','3950','debit',0,'credit',v_net,'description','رصيد افتتاحي');
    ELSIF v_net < 0 THEN v_lines := v_lines || jsonb_build_object('account_code','3950','debit',-v_net,'credit',0,'description','رصيد افتتاحي'); END IF;
    v_entry := public.post_journal(p_tenant, p_date, 'رصيد افتتاحي — أرصدة العملاء والموردين', 'opening_balance',
                                   public.opening_section_key(p_tenant, 'contacts', r.br), v_lines);
    IF v_entry IS NOT NULL THEN
      UPDATE journal_entries SET created_by = auth.uid(), branch_id = r.br WHERE id = v_entry;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END
$function$;
REVOKE ALL ON FUNCTION public.post_contacts_opening_entries(uuid, date) FROM PUBLIC, anon, authenticated;

-- post_opening_balances: contacts section per branch; a row may carry its branch
DO $mig$
DECLARE d text; s int; e int; u text := 'UPDATE contacts SET opening_balance = v_amount';
BEGIN
  d := pg_get_functiondef('public.post_opening_balances(date,jsonb,jsonb,jsonb)'::regprocedure);
  IF position('post_contacts_opening_entries' in d) = 0 THEN
    s := position('    IF v_ar + v_c_adv + v_ap + v_s_adv > 0 THEN' in d);
    e := position('  IF p_inventory IS NOT NULL THEN' in d);
    IF s = 0 OR e = 0 OR e < s OR position(u in d) = 0 THEN RAISE EXCEPTION '0206: post_opening_balances anchors not found'; END IF;
    d := substr(d, 1, s - 1)
      || '    v_entries := v_entries + public.post_contacts_opening_entries(v_tenant, p_date);' || E'\n  END IF;\n\n'
      || substr(d, e);
    d := replace(d, u, u || ', opening_branch_id = COALESCE(NULLIF(v_row->>''branch_id'', '''')::uuid, opening_branch_id)');
    EXECUTE d;
  END IF;
END
$mig$;

-- «إيداع تحت الحساب» into a branch till
DROP FUNCTION IF EXISTS public.create_contact_credit_deposit(uuid, numeric, text, text, date, text, text, text);
CREATE OR REPLACE FUNCTION public.create_contact_credit_deposit(p_contact_id uuid, p_amount numeric, p_method text, p_description text DEFAULT NULL::text, p_voucher_date date DEFAULT NULL::date, p_reference_number text DEFAULT NULL::text, p_transferred_from text DEFAULT NULL::text, p_transferred_to text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_cname text;
  v_branch uuid; v_bname text; v_cat uuid; v_cat_name text := 'إيداع رصيد تحت الحساب — حساب الإدارة';
  v_num text; v_tr uuid; v_id uuid; v_uname text; v_desc text;
  v_date date := COALESCE(p_voucher_date, public.cairo_today());
  v_pm text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'إيداع الرصيد تحت الحساب متاح للأدمن والمالك فقط';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF p_method NOT IN ('cash', 'bank') THEN RAISE EXCEPTION 'طريقة الاستلام يجب أن تكون نقدي أو تحويل بنكي'; END IF;
  v_pm := p_method;

  SELECT tenant_id, name INTO v_tenant, v_cname
  FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الجهة غير موجودة'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  PERFORM public._validate_transfer_payment(v_pm, p_reference_number, p_transferred_from, p_transferred_to);

  -- 0206: the money enters the till of the chosen branch (owner 2026-11-14), never a guessed one
  IF p_branch_id IS NULL THEN RAISE EXCEPTION 'اختار الفرع اللي الفلوس هتدخل خزنته'; END IF;
  SELECT id, name INTO v_branch, v_bname
  FROM public.branches
  WHERE id = p_branch_id AND tenant_id = v_tenant AND NOT COALESCE(is_system, false);
  IF v_branch IS NULL THEN RAISE EXCEPTION 'الفرع غير صحيح'; END IF;

  SELECT id, name INTO v_cat, v_cat_name FROM public.voucher_categories
  WHERE tenant_id = v_tenant AND type = 'receipt' AND system_key = 'credit_deposit' LIMIT 1;
  IF v_cat IS NULL THEN
    v_cat_name := 'إيداع رصيد تحت الحساب';
    INSERT INTO public.voucher_categories
      (tenant_id, name, type, is_system, system_key, is_active, is_deductible_from_profit, is_added_to_profit)
    VALUES (v_tenant, v_cat_name, 'receipt', true, 'credit_deposit', true, false, false)
    RETURNING id INTO v_cat;
  END IF;

  SELECT name INTO v_uname FROM public.profiles WHERE id = v_uid;
  v_num := public.next_voucher_number(v_tenant, 'receipt');
  v_desc := COALESCE(NULLIF(BTRIM(p_description), ''), 'إيداع دفعة تحت الحساب');

  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  INSERT INTO public.treasury
    (tenant_id, branch_id, type, category, amount, description, payment_method,
     reference_number, transfer_to_account, transfer_from_account, is_fee, created_by)
  VALUES
    (v_tenant, v_branch, 'income', v_cat_name, p_amount,
     v_desc || ' — ' || v_cname || ' (' || v_num || ')', v_pm,
     p_reference_number, p_transferred_to, p_transferred_from, false, v_uid)
  RETURNING id INTO v_tr;

  INSERT INTO public.vouchers
    (tenant_id, branch_id, voucher_number, type, source, source_type, source_id,
     treasury_id, category_id, amount, payment_method, fee_amount, reference_number,
     transferred_to, transferred_from, party_type, party_id, party_name, description,
     voucher_date, created_by, created_by_name)
  VALUES
    (v_tenant, v_branch, v_num, 'receipt', 'manual', 'credit_deposit', p_contact_id,
     v_tr, v_cat, p_amount, v_pm, 0, p_reference_number,
     p_transferred_to, p_transferred_from, 'other', p_contact_id, v_cname, v_desc,
     v_date, v_uid, v_uname)
  RETURNING id INTO v_id;
  PERFORM set_config('app.skip_treasury_voucher', '0', true);


  INSERT INTO public.customer_credit_log (tenant_id, contact_id, amount, type, notes, created_by)
  VALUES (v_tenant, p_contact_id, p_amount, 'credit_added', v_num || ' — ' || v_desc, v_uid);

  INSERT INTO public.audit_log
    (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES
    (v_uid, COALESCE(v_uname, '?'), v_tenant, v_branch, 'CREATE', 'voucher', v_id::text,
     jsonb_build_object('voucher_number', v_num, 'kind', 'credit_deposit',
       'financial_container', v_bname, 'contact_id', p_contact_id,
       'amount', p_amount, 'method', v_pm));

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_contact_credit_deposit(uuid, numeric, text, text, date, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_contact_credit_deposit(uuid, numeric, text, text, date, text, text, text, uuid) TO authenticated;

-- DATA: the branch of each opening balance as in «سهل» (import staging), then re-sync the accounts it touches.
DO $run$
DECLARE r record; v_t uuid; v_n int := 0; v_day date;
BEGIN
  IF to_regclass('sahl_import.acc') IS NOT NULL THEN
    UPDATE contacts c SET opening_branch_id = b.id
      FROM (SELECT DISTINCT ON (c2.id) c2.id AS contact_id, cb.code
              FROM contacts c2
              JOIN sahl_import.acc a ON a.contact_id = c2.id AND COALESCE(a.opening, 0) <> 0
              JOIN sahl_import.cfg_branch cb ON cb.branch = a.branch
             WHERE COALESCE(c2.opening_balance, 0) <> 0
             ORDER BY c2.id, (abs(abs(a.opening) - abs(c2.opening_balance)) < 0.01) DESC, abs(a.opening) DESC) m
      JOIN branches b ON b.code = m.code
     WHERE c.id = m.contact_id AND b.tenant_id = c.tenant_id AND c.opening_branch_id IS NULL;
  END IF;
  -- an opening balance with no «سهل» account behind it: the contact's own branch
  UPDATE contacts c SET opening_branch_id = c.branch_id
    FROM branches b
   WHERE b.id = c.branch_id AND NOT COALESCE(b.is_system, false)
     AND COALESCE(c.opening_balance, 0) <> 0 AND c.opening_branch_id IS NULL;

  PERFORM set_config('ledger.done', '', true);
  FOR r IN SELECT DISTINCT q.contact_id FROM (
             SELECT mm.contact_id FROM money_movements mm WHERE mm.kind = 'opening' AND mm.status = 'active' AND mm.contact_id IS NOT NULL
             UNION SELECT pa.contact_id FROM payment_allocations pa WHERE pa.is_cross_branch AND pa.status = 'active' AND pa.contact_id IS NOT NULL) q
  LOOP
    PERFORM public.ledger_sync_safe(r.contact_id, NULL, '0206');
    v_n := v_n + 1;
  END LOOP;

  -- the books: the contacts opening entry leaves MAIN-TREASURY for the branches
  FOR v_t IN SELECT DISTINCT e.tenant_id FROM journal_entries e
              WHERE e.source_type = 'opening_balance' AND e.status = 'posted' AND e.reversed_by IS NULL
                AND e.source_id = public.opening_section_key(e.tenant_id, 'contacts') LOOP
    SELECT max(e.entry_date) INTO v_day FROM journal_entries e
     WHERE e.tenant_id = v_t AND e.source_type = 'opening_balance' AND e.status = 'posted' AND e.reversed_by IS NULL
       AND e.source_id = public.opening_section_key(v_t, 'contacts');
    FOR r IN SELECT e.id FROM journal_entries e
              WHERE e.tenant_id = v_t AND e.source_type = 'opening_balance' AND e.status = 'posted' AND e.reversed_by IS NULL
                AND e.source_id = public.opening_section_key(v_t, 'contacts') LOOP
      PERFORM public.reverse_opening_entry(r.id, 'عكس رصيد افتتاحي (توزيع على الفروع)');
    END LOOP;
    PERFORM public.post_contacts_opening_entries(v_t, v_day);
  END LOOP;
  RAISE NOTICE '0206: % accounts re-synced', v_n;
END
$run$;
NOTIFY pgrst, 'reload schema';
