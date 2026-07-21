
-- 1) Tag journal entries with an optional branch
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_je_branch ON public.journal_entries(branch_id);

-- 2) Allocations table
CREATE TABLE IF NOT EXISTS public.branch_capital_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  amount numeric(18,2) NOT NULL CHECK (amount <> 0),
  allocation_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_capital_allocations TO authenticated;
GRANT ALL ON public.branch_capital_allocations TO service_role;

ALTER TABLE public.branch_capital_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read tenant branch allocations"
  ON public.branch_capital_allocations FOR SELECT
  USING (tenant_id = current_tenant_id());

CREATE POLICY "Admins manage branch allocations"
  ON public.branch_capital_allocations FOR ALL
  USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'accountant')))
  WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'accountant')));

CREATE INDEX IF NOT EXISTS idx_bca_tenant_branch ON public.branch_capital_allocations(tenant_id, branch_id);

CREATE TRIGGER trg_bca_updated
  BEFORE UPDATE ON public.branch_capital_allocations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ledger();

-- 3) RPC: allocate capital to a branch (tracking record only, no JE — capital already exists at company level)
CREATE OR REPLACE FUNCTION public.allocate_capital_to_branch(
  _branch_id uuid,
  _amount numeric,
  _allocation_date date DEFAULT CURRENT_DATE,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _id uuid;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.branches WHERE id = _branch_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF _tenant <> current_tenant_id() THEN RAISE EXCEPTION 'Branch not in tenant'; END IF;
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'accountant')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.branch_capital_allocations(tenant_id, branch_id, amount, allocation_date, notes, created_by)
  VALUES (_tenant, _branch_id, _amount, _allocation_date, _notes, auth.uid())
  RETURNING id INTO _id;

  RETURN _id;
END; $$;

-- 4) RPC: financial position per branch
CREATE OR REPLACE FUNCTION public.get_branch_financial_position(
  _branch_id uuid,
  _from date DEFAULT NULL,
  _to date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _allocated numeric := 0;
  _revenue numeric := 0;
  _cogs numeric := 0;
  _expenses numeric := 0;
  _receivables numeric := 0;
  _payables numeric := 0;
  _inventory_value numeric := 0;
  _treasury_cash numeric := 0;
  _net_profit numeric := 0;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.branches WHERE id = _branch_id;
  IF _tenant IS NULL OR _tenant <> current_tenant_id() THEN
    RAISE EXCEPTION 'Branch not accessible';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO _allocated
  FROM public.branch_capital_allocations
  WHERE tenant_id = _tenant AND branch_id = _branch_id
    AND (_to IS NULL OR allocation_date <= _to);

  -- Revenue from sales invoices
  SELECT COALESCE(SUM(total),0) INTO _revenue
  FROM public.invoices
  WHERE tenant_id = _tenant AND branch_id = _branch_id
    AND type = 'sale' AND status <> 'cancelled'
    AND (_from IS NULL OR invoice_date >= _from)
    AND (_to   IS NULL OR invoice_date <= _to);

  -- COGS via invoice_items (cost * qty for sale invoices)
  SELECT COALESCE(SUM(ii.quantity * COALESCE(ii.unit_cost,0)),0) INTO _cogs
  FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  WHERE i.tenant_id = _tenant AND i.branch_id = _branch_id
    AND i.type = 'sale' AND i.status <> 'cancelled'
    AND (_from IS NULL OR i.invoice_date >= _from)
    AND (_to   IS NULL OR i.invoice_date <= _to);

  -- Operating expenses (branch-tagged)
  SELECT COALESCE(SUM(amount),0) INTO _expenses
  FROM public.expenses
  WHERE tenant_id = _tenant AND branch_id = _branch_id
    AND (_from IS NULL OR expense_date >= _from)
    AND (_to   IS NULL OR expense_date <= _to);

  -- Receivables (unpaid sale invoice balances at branch)
  SELECT COALESCE(SUM(GREATEST(total - COALESCE(paid_amount,0),0)),0) INTO _receivables
  FROM public.invoices
  WHERE tenant_id = _tenant AND branch_id = _branch_id
    AND type = 'sale' AND status <> 'cancelled';

  -- Payables (unpaid purchase invoice balances at branch)
  SELECT COALESCE(SUM(GREATEST(total - COALESCE(paid_amount,0),0)),0) INTO _payables
  FROM public.invoices
  WHERE tenant_id = _tenant AND branch_id = _branch_id
    AND type = 'purchase' AND status <> 'cancelled';

  -- Inventory value at branch (from product_batches)
  SELECT COALESCE(SUM(quantity * COALESCE(unit_cost,0)),0) INTO _inventory_value
  FROM public.product_batches
  WHERE tenant_id = _tenant AND branch_id = _branch_id;

  -- Treasury cash at branch
  SELECT COALESCE(SUM(
    CASE WHEN type IN ('deposit','opening','sale_payment','collection') THEN amount
         WHEN type IN ('withdrawal','expense','purchase_payment','transfer_out') THEN -amount
         ELSE amount END
  ),0) INTO _treasury_cash
  FROM public.treasury
  WHERE tenant_id = _tenant AND branch_id = _branch_id;

  _net_profit := _revenue - _cogs - _expenses;

  RETURN jsonb_build_object(
    'branch_id', _branch_id,
    'from', _from,
    'to', _to,
    'allocated_capital', _allocated,
    'revenue', _revenue,
    'cogs', _cogs,
    'gross_profit', _revenue - _cogs,
    'expenses', _expenses,
    'net_profit', _net_profit,
    'receivables', _receivables,
    'payables', _payables,
    'inventory_value', _inventory_value,
    'treasury_cash', _treasury_cash,
    'total_assets', _receivables + _inventory_value + _treasury_cash,
    'roi_pct', CASE WHEN _allocated > 0 THEN ROUND((_net_profit / _allocated) * 100, 2) ELSE NULL END
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.allocate_capital_to_branch(uuid,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_financial_position(uuid,date,date) TO authenticated;
