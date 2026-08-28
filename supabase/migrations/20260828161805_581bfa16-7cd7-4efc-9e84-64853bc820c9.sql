CREATE TABLE IF NOT EXISTS public.shift_cash_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  shift_id uuid NOT NULL REFERENCES public.cashier_shifts(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  from_cashier_id uuid NOT NULL,
  to_manager_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_cash_handovers_shift ON public.shift_cash_handovers(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_cash_handovers_branch ON public.shift_cash_handovers(branch_id, occurred_at DESC);

GRANT SELECT ON public.shift_cash_handovers TO authenticated;
GRANT ALL ON public.shift_cash_handovers TO service_role;

ALTER TABLE public.shift_cash_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read shift handovers"
ON public.shift_cash_handovers FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.set_shift_cash_handovers_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_shift_cash_handovers_updated_at ON public.shift_cash_handovers;
CREATE TRIGGER trg_shift_cash_handovers_updated_at
BEFORE UPDATE ON public.shift_cash_handovers
FOR EACH ROW EXECUTE FUNCTION public.set_shift_cash_handovers_updated_at();

CREATE OR REPLACE FUNCTION public.record_mid_shift_handover(
  p_shift_id uuid,
  p_manager_id uuid DEFAULT NULL,
  p_amount_received numeric DEFAULT 0,
  p_notes text DEFAULT NULL
)
RETURNS public.shift_cash_handovers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shift public.cashier_shifts;
  v_manager uuid := COALESCE(p_manager_id, auth.uid());
  v_row public.shift_cash_handovers;
  v_cashier_name text; v_manager_name text; v_branch_name text;
  v_admins uuid[];
BEGIN
  SELECT * INTO v_shift FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية غير موجودة'; END IF;
  IF v_shift.tenant_id <> public.current_tenant_id() THEN RAISE EXCEPTION 'غير مسموح'; END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'الوردية مقفولة — التسليم الطارئ للورديات المفتوحة فقط'; END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'super_admin')
    OR (public.has_role(auth.uid(), 'branch_manager') AND EXISTS (
          SELECT 1 FROM public.branch_users bu
          WHERE bu.user_id = auth.uid() AND bu.branch_id = v_shift.branch_id))
  ) THEN
    RAISE EXCEPTION 'مسموح لمدير الفرع أو الإدارة فقط بتسجيل تسليم العهدة';
  END IF;

  IF COALESCE(p_amount_received,0) < 0 THEN RAISE EXCEPTION 'المبلغ غير صحيح'; END IF;

  INSERT INTO public.shift_cash_handovers
    (tenant_id, shift_id, branch_id, from_cashier_id, to_manager_id, amount, notes, occurred_at, created_by)
  VALUES
    (v_shift.tenant_id, v_shift.id, v_shift.branch_id, v_shift.cashier_id, v_manager,
     COALESCE(p_amount_received,0), NULLIF(p_notes,''), now(), auth.uid())
  RETURNING * INTO v_row;

  SELECT name INTO v_cashier_name FROM public.profiles WHERE id = v_shift.cashier_id;
  SELECT name INTO v_manager_name FROM public.profiles WHERE id = v_manager;
  SELECT name INTO v_branch_name FROM public.branches WHERE id = v_shift.branch_id;

  SELECT COALESCE(array_agg(DISTINCT ur.user_id), '{}') INTO v_admins
  FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
  WHERE p.tenant_id = v_shift.tenant_id AND ur.role IN ('admin','owner');

  IF array_length(v_admins,1) IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
    SELECT u,
      'تنبيه طارئ: تسليم عهدة أثناء الوردية',
      'الكاشير ' || COALESCE(v_cashier_name,'—') || ' غادر فرع ' || COALESCE(v_branch_name,'—') ||
      ' في تمام الساعة ' || to_char(v_row.occurred_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI:SS') ||
      '، وقام مدير الفرع ' || COALESCE(v_manager_name,'—') || ' باستلام عهدة بقيمة ' ||
      to_char(v_row.amount, 'FM999999990.00') || ' جنيه، والوردية مستمرة برقم ' || v_shift.id::text ||
      COALESCE(' — ملاحظات: ' || v_row.notes, ''),
      'general',
      '/branch/' || v_shift.branch_id::text || '/shifts/close',
      'cashier_shifts', v_shift.id
    FROM unnest(v_admins) AS u;
  END IF;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.record_mid_shift_handover(uuid, uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_mid_shift_handover(uuid, uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.shift_handovers(p_shift_id uuid)
RETURNS TABLE(
  id uuid, shift_id uuid, amount numeric, notes text, occurred_at timestamptz,
  from_cashier_id uuid, cashier_name text, to_manager_id uuid, manager_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.id, h.shift_id, h.amount, h.notes, h.occurred_at,
         h.from_cashier_id, pc.name, h.to_manager_id, pm.name
  FROM public.shift_cash_handovers h
  LEFT JOIN public.profiles pc ON pc.id = h.from_cashier_id
  LEFT JOIN public.profiles pm ON pm.id = h.to_manager_id
  WHERE h.shift_id = p_shift_id
    AND h.tenant_id = public.current_tenant_id()
  ORDER BY h.occurred_at ASC;
$$;

REVOKE ALL ON FUNCTION public.shift_handovers(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shift_handovers(uuid) TO authenticated;