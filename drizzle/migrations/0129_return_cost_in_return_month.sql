-- 0129: the cost of goods a customer returns comes back in the RETURN's month, next to its money (owner «نفذ», 2026-10-28)
--
-- The cost of a sale was taken on the invoice day for the quantity NOT returned (net_quantity), while the return's
-- money was taken on the return day: SR00083 (بوتاجاز بوش on IN04796 of 2/3, returned 23/5, 20,332) made March
-- 16,350 too profitable and May 20,332 too poor — in the books (COGS-IN04796) and on the card «هل بنكسب؟».
-- Now, for 2026 invoices (archive invoices keep their 2025 books — 0069):
--   * the invoice's COGS entry is for the full quantity sold, on the invoice day (post_invoice_cogs);
--   * the return's own entry adds Dr 1300 Inventory / Cr 5100 COGS for the returned pieces at the cost they left with,
--     on the return day (sync_sale_return_journal) — a cancelled return removes it with the rest (0130: on its day);
--   * owner_business_snapshot takes the cost of the full quantity in the invoice's period and gives back the returned
--     cost in the return's period.
-- Totals over any period that holds both days do not change; only the month each part lands in.

CREATE OR REPLACE FUNCTION public.sale_return_cost(p_return_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- the returned pieces at the cost they left with on their invoice (quantity-weighted when the product has several lines)
  SELECT COALESCE(round(sum(ri.quantity * c.unit_cost), 2), 0)
    FROM public.returns r
    JOIN public.return_items ri ON ri.return_id = r.id AND ri.product_id IS NOT NULL
    JOIN LATERAL (
      SELECT sum(COALESCE(NULLIF(ii.unit_cost_at_sale, 0), NULLIF(ii.cost_price, 0), 0) * ii.quantity) / NULLIF(sum(ii.quantity), 0) AS unit_cost
        FROM public.invoice_items ii
       WHERE ii.invoice_id = r.invoice_id AND ii.product_id = ri.product_id
    ) c ON true
   WHERE r.id = p_return_id AND r.invoice_id IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.post_invoice_cogs(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv RECORD;
  v_cogs_total numeric := 0;
  v_cogs_acct uuid;
  v_inv_acct uuid;
  v_entry_id uuid;
  v_entry_no text;
  v_existing uuid;
  v_archive boolean;
BEGIN
  SELECT i.id, i.tenant_id, i.branch_id, i.invoice_number, (coalesce(i.invoice_date, i.created_at) AT TIME ZONE 'Africa/Cairo')::date AS entry_date, i.status,
         public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id) AS archive
    INTO inv
    FROM public.invoices i
    WHERE i.id = p_invoice_id;

  IF NOT FOUND OR inv.status <> 'active' THEN
    RETURN;
  END IF;
  v_archive := inv.archive;

  -- 0129: 2026 invoices carry the cost of the full quantity; returned pieces come back on the return's own entry
  SELECT COALESCE(SUM(
           COALESCE(NULLIF(unit_cost_at_sale, 0), NULLIF(cost_price, 0), 0)
           * CASE WHEN v_archive THEN COALESCE(net_quantity, quantity - COALESCE(returned_quantity, 0)) ELSE quantity END
         ), 0)
    INTO v_cogs_total
    FROM public.invoice_items
    WHERE invoice_id = inv.id;

  SELECT id INTO v_cogs_acct FROM public.chart_of_accounts
    WHERE tenant_id = inv.tenant_id AND code = '5100' LIMIT 1;
  SELECT id INTO v_inv_acct FROM public.chart_of_accounts
    WHERE tenant_id = inv.tenant_id AND code = '1300' LIMIT 1;

  IF v_cogs_acct IS NULL OR v_inv_acct IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_existing FROM public.journal_entries
    WHERE source_type = 'invoice_cogs' AND source_id = inv.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entry_lines WHERE entry_id = v_existing;
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF v_cogs_total <= 0 THEN
    RETURN;
  END IF;

  v_entry_no := 'COGS-' || inv.invoice_number;

  INSERT INTO public.journal_entries (tenant_id, branch_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit)
  VALUES (inv.tenant_id, inv.branch_id, v_entry_no, inv.entry_date,
          'تكلفة بضاعة مباعة — فاتورة ' || inv.invoice_number,
          'invoice_cogs', inv.id, 'posted', v_cogs_total, v_cogs_total)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES
    (inv.tenant_id, v_entry_id, v_cogs_acct, v_cogs_total, 0, 'COGS — ' || inv.invoice_number, 1),
    (inv.tenant_id, v_entry_id, v_inv_acct, 0, v_cogs_total, 'Inventory out — ' || inv.invoice_number, 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_sale_return_journal(p_return_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_existing uuid;
  v_cash numeric(18,2);
  v_balance numeric(18,2);
  v_lines jsonb;
  v_cost numeric(18,2) := 0;
BEGIN
  SELECT rt.id, rt.tenant_id, rt.return_number, rt.status, rt.total_refund, rt.invoice_date, rt.created_at, rt.invoice_id,
         COALESCE(rt.refund_cash_amount,0) AS cash_amt,
         COALESCE(rt.refund_transfer_amount,0) AS transfer_amt,
         COALESCE(rt.refund_balance_amount,0) AS balance_amt
    INTO r FROM public.returns rt WHERE rt.id = p_return_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_existing FROM public.journal_entries
   WHERE source_type = 'sale_return' AND source_id = r.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF r.status IS DISTINCT FROM 'active' OR COALESCE(r.total_refund,0) <= 0 THEN RETURN; END IF;

  v_cash := r.cash_amt + r.transfer_amt;
  v_balance := r.balance_amt;
  IF v_cash + v_balance <> r.total_refund THEN
    v_cash := 0;
    v_balance := r.total_refund;
  END IF;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','4100','debit',r.total_refund,'credit',0,'description','مرتجع مبيعات '||r.return_number)
  );
  IF v_cash > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',0,'credit',v_cash,'description','مرتجع مبيعات '||r.return_number||' — نقدي'));
  END IF;
  IF v_balance > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1200','debit',0,'credit',v_balance,'description','مرتجع مبيعات '||r.return_number||' — رصيد العميل'));
  END IF;

  -- 0129: the returned pieces' cost comes back on the return day (2026 invoices; archive invoices net it in 2025)
  IF r.invoice_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.invoices i WHERE i.id = r.invoice_id
          AND public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)) THEN
    v_cost := public.sale_return_cost(r.id);
    IF v_cost > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code','1300','debit',v_cost,'credit',0,'description','رجوع البضاعة للمخزن — '||r.return_number),
        jsonb_build_object('account_code','5100','debit',0,'credit',v_cost,'description','تكلفة المرتجع — '||r.return_number));
    END IF;
  END IF;

  PERFORM public.post_journal(
    r.tenant_id,
    COALESCE(r.invoice_date, r.created_at)::date,
    'مرتجع مبيعات '||r.return_number,
    'sale_return',
    r.id,
    v_lines
  );
