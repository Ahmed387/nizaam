-- 0156: «وضع الاستيراد» for the one-time go-live import of the 2026 files of the old program «سهل» (owner 2026-11-05
-- «نفذها بالكامل وارفع الكل», «مش معايا: ارفع بالسالب»). The import runs ONLY from the database console (session user
-- postgres, never the API's `authenticator`), with `app.sahl_import = '1'` set for its own transaction, through the
-- normal RPCs (process_sale_full, record_shipment_with_credit, create_manual_voucher, …) as the owner. In that mode:
--   * the till may go below zero (`check_treasury_balance`) — the owner has no till balances of 31/12/2025 yet;
--   * a receipt from a supplier is accepted (`guard_voucher_receipt_party`) — owner decision: a receipt from an account
--     that mostly sells to us is on his supplier side and raises what we owe him (the ledger already reads it so);
--   * a return keeps the old program's own split (debt / cash / transfer) and day, given in `app.sahl_split`
--     (`allocate_sale_return_settlement`, `allocate_purchase_return_settlement`) — the till must match «سهل»;
--   * a sale below the product's cost price is accepted (`process_sale`) — the old program sold some so;
--   * a purchase return may take stock below zero (`apply_purchase_return_item`) and keep its old price
--     (`guard_purchase_return_item_value`) — as the old program did;
--   * the per-line moving-average replays (`avg_cost_refresh_trg`, `invoice_item_avg_cost_trg`) and the owner's
--     «مرتجع جديد» notifications (`notify_owner_new_return`) wait: the import re-costs every sale once at the end
--     (`recost_product_sales`) — 20,000 lines each replaying the product's history would take hours.
-- Outside that mode nothing changes. Two real fixes ride along (they also concern the «الأرصدة الافتتاحية» screen):
--   * `product_cost_ledger` reads opening stock posted by `post_opening_balances` (batch_type 'opening'), not only
--     'opening_stock' — before, such stock never entered the moving average;
--   * `post_opening_balances` dates its opening stock batches on the opening day (`effective_at`), not on the moment
--     it was posted — before, the opening came after every sale of the year in the cost replay.
CREATE OR REPLACE FUNCTION public.sahl_import_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(current_setting('app.sahl_import', true), '') = '1'
     AND session_user NOT IN ('authenticator', 'anon', 'authenticated', 'service_role')
$$;

CREATE OR REPLACE FUNCTION sahl_import._patch(p_fn regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE d text := pg_get_functiondef(p_fn); n int;
BEGIN
  IF position(p_new IN d) > 0 THEN RETURN; END IF;     -- already patched
  n := (length(d) - length(replace(d, p_old, ''))) / length(p_old);
  IF n <> 1 THEN RAISE EXCEPTION '0156: % — anchor found % times', p_fn, n; END IF;
  EXECUTE replace(d, p_old, p_new);
END;
$$;

DO $mig$
DECLARE
  v_skip_new  text := E'BEGIN\n  IF public.sahl_import_mode() THEN RETURN NEW; END IF;  -- 0156 import mode\n';
  v_skip_null text := E'BEGIN\n  IF public.sahl_import_mode() THEN RETURN NULL; END IF;  -- 0156 import mode\n';
  v_split text := E'BEGIN\n'
    '  -- 0156 import mode: the old program''s own split and day\n'
    '  IF public.sahl_import_mode() AND nullif(current_setting(''app.sahl_split'', true), '''') IS NOT NULL THEN\n'
    '    NEW.status := ''active'';\n'
    '    NEW.refund_balance_amount := round(coalesce((current_setting(''app.sahl_split'')::jsonb->>''balance'')::numeric, 0), 2);\n'
    '    NEW.refund_cash_amount := round(coalesce((current_setting(''app.sahl_split'')::jsonb->>''cash'')::numeric, 0), 2);\n'
    '    NEW.refund_transfer_amount := round(coalesce((current_setting(''app.sahl_split'')::jsonb->>''transfer'')::numeric, 0), 2);\n'
    '    NEW.refund_method := coalesce(nullif(current_setting(''app.sahl_split'')::jsonb->>''method'', ''''), NEW.refund_method);\n'
    '    IF current_setting(''app.sahl_split'')::jsonb ? ''at'' THEN\n'
    '      NEW.invoice_date := (current_setting(''app.sahl_split'')::jsonb->>''at'')::timestamptz;\n'
    '    END IF;\n'
    '    RETURN NEW;\n'
    '  END IF;\n';
BEGIN
  -- BEFORE triggers: let the row through
  PERFORM sahl_import._patch('public.check_treasury_balance()'::regprocedure, E'BEGIN\n  IF NEW.category', v_skip_new || E'  IF NEW.category');
  PERFORM sahl_import._patch('public.guard_voucher_receipt_party()'::regprocedure, E'BEGIN\n  IF NEW.type', v_skip_new || E'  IF NEW.type');
  PERFORM sahl_import._patch('public.invoice_item_avg_cost_trg()'::regprocedure, E'BEGIN\n  SELECT coalesce(invoice_date', v_skip_new || E'  SELECT coalesce(invoice_date');
  PERFORM sahl_import._patch('public.guard_purchase_return_item_value()'::regprocedure, E'BEGIN\n  SELECT shipment_id', v_skip_new || E'  SELECT shipment_id');
  -- AFTER triggers: nothing to do now
  PERFORM sahl_import._patch('public.avg_cost_refresh_trg()'::regprocedure, E'BEGIN\n  IF TG_TABLE_NAME = ''stock_transfers''', v_skip_null || E'  IF TG_TABLE_NAME = ''stock_transfers''');
  PERFORM sahl_import._patch('public.notify_owner_new_return()'::regprocedure, E'BEGIN\n  IF TG_TABLE_NAME = ''returns''', v_skip_null || E'  IF TG_TABLE_NAME = ''returns''');
  -- returns: the old split
  PERFORM sahl_import._patch('public.allocate_sale_return_settlement()'::regprocedure, E'BEGIN\n  IF COALESCE(NEW.status, ''active'') = ''draft'' THEN NEW.status := ''active''; END IF;',
    v_split || E'  IF COALESCE(NEW.status, ''active'') = ''draft'' THEN NEW.status := ''active''; END IF;');
  PERFORM sahl_import._patch('public.allocate_purchase_return_settlement()'::regprocedure, E'BEGIN\n  IF COALESCE(NEW.status, ''active'') = ''draft'' THEN\n',
    v_split || E'  IF COALESCE(NEW.status, ''active'') = ''draft'' THEN\n');
  -- sale below cost, purchase return below zero
  PERFORM sahl_import._patch('public.process_sale(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date)'::regprocedure,
    E'    IF v_cp > 0 THEN\n      v_eff_unit', E'    IF v_cp > 0 AND NOT public.sahl_import_mode() THEN  -- 0156\n      v_eff_unit');
  PERFORM sahl_import._patch('public.apply_purchase_return_item()'::regprocedure,
    'SET quantity = GREATEST(0, quantity - NEW.quantity)',
    'SET quantity = CASE WHEN public.sahl_import_mode() THEN quantity - NEW.quantity ELSE GREATEST(0, quantity - NEW.quantity) END  /* 0156 */');
  -- real fixes: opening stock in the moving average, on its own day
  PERFORM sahl_import._patch('public.product_cost_ledger(uuid,timestamptz,uuid)'::regprocedure,
    'b.batch_type IN (''opening_stock'', ''prior_year_return'')', 'b.batch_type IN (''opening_stock'', ''opening'', ''prior_year_return'')');
  PERFORM sahl_import._patch('public.post_opening_balances(date,jsonb,jsonb,jsonb)'::regprocedure,
    E'cost_price, base_purchase_price, shipping_cost_per_unit, true_unit_cost, batch_type)\n        VALUES (v_tenant, v_pbranch, v_pid, v_qty, v_qty, v_cost, v_cost, 0, v_cost, ''opening'');',
    E'cost_price, base_purchase_price, shipping_cost_per_unit, true_unit_cost, batch_type, effective_at)\n        VALUES (v_tenant, v_pbranch, v_pid, v_qty, v_qty, v_cost, v_cost, 0, v_cost, ''opening'',\n                (p_date + time ''00:00'') AT TIME ZONE ''Africa/Cairo'');  -- 0156: on the opening day');
END
$mig$;
