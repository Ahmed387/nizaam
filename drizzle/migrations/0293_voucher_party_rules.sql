-- 0293 (owner 2026-11-26): (ج) «أي سند تصنيفه مدفوعات موردين أو تحصيل من عميل يترفض لو مفيش حساب متختار … نفذها»،
-- «خلي إني أدخل مورد أو عميل ده إجباري في أقساط العملاء ومقبوضات من موردين»، «اخترت أي حاجة من التصنيف تخص الموظفين
-- يبقى … حد من الموظفين النشطين … Drop down list»، and for a settlement cancelled after its period was locked:
-- «يتسجل في أول يوم مفتوح … نفذ».
--  1. The category decides who the voucher is for (`voucher_category_party_rule`): a category on 1200 → a customer,
--     on 2100 → a supplier, salaries / advances / advance repayments (and their sub-items) → an ACTIVE employee.
--     A hand-written voucher (source 'manual') with such a category is refused without that party — on insert and on
--     any change of category / party (an edit makes a new voucher). Automatic vouchers, «سهل» import mode and the
--     settlement RPCs are not touched. PV-7650 (25/11, 10,000, no supplier) is left as it is — the owner decides.
--  2. «مقبوضات من موردين» (a receipt category on 2100) is the ONE receipt that may name a supplier; every other
--     receipt from a supplier is still refused (purchase return / branch transfer, 0070).
--  3. Cancelling a settlement whose day is in a closed period is allowed; its reversals land on the first open day
--     (`ledger_effective_date`), so a gain / loss moves from its month to the cancel's first open day.

