-- PRE for 0123 — ONE batch: this file → 0123 → 0123_checks.sql. Raises at the end → ROLLBACK.
-- pg_temp.sweep(user, branch): calls every screen read RPC as that user, returns OK / size / error per function.
CREATE OR REPLACE FUNCTION pg_temp.sweep(u uuid, br uuid)
RETURNS TABLE(f text, o text) LANGUAGE plpgsql AS $$
DECLARE
  fns text[] := array['ai_report_catalog','branch_limit_status','contact_side_balances','contacts_page',
    'current_shift_schedule','document_class_preview','employee_advance_due','employee_salary_preview',
    'expected_opening_cash','get_available_quantity','get_financial_kpis','get_open_shift','get_opening_balances',
    'get_product_references_count','ledger_aging','ledger_contact_documents','ledger_contact_money','ledger_contact_overview',
    'ledger_contact_statement','ledger_money_flow','ledger_position',
    'opening_balances_summary','owner_business_snapshot','search_branch_contacts',
    'shift_handovers','shift_sale_gate','stock_transfer_values','system_integrity_summary',
    'treasury_balance_after','treasury_row_links','voucher_money_split','get_branch_wallet_balances','historical_stock_at',
    'detect_anomalies','detect_orphaned_batches','preview_flexible_distribution'];
  B text := quote_literal(br) || '::uuid'; C text := '''66098089-bc1f-4bc9-816a-a702bd7db54f''::uuid';
  P text := '''a945e0be-4e1f-4205-ba8b-f9f23682d99d''::uuid'; I text := '''6b3647e2-2d68-49ea-8beb-1c1c285aa760''::uuid';
  S text := '''03f3169b-0a9b-4e84-a586-b554e2572cb1''::uuid'; E text := '''9f669cfb-1cda-467b-9e29-5bdaf8f64264''::uuid';
  T text := '''5eb486c2-1b55-41bf-b12d-4bf4f5f5dd80''::uuid'; V text := '''5422030d-5c48-47e9-ac8c-cd7db475b539''::uuid';
  TEN text := '''5316fbfe-b862-4c91-b48b-1d81c8aa5a71''::uuid';
  fn text; pr record; args text; a text; nm text; ty text; k int; n bigint; tx text;
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    SELECT p.oid, p.proretset, p.proargnames, string_to_array(nullif(p.proargtypes::text, ''), ' ')::oid[] types INTO pr
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn ORDER BY p.pronargs DESC LIMIT 1;
    f := fn;
    IF pr.oid IS NULL THEN o := 'missing'; RETURN NEXT; CONTINUE; END IF;
    args := '';
    FOR k IN 1 .. coalesce(array_length(pr.types, 1), 0) LOOP
      nm := lower(coalesce(pr.proargnames[k], ''));
      ty := format_type(pr.types[k], null);
      a := CASE
        WHEN ty = 'uuid' THEN CASE
          WHEN nm ~ 'branch' THEN B WHEN nm ~ 'contact|party|customer|supplier' THEN C WHEN nm ~ 'product' THEN P
          WHEN nm ~ 'shipment' THEN S WHEN nm ~ 'invoice|doc|source|record|ref' THEN I WHEN nm ~ 'employee' THEN E
          WHEN nm ~ 'treasury' THEN T WHEN nm ~ 'voucher' THEN V WHEN nm ~ 'user|uid' THEN quote_literal(u) || '::uuid'
          WHEN nm ~ 'tenant' THEN TEN ELSE 'NULL::uuid' END
        WHEN ty = 'uuid[]' THEN CASE WHEN nm ~ 'branch' THEN 'array[' || B || ']' WHEN nm ~ 'voucher' THEN 'array[' || V || ']'
          WHEN nm ~ 'invoice|doc' THEN 'array[' || I || ']' WHEN nm ~ 'ids|treasury' THEN 'array[' || T || ']' ELSE 'NULL::uuid[]' END
        WHEN ty IN ('date', 'timestamp with time zone', 'timestamp without time zone') THEN
          CASE WHEN nm ~ 'from|start' THEN '(current_date - 30)::' || ty ELSE 'current_date::' || ty END
        WHEN ty = 'text' THEN CASE WHEN nm ~ 'side' THEN '''customer''' WHEN nm ~ 'kind|type' THEN '''sale'''
          WHEN nm ~ 'search|^_?q$|term|query' THEN '''''' WHEN nm ~ 'period' THEN '''month''' ELSE 'NULL::text' END
        WHEN ty IN ('integer', 'bigint', 'smallint') THEN CASE WHEN nm ~ 'offset' THEN '0' WHEN nm ~ 'page' THEN '1' ELSE '50' END
        WHEN ty = 'numeric' THEN '0'
        WHEN ty = 'boolean' THEN 'false'
        WHEN ty IN ('jsonb', 'json') THEN '''{}''::' || ty
        ELSE 'NULL::' || ty END;
      args := args || CASE WHEN k > 1 THEN ', ' ELSE '' END || coalesce(a, 'NULL');
    END LOOP;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    EXECUTE 'set local role authenticated';
    BEGIN
      IF pr.proretset THEN EXECUTE format('select count(*) from public.%I(%s)', fn, args) INTO n; o := 'rows=' || n;
      ELSE EXECUTE format('select (public.%I(%s))::text', fn, args) INTO tx; o := CASE WHEN tx IS NULL THEN 'null' ELSE 'len=' || length(tx) END;
      END IF;
    EXCEPTION WHEN others THEN o := 'ERR ' || left(sqlerrm, 90);
    END;
    EXECUTE 'reset role';
    RETURN NEXT;
  END LOOP;
END $$;

-- before: owner, a cashier in his own branch, الحاج ناصر (the heavy reports — branch_stock_report, reconciliations,
-- document_log_page, ledger_gl_reconciliation 27 s, system_health_check 5 s — are left out of the sweep so the batch fits the time limit; branch_stock_report is checked alone)
CREATE TEMP TABLE sweep_before AS
SELECT x.who, s.f, s.o FROM (VALUES
    ('owner',   '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'::uuid),
    ('cashier', 'a3174891-df98-4baa-a806-8c4c94d29eca'::uuid),
    ('nasser',  '06e224b7-5c3f-4f7c-9f4a-11f8695ff981'::uuid)) x(who, uid),
  LATERAL pg_temp.sweep(x.uid, '1329f6cc-a4a5-418c-9e91-cccd651b3142'::uuid) s;
