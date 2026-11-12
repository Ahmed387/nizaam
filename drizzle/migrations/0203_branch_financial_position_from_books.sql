-- 0203: owner 2026-11-12 «في كل فرع هل في كارت يقولي البضاعة المتاحة بكام واللي اتباعت بكام وصافي التكلفة والربح الصافي واللي
-- لينا عند الموردين كام». The card exists («رأس مال الفروع» → get_branch_financial_position) but the function still read
-- columns of an old schema (invoices.type, expenses, product_batches.unit_cost) and failed on every call, so the page was
-- empty. Rewritten on today's sources, same keys + three new ones:
--   revenue / cogs / expenses / net_profit = profit_statement_core (the books) for the period (default: from 2026-01-01);
--   receivables / payables               = open balances of the two sides at the branch (ledger_side_balances);
--   supplier_advances («لينا عند الموردين») / customer_advances = the advances of the two sides;
--   inventory_value                      = Σ quantity × moving-average cost of the branch's items (negative quantities = 0);
--   treasury_cash                        = get_branch_wallet_balances.total_balance (cash + wallets).
-- Reads only.
CREATE OR REPLACE FUNCTION public.get_branch_financial_position(_branch_id uuid, _from date DEFAULT NULL, _to date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid; _allocated numeric := 0; _ps jsonb; _t jsonb;
  _receivables numeric := 0; _payables numeric := 0; _sup_adv numeric := 0; _cus_adv numeric := 0;
  _inventory numeric := 0; _cash numeric := 0; _net numeric := 0;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.branches WHERE id = _branch_id;
  IF _tenant IS NULL OR _tenant <> public.current_tenant_id() THEN RAISE EXCEPTION 'Branch not accessible'; END IF;
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'المركز المالي للفرع للإدارة فقط' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO _allocated FROM public.branch_capital_allocations
   WHERE tenant_id = _tenant AND branch_id = _branch_id AND (_to IS NULL OR allocation_date <= _to);

  _ps := public.profit_statement_core(_tenant, COALESCE(_from, DATE '2026-01-01'), COALESCE(_to, CURRENT_DATE), _branch_id);
  _t := COALESCE(_ps->'total', '{}'::jsonb);
  _net := COALESCE((_t->>'net_profit')::numeric, 0);

  SELECT COALESCE(SUM(sb.open_remaining) FILTER (WHERE sb.side = 'customer'), 0), COALESCE(SUM(sb.open_remaining) FILTER (WHERE sb.side = 'supplier'), 0),
         COALESCE(SUM(sb.advance) FILTER (WHERE sb.side = 'supplier'), 0), COALESCE(SUM(sb.advance) FILTER (WHERE sb.side = 'customer'), 0)
    INTO _receivables, _payables, _sup_adv, _cus_adv
    FROM public.ledger_side_balances(_tenant, _branch_id, NULL) sb;

  SELECT COALESCE(SUM(GREATEST(p.quantity, 0) * COALESCE(NULLIF(p.avg_cost, 0), p.cost_price, 0)), 0) INTO _inventory
    FROM public.products p WHERE p.tenant_id = _tenant AND p.branch_id = _branch_id AND p.archived_at IS NULL;

  SELECT COALESCE(w.total_balance, 0) INTO _cash FROM public.get_branch_wallet_balances(_branch_id) w;

  RETURN jsonb_build_object(
    'branch_id', _branch_id, 'from', COALESCE(_from, DATE '2026-01-01'), 'to', _to,
    'allocated_capital', _allocated,
    'revenue', COALESCE((_t->>'net_sales')::numeric, 0),
    'cogs', COALESCE((_t->>'cogs')::numeric, 0),
    'gross_profit', COALESCE((_t->>'gross_profit')::numeric, 0),
    'expenses', COALESCE((_t->>'expenses')::numeric, 0),
    'other_income', COALESCE((_t->>'other_income')::numeric, 0),
    'net_profit', _net,
    'receivables', round(_receivables, 2), 'payables', round(_payables, 2),
    'supplier_advances', round(_sup_adv, 2), 'customer_advances', round(_cus_adv, 2),
    'inventory_value', round(_inventory, 2), 'treasury_cash', round(COALESCE(_cash, 0), 2),
    'total_assets', round(_receivables + _sup_adv + _inventory + COALESCE(_cash, 0), 2),
    'roi_pct', CASE WHEN _allocated > 0 THEN ROUND((_net / _allocated) * 100, 2) ELSE NULL END);
END; $function$;
