
-- ============ 1. Table ============
CREATE TABLE IF NOT EXISTS public.cashier_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  cashier_id UUID NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_cash NUMERIC(14,2),
  expected_cash NUMERIC(14,2),
  cash_sales NUMERIC(14,2),
  variance NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','auto_closed')),
  open_notes TEXT,
  close_notes TEXT,
  closed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only ONE open shift per cashier per branch
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_shifts_open
  ON public.cashier_shifts (branch_id, cashier_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS ix_cashier_shifts_branch_status
  ON public.cashier_shifts (branch_id, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS ix_cashier_shifts_tenant
  ON public.cashier_shifts (tenant_id, opened_at DESC);

-- ============ 2. Grants ============
GRANT SELECT, INSERT, UPDATE ON public.cashier_shifts TO authenticated;
GRANT ALL ON public.cashier_shifts TO service_role;

-- ============ 3. RLS ============
ALTER TABLE public.cashier_shifts ENABLE ROW LEVEL SECURITY;

-- Cashier: own shifts. Admin/supervisor/owner: full tenant.
CREATE POLICY "shifts_select" ON public.cashier_shifts FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id() AND (
    cashier_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'accountant')
  )
);

CREATE POLICY "shifts_insert" ON public.cashier_shifts FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND cashier_id = auth.uid()
);

CREATE POLICY "shifts_update" ON public.cashier_shifts FOR UPDATE TO authenticated
USING (
  tenant_id = public.current_tenant_id() AND (
    cashier_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

-- ============ 4. updated_at trigger ============
CREATE OR REPLACE FUNCTION public.tg_cashier_shifts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cashier_shifts_updated_at ON public.cashier_shifts;
CREATE TRIGGER trg_cashier_shifts_updated_at
BEFORE UPDATE ON public.cashier_shifts
FOR EACH ROW EXECUTE FUNCTION public.tg_cashier_shifts_updated_at();

-- ============ 5. Helpers ============

-- Get the currently open shift for the caller in a branch (or NULL).
CREATE OR REPLACE FUNCTION public.get_open_shift(p_branch_id UUID)
RETURNS public.cashier_shifts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.cashier_shifts
  WHERE branch_id = p_branch_id
    AND cashier_id = auth.uid()
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;
$$;

-- Open a new shift. Fails if one is already open for this cashier/branch.
CREATE OR REPLACE FUNCTION public.open_cashier_shift(
  p_branch_id UUID,
  p_opening_cash NUMERIC,
  p_notes TEXT DEFAULT NULL
) RETURNS public.cashier_shifts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_row public.cashier_shifts;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'الفرع غير موجود';
  END IF;
  IF v_tenant <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح: الفرع خارج شركتك';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cashier_shifts
    WHERE branch_id = p_branch_id AND cashier_id = auth.uid() AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'لديك وردية مفتوحة بالفعل في هذا الفرع';
  END IF;

  INSERT INTO public.cashier_shifts (
    tenant_id, branch_id, cashier_id, opening_cash, open_notes
  ) VALUES (
    v_tenant, p_branch_id, auth.uid(), COALESCE(p_opening_cash,0), p_notes
  ) RETURNING * INTO v_row;

  RETURN v_row;
END $$;

-- Compute cash sales for a shift window (cash + fawry paid to the cashier).
-- Uses invoice_payments (payment_method IN ('cash')) within shift range.
CREATE OR REPLACE FUNCTION public.shift_cash_sales(p_shift_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT branch_id, cashier_id, opened_at, COALESCE(closed_at, now()) AS closed_at
    FROM public.cashier_shifts WHERE id = p_shift_id
  )
  SELECT COALESCE(SUM(ip.amount),0)::NUMERIC
  FROM public.invoice_payments ip
  JOIN public.invoices inv ON inv.id = ip.invoice_id
  JOIN s ON true
  WHERE inv.branch_id  = s.branch_id
    AND inv.cashier_id = s.cashier_id
    AND ip.payment_method = 'cash'
    AND ip.voided_at IS NULL
    AND ip.created_at >= s.opened_at
    AND ip.created_at <  s.closed_at;
$$;

-- Close a shift with the physical count.
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id UUID,
  p_closing_cash NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_auto BOOLEAN DEFAULT false
) RETURNS public.cashier_shifts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.cashier_shifts;
  v_cash NUMERIC;
  v_expected NUMERIC;
BEGIN
  SELECT * INTO v_row FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية غير موجودة'; END IF;
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'الوردية مغلقة بالفعل'; END IF;
  IF v_row.tenant_id <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح';
  END IF;
  IF NOT p_auto
     AND v_row.cashier_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'مسموح فقط لصاحب الوردية أو الأدمن';
  END IF;

  v_cash := public.shift_cash_sales(p_shift_id);
  v_expected := COALESCE(v_row.opening_cash,0) + COALESCE(v_cash,0);

  UPDATE public.cashier_shifts SET
    closed_at     = now(),
    closing_cash  = COALESCE(p_closing_cash,0),
    cash_sales    = v_cash,
    expected_cash = v_expected,
    variance      = COALESCE(p_closing_cash,0) - v_expected,
    close_notes   = p_notes,
    closed_by     = auth.uid(),
    status        = CASE WHEN p_auto THEN 'auto_closed' ELSE 'closed' END
  WHERE id = p_shift_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.get_open_shift(UUID)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cashier_shift(UUID,NUMERIC,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shift_cash_sales(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cashier_shift(UUID,NUMERIC,TEXT,BOOLEAN) TO authenticated;
