-- 0165: the end of the «سهل» import (owner 2026-11-05 «نفذها بالكامل … كمل»), after every operation of 0157–0164 is in.
-- During the import the per-line moving average and the ledger capture were off (0156); now, in committed steps from
-- pg_cron like the import (`sahl_import.fin_step(n)`), OUTSIDE import mode:
--   1. `recost_product_sales(products, 2026-01-01)` — every 2026 sale line gets the branch moving average at its own
--      moment, its invoice's COGS entry is re-posted, its returns' journals re-synced (0134);
--   2. `ledger_sync_safe(contact)` for every account and `ledger_sync_safe(NULL, invoice)` for every walk-in invoice —
--      the unified ledger, its GL entries and the advance mirror (0055–0058); errors go to ledger_sync_errors;
--   3. products.cost_price = the moving average where there is one.
-- The queue (`fin_queue`) is filled once by `fin_fill()`; each step does the next n rows in that order.
CREATE TABLE IF NOT EXISTS sahl_import.fin_queue (id bigserial PRIMARY KEY, ord int NOT NULL, kind text NOT NULL, refs uuid[] NOT NULL,
  done_at timestamptz, res jsonb);

CREATE OR REPLACE FUNCTION sahl_import.fin_fill() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_t uuid := (SELECT tenant_id FROM public.branches WHERE code = 'FR-005');
BEGIN
  IF EXISTS (SELECT 1 FROM sahl_import.fin_queue) THEN RETURN jsonb_build_object('filled', false); END IF;
  IF EXISTS (SELECT 1 FROM sahl_import.ops WHERE status = 'todo' AND day <= '2026-10-28') THEN
    RAISE EXCEPTION 'fin_fill: operations still waiting';
  END IF;
  INSERT INTO sahl_import.fin_queue (ord, kind, refs)
  SELECT 1, 'recost', array_agg(pid ORDER BY pid) FROM (
    SELECT pid, (row_number() OVER (ORDER BY pid) - 1) / 40 AS g FROM (
      SELECT DISTINCT ii.product_id AS pid FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
       WHERE i.tenant_id = v_t AND i.status = 'active') p) z GROUP BY g;
  INSERT INTO sahl_import.fin_queue (ord, kind, refs)
  SELECT 2, 'ledger', array_agg(id ORDER BY id) FROM (
    SELECT c.id, (row_number() OVER (ORDER BY c.id) - 1) / 100 AS g FROM public.contacts c WHERE c.tenant_id = v_t) z GROUP BY g;
  INSERT INTO sahl_import.fin_queue (ord, kind, refs)
  SELECT 3, 'walkin', array_agg(id ORDER BY id) FROM (
    SELECT i.id, (row_number() OVER (ORDER BY i.id) - 1) / 200 AS g FROM public.invoices i
     WHERE i.tenant_id = v_t AND i.contact_id IS NULL) z GROUP BY g;
  INSERT INTO sahl_import.fin_queue (ord, kind, refs) VALUES (4, 'cost_price', ARRAY[v_t]);
  RETURN (SELECT jsonb_object_agg(kind, n) FROM (SELECT kind, count(*) n FROM sahl_import.fin_queue GROUP BY 1) z);
END
$$;

CREATE OR REPLACE FUNCTION sahl_import.fin_step(p_n int DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE q record; v jsonb; x uuid; v_owner uuid; n int := 0;
BEGIN
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  FOR q IN SELECT * FROM sahl_import.fin_queue WHERE done_at IS NULL ORDER BY ord, id LIMIT p_n LOOP
    IF q.kind = 'recost' THEN
      v := public.recost_product_sales(q.refs, '2026-01-01 00:00+02');
    ELSIF q.kind = 'ledger' THEN
      FOREACH x IN ARRAY q.refs LOOP PERFORM public.ledger_sync_safe(x, NULL, 'sahl_import'); END LOOP;
      v := jsonb_build_object('contacts', cardinality(q.refs));
    ELSIF q.kind = 'walkin' THEN
      FOREACH x IN ARRAY q.refs LOOP PERFORM public.ledger_sync_safe(NULL, x, 'sahl_import'); END LOOP;
      v := jsonb_build_object('invoices', cardinality(q.refs));
    ELSIF q.kind = 'cost_price' THEN
      UPDATE public.products p SET cost_price = round(p.avg_cost, 2)
       WHERE p.tenant_id = q.refs[1] AND coalesce(p.avg_cost, 0) > 0 AND p.cost_price IS DISTINCT FROM round(p.avg_cost, 2);
      GET DIAGNOSTICS n = ROW_COUNT;
      v := jsonb_build_object('products', n);
    END IF;
    UPDATE sahl_import.fin_queue SET done_at = now(), res = v WHERE id = q.id;
  END LOOP;
  RETURN jsonb_build_object('left', (SELECT count(*) FROM sahl_import.fin_queue WHERE done_at IS NULL));
END
$$;
