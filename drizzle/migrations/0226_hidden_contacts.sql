-- 0226 — «إخفاء حساب» (owner 2026-11-15: «المالك يفتح مورد يلاقي زرار … hide … مش بيظهر غير للمالك … فواتير المورد او العميل دي
-- تختفي خالص متظهرش لحد بس فلوس المورد او العميل دي داخلة في الحسابات والتقارير»; answers: hidden from everyone but the owner,
-- totals keep it, only the owner makes new documents for it, its whole history is hidden).
--
--   * hidden_contacts           — the accounts the owner hid (one row each) + hidden_contact_log (every hide / show).
--   * hidden_refs               — every row id that belongs to a hidden account: the account, its sale / purchase invoices, returns,
--                                 prior-year returns, vouchers, payments, plans, money movements, allocations, settlements, quotes,
--                                 pre-orders and the till rows of all of these. Rebuilt by hidden_refs_rebuild(contact) on hide and
--                                 at the commit of any transaction of the owner / the system that wrote such rows.
--   * RESTRICTIVE policy «hidden_contact_rows» on each of those tables (and their line tables + document_events): a row in
--     hidden_refs is invisible to anybody but the owner (sees_hidden() = owner, or no signed-in user = the system).
--   * guard_hidden_contact_write: nobody but the owner writes a document / voucher / payment for a hidden account (also through
--     server functions, which skip RLS).
--   * the server readers that list accounts are wrapped (original kept as <name>__all, no browser grant): a hidden account is
--     dropped from contacts_page rows, search_branch_contacts, contact_side_balances, contacts_balance_age, contacts_debit_credit,
--     ledger_aging; its statement (ledger_contact_statement and its body _x, both open to the browser) / movements / documents /
--     money come back empty and its overview says «مش موجود».
--   Dry-run «مدحت طوخ» (شلبى, 19 rows): manager / partner see 0 of the account, its 2 documents, 4 lines, 3 vouchers, 3 till rows
--     and 2 log rows, it is gone from search / lists / balances / aging, its page says «الحساب مش موجود»; the totals of the
--     accounts list, the wallets and owner_business_snapshot are identical before and after; the owner sees everything; a
--     manager editing its invoice through a server path gets «الحساب ده مش متاح»; security_exposed_definer_functions() empty.
--   * TOTALS are untouched: tills, books, profit, stock, contacts_page totals, owner_business_snapshot keep the hidden account.
--   * owner only: set_contact_hidden(contact, hidden, reason), hidden_contacts_list(), contact_is_hidden(contact).
-- Nothing here moves money, stock or entries.

CREATE TABLE IF NOT EXISTS public.hidden_contacts (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  hidden_by uuid,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
CREATE INDEX IF NOT EXISTS hidden_contacts_tenant ON public.hidden_contacts (tenant_id);

CREATE TABLE IF NOT EXISTS public.hidden_contact_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('hide', 'show')),
  by_user uuid,
  at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE TABLE IF NOT EXISTS public.hidden_refs (
  ref_id uuid NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  PRIMARY KEY (ref_id, contact_id)
);
CREATE INDEX IF NOT EXISTS hidden_refs_contact ON public.hidden_refs (contact_id);

ALTER TABLE public.hidden_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hidden_contact_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hidden_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hidden_contacts, public.hidden_contact_log, public.hidden_refs FROM PUBLIC, anon, authenticated;

-- who sees hidden accounts: the company owner, or the system (no signed-in user: pg_cron, imports, service role)
CREATE OR REPLACE FUNCTION public.sees_hidden()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT auth.uid() IS NULL OR public.is_owner(auth.uid()) $$;

-- true when nothing is hidden from me (owner / system / my company hides nothing) — evaluated once per statement in the policies
CREATE OR REPLACE FUNCTION public.hidden_none_for_me()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.sees_hidden() OR NOT EXISTS (SELECT 1 FROM public.hidden_contacts WHERE tenant_id = public.current_tenant_id()) $$;

CREATE OR REPLACE FUNCTION public.hidden_ref(p uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.hidden_refs WHERE ref_id = p) $$;