CREATE OR REPLACE FUNCTION public.voucher_category_party_rule(p_category uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH RECURSIVE c AS (
    SELECT id, parent_id, system_key, gl_account_code, 0 AS lvl FROM public.voucher_categories WHERE id = p_category
    UNION ALL
    SELECT p.id, p.parent_id, p.system_key, p.gl_account_code, c.lvl + 1 FROM public.voucher_categories p JOIN c ON p.id = c.parent_id WHERE c.lvl < 5
  )
  SELECT r FROM (
    SELECT lvl, CASE WHEN gl_account_code = '1200' THEN 'customer'
                     WHEN gl_account_code = '2100' THEN 'supplier'
                     WHEN system_key IN ('salary', 'advance', 'advance_repayment') OR gl_account_code IN ('1450', '5200') THEN 'employee'
                END AS r
      FROM c) x
   WHERE r IS NOT NULL ORDER BY lvl LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.voucher_category_party_rule(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_voucher_category_party()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE r text; v_cat text;
BEGIN
  IF public.sahl_import_mode() OR coalesce(current_setting('app.settlement_op', true), '') = '1' THEN RETURN NEW; END IF;
  IF NEW.source IS DISTINCT FROM 'manual' OR coalesce(NEW.status::text, 'active') <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id AND NEW.party_type IS NOT DISTINCT FROM OLD.party_type
     AND NEW.party_id IS NOT DISTINCT FROM OLD.party_id THEN
    RETURN NEW;
  END IF;
  r := public.voucher_category_party_rule(NEW.category_id);
  IF r IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO v_cat FROM public.voucher_categories WHERE id = NEW.category_id;
  IF r IN ('customer', 'supplier') THEN
    IF NEW.party_id IS NULL OR NEW.party_type::text IS DISTINCT FROM r THEN
      RAISE EXCEPTION 'التصنيف «%» لازم تختار له %', v_cat, CASE r WHEN 'customer' THEN 'العميل' ELSE 'المورد' END USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.party_id IS NULL OR NEW.party_type::text IS DISTINCT FROM 'employee'
        OR NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = NEW.party_id AND e.tenant_id = NEW.tenant_id AND coalesce(e.is_active, true)) THEN
    RAISE EXCEPTION 'التصنيف «%» لازم تختار الموظف من الموظفين الشغالين', v_cat USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_voucher_category_party() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a1_guard_voucher_category_party ON public.vouchers;
CREATE TRIGGER a1_guard_voucher_category_party BEFORE INSERT OR UPDATE OF category_id, party_type, party_id ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.guard_voucher_category_party();

-- 2. «مقبوضات من موردين» may name a supplier
CREATE OR REPLACE FUNCTION public.guard_voucher_receipt_party()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF public.sahl_import_mode() THEN RETURN NEW; END IF;  -- 0156 import mode
  IF coalesce(current_setting('app.settlement_op', true), '') = '1' THEN RETURN NEW; END IF;  -- 0291 settlement
  IF NEW.type = 'receipt' AND NEW.party_type::text = 'supplier' AND COALESCE(NEW.status::text, 'active') = 'active'
     AND public.voucher_category_party_rule(NEW.category_id) IS DISTINCT FROM 'supplier' THEN  -- 0293: «مقبوضات من موردين»
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'سند القبض من مورد بيبقى على تصنيف «مقبوضات من موردين» بس. فلوس جاية من فرع تاني → «التحويلات بين الفروع». بضاعة رجعت للمورد → «مرتجع شراء».';
  END IF;
  RETURN NEW;
END $function$;

-- 3. a settlement cancelled after its period was locked
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.enforce_closed_period_doc_guard()'::regprocedure);
  IF position('  IF v_tenant IS NULL OR v_date IS NULL THEN' IN d) = 0 THEN RAISE EXCEPTION '0293: enforce_closed_period_doc_guard text not found'; END IF;
  EXECUTE replace(d, '  IF v_tenant IS NULL OR v_date IS NULL THEN',
    '  -- 0293: cancelling a settlement whose day is locked — its reversals go on the first open day (ledger_effective_date)
  IF TG_TABLE_NAME = ''vouchers'' AND TG_OP = ''UPDATE'' THEN
    IF coalesce(current_setting(''app.settlement_op'', true), '''') = ''1''
       AND NEW.status::text = ''cancelled'' AND OLD.status::text IS DISTINCT FROM ''cancelled'' THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_tenant IS NULL OR v_date IS NULL THEN');
END $$;

-- 3b. inside that cancel the journal may only LINK the locked entry to its reversal (reversed_by) — nothing else changes there
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.enforce_closed_period_guard()'::regprocedure);
  IF position('DECLARE v_closed BOOLEAN;
BEGIN' IN d) = 0 THEN RAISE EXCEPTION '0293: enforce_closed_period_guard text not found'; END IF;
  EXECUTE replace(d, 'DECLARE v_closed BOOLEAN;
BEGIN', 'DECLARE v_closed BOOLEAN;
BEGIN
  -- 0293: a settlement cancelled after its period was locked links the locked entry to its reversal (on the first open day)
  IF TG_OP = ''UPDATE'' AND coalesce(current_setting(''app.settlement_op'', true), '''') = ''1''
     AND (to_jsonb(NEW) - ''reversed_by'') = (to_jsonb(OLD) - ''reversed_by'') THEN
    RETURN NEW;
  END IF;');

  -- the flag stays on while the account's ledger and books follow the cancel
  d := pg_get_functiondef('public.cancel_contact_settlement(uuid, text)'::regprocedure);
  IF position('  PERFORM set_config(''app.settlement_op'', '''', true);
  UPDATE public.contact_settlements SET status = ''cancelled''' IN d) = 0
     OR position('  PERFORM public.ledger_gl_sync(s.tenant_id, s.contact_id, NULL);
  RETURN' IN d) = 0 THEN RAISE EXCEPTION '0293: cancel_contact_settlement text not found'; END IF;
  d := replace(d, '  PERFORM set_config(''app.settlement_op'', '''', true);
  UPDATE public.contact_settlements SET status = ''cancelled''', '  UPDATE public.contact_settlements SET status = ''cancelled''');
  d := replace(d, '  PERFORM public.ledger_gl_sync(s.tenant_id, s.contact_id, NULL);
  RETURN', '  PERFORM public.ledger_gl_sync(s.tenant_id, s.contact_id, NULL);
  PERFORM set_config(''app.settlement_op'', '''', true);
  RETURN');
  EXECUTE d;
END $$;