END $function$;

CREATE OR REPLACE FUNCTION public.owner_business_snapshot(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_read_company_report(ARRAY['part.admin_home.business_snapshot.view', 'admin_reports_profitability.view']) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  WITH b AS (SELECT id, name FROM public.branches WHERE tenant_id = v_t AND coalesce(is_system, false) = false),
  inv AS (
    SELECT i.branch_id, sum(i.total) AS sales, count(*) AS n, sum(coalesce(public.ledger_doc_open('invoice', i.id), 0)) AS open_credit
      FROM public.invoices i
     WHERE i.tenant_id = v_t AND i.status = 'active'
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     GROUP BY 1),
  -- 0129: 2026 invoices carry the full quantity's cost; what comes back is given back in the return's period (retcost)
  cogs AS (
    SELECT i.branch_id,
           sum(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0)
               * CASE WHEN public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
                      THEN coalesce(ii.net_quantity, ii.quantity - coalesce(ii.returned_quantity, 0)) ELSE ii.quantity END) AS cogs
      FROM public.invoices i JOIN public.invoice_items ii ON ii.invoice_id = i.id
     WHERE i.tenant_id = v_t AND i.status = 'active'
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     GROUP BY 1),
  retcost AS (
    SELECT r.branch_id, sum(public.sale_return_cost(r.id)) AS cost_back
      FROM public.returns r JOIN public.invoices i ON i.id = r.invoice_id
     WHERE r.tenant_id = v_t AND coalesce(r.status, 'active') = 'active'
       AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
       AND (coalesce(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     GROUP BY 1),
  ret AS (
    SELECT r.branch_id, sum(r.total_refund) AS returns
      FROM public.returns r
     WHERE r.tenant_id = v_t AND coalesce(r.status, 'active') = 'active'
       AND (coalesce(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     GROUP BY 1),
  exp AS (
    SELECT v.branch_id, sum(v.amount) AS expenses
      FROM public.vouchers v JOIN public.voucher_categories c ON c.id = v.category_id
     WHERE v.tenant_id = v_t AND v.type = 'payment' AND v.status = 'active' AND c.is_deductible_from_profit
       AND v.voucher_date BETWEEN p_from AND p_to
     GROUP BY 1),
  money AS (
    SELECT m.branch_id, sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END) AS collected
      FROM public.money_movements m
     WHERE m.tenant_id = v_t AND m.side = 'customer' AND m.is_cash AND m.status = 'active'
       AND m.movement_date BETWEEN p_from AND p_to
     GROUP BY 1),
  stock AS (
    SELECT p.branch_id,
           sum(greatest(p.quantity, 0) * coalesce(p.avg_cost, p.cost_price, 0)) AS value,
           sum(greatest(p.quantity, 0)) AS qty,
           count(*) FILTER (WHERE p.quantity > 0) AS items
      FROM public.products p
     WHERE p.tenant_id = v_t AND p.archived_at IS NULL
     GROUP BY 1),
  short AS (
    SELECT p.branch_id, sum(-p.quantity * coalesce(p.avg_cost, p.cost_price, 0)) AS owed
      FROM public.products p WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND p.quantity < 0 GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object(
           'branch_id', b.id, 'branch', b.name,
           'invoices', coalesce(inv.n, 0),
           'sales', round(coalesce(inv.sales, 0), 2),
           'returns', round(coalesce(ret.returns, 0), 2),
           'net_sales', round(coalesce(inv.sales, 0) - coalesce(ret.returns, 0), 2),
           'collected', round(coalesce(money.collected, 0), 2),
           'open_credit', round(coalesce(inv.open_credit, 0), 2),
           'cogs', round(coalesce(cogs.cogs, 0) - coalesce(retcost.cost_back, 0), 2),
           'gross_profit', round(coalesce(inv.sales, 0) - coalesce(ret.returns, 0) - (coalesce(cogs.cogs, 0) - coalesce(retcost.cost_back, 0)), 2),
           'expenses', round(coalesce(exp.expenses, 0), 2),
           'net_profit', round(coalesce(inv.sales, 0) - coalesce(ret.returns, 0) - (coalesce(cogs.cogs, 0) - coalesce(retcost.cost_back, 0)) - coalesce(exp.expenses, 0), 2),
           'stock_value', round(coalesce(stock.value, 0) - coalesce(short.owed, 0), 2),
           'stock_qty', coalesce(stock.qty, 0),
           'stock_items', coalesce(stock.items, 0),
           'sold_ahead_of_stock', round(coalesce(short.owed, 0), 2)
         ) ORDER BY b.name)
    INTO v_rows
    FROM b LEFT JOIN inv ON inv.branch_id = b.id LEFT JOIN cogs ON cogs.branch_id = b.id LEFT JOIN ret ON ret.branch_id = b.id
           LEFT JOIN retcost ON retcost.branch_id = b.id
           LEFT JOIN exp ON exp.branch_id = b.id LEFT JOIN money ON money.branch_id = b.id
           LEFT JOIN stock ON stock.branch_id = b.id LEFT JOIN short ON short.branch_id = b.id;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'branches', coalesce(v_rows, '[]'::jsonb),
    'total', (SELECT jsonb_build_object(
       'sales', sum((x->>'sales')::numeric), 'returns', sum((x->>'returns')::numeric), 'net_sales', sum((x->>'net_sales')::numeric),
       'collected', sum((x->>'collected')::numeric), 'open_credit', sum((x->>'open_credit')::numeric),
       'cogs', sum((x->>'cogs')::numeric), 'gross_profit', sum((x->>'gross_profit')::numeric), 'expenses', sum((x->>'expenses')::numeric),
       'net_profit', sum((x->>'net_profit')::numeric), 'stock_value', sum((x->>'stock_value')::numeric),
       'stock_qty', sum((x->>'stock_qty')::numeric), 'invoices', sum((x->>'invoices')::numeric))
     FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x));
END $function$;

-- re-post: the COGS of every 2026 invoice that has returns (full quantity), then every active return of one
DO $mig$
DECLARE x record;
BEGIN
  FOR x IN SELECT DISTINCT i.id FROM public.invoices i JOIN public.invoice_items ii ON ii.invoice_id = i.id
            WHERE i.status = 'active' AND COALESCE(ii.returned_quantity, 0) > 0
              AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id) LOOP
    PERFORM public.post_invoice_cogs(x.id);
  END LOOP;
  FOR x IN SELECT r.id FROM public.returns r JOIN public.invoices i ON i.id = r.invoice_id
            WHERE COALESCE(r.status, 'active') = 'active'
              AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id) LOOP
    PERFORM public.sync_sale_return_journal(x.id);
  END LOOP;
END
$mig$;