REVOKE ALL ON FUNCTION public.sees_hidden(), public.hidden_none_for_me(), public.hidden_ref(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sees_hidden(), public.hidden_none_for_me(), public.hidden_ref(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS vouchers_source_id_idx ON public.vouchers (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_plans_reference_id_idx ON public.payment_plans (reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prior_year_returns_contact_idx ON public.prior_year_returns (contact_id);

-- every row of one hidden account (rebuilt from scratch; nothing when the account is not hidden). Id arrays, so every step is
-- an index lookup.
CREATE OR REPLACE FUNCTION public.hidden_refs_rebuild(p_contact uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; n int;
  a_inv uuid[]; a_ret uuid[]; a_shp uuid[]; a_pr uuid[]; a_py uuid[]; a_q uuid[]; a_po uuid[]; a_st uuid[]; a_sp uuid[];
  a_cl uuid[]; a_mm uuid[]; a_al uuid[]; a_pl uuid[]; a_pt uuid[]; a_docs uuid[]; a_till uuid[]; a_v uuid[]; a_till2 uuid[];
BEGIN
  DELETE FROM hidden_refs WHERE contact_id = p_contact;
  SELECT tenant_id INTO v_t FROM hidden_contacts WHERE contact_id = p_contact;
  IF v_t IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO a_inv FROM invoices WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_ret FROM returns WHERE invoice_id = ANY (a_inv);
  SELECT COALESCE(array_agg(id), '{}') INTO a_shp FROM shipments WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_pr FROM purchase_returns WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_py FROM prior_year_returns WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_q FROM quotes WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_po FROM pre_orders WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_st FROM contact_settlements WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_sp FROM supplier_payments WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_cl FROM customer_credit_log WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_mm FROM money_movements WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_al FROM payment_allocations WHERE contact_id = p_contact;
  SELECT COALESCE(array_agg(id), '{}') INTO a_pl FROM payment_plans WHERE reference_id = ANY (a_inv || a_shp);
  SELECT COALESCE(array_agg(id), '{}') INTO a_pt FROM payment_transactions
   WHERE contact_id = p_contact OR payment_plan_id = ANY (a_pl) OR invoice_id = ANY (a_inv);
  a_docs := a_inv || a_ret || a_shp || a_pr || a_py || a_st;
  -- till rows: of the documents, of the payments (and their fees), of supplier payments, of invoice payment fees
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO a_till FROM (
      SELECT id AS x FROM treasury WHERE reference_id = ANY (a_docs)
      UNION ALL SELECT treasury_id FROM payment_transactions WHERE id = ANY (a_pt)
      UNION ALL SELECT fee_treasury_id FROM payment_transactions WHERE id = ANY (a_pt)
      UNION ALL SELECT fee_treasury_id FROM invoice_payments WHERE invoice_id = ANY (a_inv)
      UNION ALL SELECT treasury_id FROM supplier_payments WHERE id = ANY (a_sp)) q WHERE x IS NOT NULL;
  -- vouchers: to / from him, or carrying one of his till rows / documents / payments
  SELECT COALESCE(array_agg(DISTINCT id), '{}') INTO a_v FROM (
      SELECT id FROM vouchers WHERE party_id = p_contact
      UNION ALL SELECT id FROM vouchers WHERE treasury_id = ANY (a_till)
      UNION ALL SELECT id FROM vouchers WHERE source_id = ANY (a_docs || a_pt)) q;
  -- the till rows of those vouchers and the rows reversing them («إلغاء سند»)
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO a_till2 FROM (
      SELECT treasury_id AS x FROM vouchers WHERE id = ANY (a_v)
      UNION ALL SELECT id FROM treasury WHERE reference_id = ANY (a_v || a_till)) q WHERE x IS NOT NULL;

  INSERT INTO hidden_refs (ref_id, contact_id, tenant_id, kind)
  SELECT DISTINCT ON (ref_id) ref_id, p_contact, v_t, kind FROM (
      SELECT p_contact AS ref_id, 'contact' AS kind
      UNION ALL SELECT unnest(a_inv), 'invoice' UNION ALL SELECT unnest(a_ret), 'return'
      UNION ALL SELECT unnest(a_shp), 'shipment' UNION ALL SELECT unnest(a_pr), 'purchase_return'
      UNION ALL SELECT unnest(a_py), 'prior_year_return' UNION ALL SELECT unnest(a_q), 'quote'
      UNION ALL SELECT unnest(a_po), 'pre_order' UNION ALL SELECT unnest(a_st), 'settlement'
      UNION ALL SELECT unnest(a_sp), 'supplier_payment' UNION ALL SELECT unnest(a_cl), 'credit_log'
      UNION ALL SELECT unnest(a_mm), 'money' UNION ALL SELECT unnest(a_al), 'allocation'
      UNION ALL SELECT unnest(a_pl), 'plan' UNION ALL SELECT unnest(a_pt), 'payment'
      UNION ALL SELECT unnest(a_v), 'voucher' UNION ALL SELECT unnest(a_till || a_till2), 'till') q
   WHERE ref_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION public.hidden_refs_rebuild(uuid) FROM PUBLIC, anon, authenticated;

-- keep hidden_refs current: at commit, only when the written row belongs to a hidden account (directly, or through one of
-- its rows already listed), once per account per transaction. Only the owner / the system can write such rows (the guard).
CREATE OR REPLACE FUNCTION public.hidden_refs_touch()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c uuid; j jsonb := to_jsonb(NEW); k text; v_t uuid := NULLIF(to_jsonb(NEW)->>'tenant_id', '')::uuid;
BEGIN
  IF v_t IS NULL OR NOT EXISTS (SELECT 1 FROM hidden_contacts WHERE tenant_id = v_t) THEN RETURN NULL; END IF;
  c := NULLIF(COALESCE(j->>'contact_id', j->>'party_id'), '')::uuid;
  IF c IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hidden_contacts WHERE contact_id = c) THEN c := NULL; END IF;
  IF c IS NULL THEN
    -- linked through a row already listed: the document of a till row / return / plan / voucher / payment
    SELECT r.contact_id INTO c FROM hidden_refs r
     WHERE r.ref_id IN (NULLIF(j->>'reference_id', '')::uuid, NULLIF(j->>'invoice_id', '')::uuid,
                        NULLIF(j->>'source_id', '')::uuid, NULLIF(j->>'treasury_id', '')::uuid,
                        NULLIF(j->>'payment_plan_id', '')::uuid, NEW.id)
     LIMIT 1;
  END IF;
  IF c IS NULL THEN RETURN NULL; END IF;
  k := 'app.hidden_refs_' || replace(c::text, '-', '');
  IF current_setting(k, true) = txid_current()::text THEN RETURN NULL; END IF;
  PERFORM set_config(k, txid_current()::text, true);
  PERFORM public.hidden_refs_rebuild(c);
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.hidden_refs_touch() FROM PUBLIC, anon, authenticated;

-- nobody but the owner writes for a hidden account (server functions skip RLS, so this is the real gate)
CREATE OR REPLACE FUNCTION public.guard_hidden_contact_write()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c uuid;
BEGIN
  IF public.sees_hidden() THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'vouchers' THEN c := NEW.party_id;
  ELSIF TG_TABLE_NAME = 'returns' THEN SELECT contact_id INTO c FROM invoices WHERE id = NEW.invoice_id;
  ELSE c := NEW.contact_id;
  END IF;
  IF (c IS NOT NULL AND EXISTS (SELECT 1 FROM hidden_contacts WHERE contact_id = c))
     OR (TG_OP = 'UPDATE' AND public.hidden_ref(NEW.id)) THEN
    RAISE EXCEPTION 'الحساب ده مش متاح' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_hidden_contact_write() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text; col text;
BEGIN
  -- tables whose own id is listed in hidden_refs
  FOREACH t IN ARRAY ARRAY['contacts', 'invoices', 'returns', 'shipments', 'purchase_returns', 'prior_year_returns', 'quotes',
                           'pre_orders', 'contact_settlements', 'supplier_payments', 'customer_credit_log', 'money_movements',
                           'payment_allocations', 'payment_plans', 'payment_transactions', 'treasury', 'vouchers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS hidden_contact_rows ON public.%I', t);
    EXECUTE format('CREATE POLICY hidden_contact_rows ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
                    USING ((SELECT public.hidden_none_for_me()) OR NOT public.hidden_ref(id))', t);
  END LOOP;
  -- line tables and the document log follow their document
  FOR t, col IN SELECT * FROM (VALUES ('invoice_items', 'invoice_id'), ('invoice_payments', 'invoice_id'), ('shipment_items', 'shipment_id'),
                                      ('return_items', 'return_id'), ('purchase_return_items', 'purchase_return_id'),
                                      ('document_events', 'doc_id')) v(t, col) LOOP
    EXECUTE format('DROP POLICY IF EXISTS hidden_contact_rows ON public.%I', t);
    EXECUTE format('CREATE POLICY hidden_contact_rows ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
                    USING ((SELECT public.hidden_none_for_me()) OR NOT public.hidden_ref(%I))', t, col);
  END LOOP;
  -- write gate
  FOREACH t IN ARRAY ARRAY['invoices', 'returns', 'shipments', 'purchase_returns', 'prior_year_returns', 'quotes', 'pre_orders',
                           'contact_settlements', 'supplier_payments', 'payment_transactions', 'vouchers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a0_guard_hidden_contact ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a0_guard_hidden_contact BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.guard_hidden_contact_write()', t);
  END LOOP;
  -- refresh at commit
  FOREACH t IN ARRAY ARRAY['invoices', 'returns', 'shipments', 'purchase_returns', 'prior_year_returns', 'contact_settlements',
                           'supplier_payments', 'customer_credit_log', 'money_movements', 'payment_allocations', 'payment_plans',
                           'payment_transactions', 'treasury', 'vouchers', 'quotes', 'pre_orders'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_hidden_refs_touch ON public.%I', t);
    EXECUTE format('CREATE CONSTRAINT TRIGGER zz_hidden_refs_touch AFTER INSERT OR UPDATE ON public.%I
                    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hidden_refs_touch()', t);
  END LOOP;
END $$;

-- ---- the server readers that list accounts: wrap them (the original stays as <name>__all, not callable from the browser) ----
DO $$
DECLARE r record; mode text; call_args text; body text; wrap_name text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_arguments(p.oid) AS a, pg_get_function_identity_arguments(p.oid) AS ia,
           pg_get_function_result(p.oid) AS res, p.proargnames AS names, p.pronargs AS nargs
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('contacts_page', 'search_branch_contacts', 'contact_side_balances', 'contacts_balance_age',
                         'contacts_debit_credit', 'ledger_aging', 'contact_account_movements', 'ledger_contact_documents',
                         'ledger_contact_money', 'ledger_contact_statement', 'ledger_contact_statement_x', 'ledger_contact_overview')
  LOOP
    wrap_name := r.proname || '__all';
    IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = wrap_name) THEN
      CONTINUE; -- already wrapped
    END IF;
    SELECT string_agg(quote_ident(n), ', ' ORDER BY i) INTO call_args
      FROM unnest(r.names[1:r.nargs]) WITH ORDINALITY AS u(n, i);
    EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', r.proname, r.ia, wrap_name);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', wrap_name, r.ia);

    mode := CASE
      WHEN r.proname = 'contacts_page' THEN 'json_rows'
      WHEN r.proname = 'ledger_contact_overview' THEN 'json_contact'
      WHEN r.proname = 'search_branch_contacts' THEN 'rows_id'
      WHEN r.proname IN ('contact_side_balances', 'contacts_balance_age', 'contacts_debit_credit', 'ledger_aging') THEN 'rows_contact'
      ELSE 'arg_contact' END;

    IF mode = 'json_rows' THEN
      body := format($b$
DECLARE v jsonb;
BEGIN
  v := public.%I(%s);
  IF (SELECT public.hidden_none_for_me()) OR v IS NULL OR jsonb_typeof(v->'rows') <> 'array' THEN RETURN v; END IF;
  RETURN jsonb_set(v, '{rows}', COALESCE((SELECT jsonb_agg(e ORDER BY o) FROM jsonb_array_elements(v->'rows') WITH ORDINALITY AS x(e, o)
                                           WHERE NOT public.hidden_ref(NULLIF(e->>'id', '')::uuid)), '[]'::jsonb));
END$b$, wrap_name, call_args);
      EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''public'' AS %L',
                     r.proname, r.a, r.res, body);
    ELSIF mode = 'json_contact' THEN
      body := format($b$
BEGIN
  IF NOT (SELECT public.hidden_none_for_me()) AND public.hidden_ref(p_contact) THEN
    RAISE EXCEPTION 'الحساب مش موجود' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.%I(%s);
END$b$, wrap_name, call_args);
      EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''public'' AS %L',
                     r.proname, r.a, r.res, body);
    ELSE
      body := format('SELECT * FROM public.%I(%s) x WHERE (SELECT public.hidden_none_for_me()) OR %s',
                     wrap_name, call_args,
                     CASE mode WHEN 'rows_id' THEN 'NOT public.hidden_ref(x.id)'
                               WHEN 'rows_contact' THEN 'NOT public.hidden_ref(x.contact_id)'
                               ELSE 'NOT public.hidden_ref(p_contact)' END);
      EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''public'' AS %L',
                     r.proname, r.a, r.res, body);
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.ia);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.ia);
  END LOOP;
END $$;

-- ---- owner: hide / show, the list, one account's state ----
CREATE OR REPLACE FUNCTION public.set_contact_hidden(p_contact uuid, p_hidden boolean, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); c record; n int := 0;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'إخفاء الحسابات للمالك بس' USING ERRCODE = '42501'; END IF;
  SELECT id, tenant_id, name, internal_branch_id INTO c FROM contacts WHERE id = p_contact AND tenant_id = v_t;
  IF c.id IS NULL THEN RAISE EXCEPTION 'الحساب مش موجود'; END IF;
  IF p_hidden THEN
    IF c.internal_branch_id IS NOT NULL THEN RAISE EXCEPTION 'ده حساب فرع من فروعنا — مينفعش يتخفى'; END IF;
    INSERT INTO hidden_contacts (contact_id, tenant_id, hidden_by, reason) VALUES (c.id, v_t, auth.uid(), NULLIF(btrim(p_reason), ''))
    ON CONFLICT (contact_id) DO UPDATE SET reason = COALESCE(EXCLUDED.reason, hidden_contacts.reason);
    n := public.hidden_refs_rebuild(c.id);
  ELSE
    DELETE FROM hidden_contacts WHERE contact_id = c.id;
    DELETE FROM hidden_refs WHERE contact_id = c.id;
  END IF;
  INSERT INTO hidden_contact_log (tenant_id, contact_id, action, by_user, reason)
  VALUES (v_t, c.id, CASE WHEN p_hidden THEN 'hide' ELSE 'show' END, auth.uid(), NULLIF(btrim(p_reason), ''));
  RETURN jsonb_build_object('hidden', p_hidden, 'rows', n, 'name', c.name);
END
$function$;

CREATE OR REPLACE FUNCTION public.contact_is_hidden(p_contact uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.is_owner(auth.uid()) AND EXISTS (SELECT 1 FROM hidden_contacts WHERE contact_id = p_contact AND tenant_id = public.current_tenant_id()) $$;

CREATE OR REPLACE FUNCTION public.hidden_contacts_list()
 RETURNS TABLE(contact_id uuid, account_no integer, name text, contact_type text, branch_name text, hidden_at timestamptz,
               hidden_by_name text, reason text, documents integer, customer_balance numeric, supplier_balance numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'للمالك بس' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT h.contact_id, c.account_no, c.name, c.type::text, b.name, h.hidden_at, p.name, h.reason,
         (SELECT count(*)::int FROM hidden_refs r WHERE r.contact_id = h.contact_id
           AND r.kind IN ('invoice', 'return', 'shipment', 'purchase_return', 'prior_year_return', 'voucher')),
         COALESCE(sb.customer_balance, 0), COALESCE(sb.supplier_balance, 0)
    FROM hidden_contacts h
    JOIN contacts c ON c.id = h.contact_id
    LEFT JOIN branches b ON b.id = c.branch_id
    LEFT JOIN profiles p ON p.id = h.hidden_by
    LEFT JOIN LATERAL (SELECT * FROM public.contact_side_balances__all(ARRAY[h.contact_id], NULL)) sb ON true
   WHERE h.tenant_id = v_t
   ORDER BY h.hidden_at DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.set_contact_hidden(uuid, boolean, text), public.contact_is_hidden(uuid), public.hidden_contacts_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contact_hidden(uuid, boolean, text), public.contact_is_hidden(uuid), public.hidden_contacts_list() TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('set_contact_hidden', '0226', 'owner: hide / show an account and all its documents from everybody else'),
  ('contact_is_hidden', '0226', 'owner: is this account hidden'),
  ('hidden_contacts_list', '0226', 'owner: the hidden accounts'),
  ('sees_hidden', '0226', 'policy helper (true / false only)'),
  ('hidden_none_for_me', '0226', 'policy helper (true / false only)'),
  ('hidden_ref', '0226', 'policy helper (true / false only)')
ON CONFLICT DO NOTHING;
