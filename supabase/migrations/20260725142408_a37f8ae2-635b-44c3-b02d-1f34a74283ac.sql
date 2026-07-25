
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.tenants t
SET owner_user_id = u.id
FROM auth.users u
WHERE lower(u.email) = 'an.ayoub98@gmail.com'
  AND t.owner_user_id IS NULL;

CREATE OR REPLACE FUNCTION public.is_owner(_user_id UUID, _tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = _tenant_id AND owner_user_id = _user_id
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_owner(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_fiscal_period(p_period_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_period public.fiscal_periods%ROWTYPE;
  v_tenant UUID;
  v_retained UUID;
  v_entry_id UUID;
  v_entry_number TEXT;
  v_total_revenue NUMERIC := 0;
  v_total_expense NUMERIC := 0;
  v_net_profit NUMERIC := 0;
  v_line_order INT := 0;
  v_uid UUID := auth.uid();
  v_days_after INT;
  v_is_year_end BOOLEAN;
  v_next_period_exists BOOLEAN;
  r RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'يجب إدخال سبب الإقفال (5 أحرف على الأقل)';
  END IF;

  SELECT * INTO v_period FROM public.fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF v_period.id IS NULL THEN RAISE EXCEPTION 'الفترة غير موجودة'; END IF;
  IF v_period.status = 'closed' THEN RAISE EXCEPTION 'الفترة مغلقة بالفعل'; END IF;
  v_tenant := v_period.tenant_id;

  IF NOT public.is_owner(v_uid, v_tenant) THEN
    RAISE EXCEPTION 'غير مصرح — فقط صاحب الشركة يمكنه إقفال الفترة';
  END IF;

  IF CURRENT_DATE <= v_period.period_end THEN
    RAISE EXCEPTION 'لا يمكن إقفال الفترة قبل انتهائها';
  END IF;

  v_days_after := (CURRENT_DATE - v_period.period_end);
  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_periods
    WHERE tenant_id = v_tenant AND period_start > v_period.period_end
  ) INTO v_next_period_exists;
  v_is_year_end := NOT v_next_period_exists;

  IF NOT v_is_year_end AND v_days_after > 14 THEN
    RAISE EXCEPTION 'انتهت فترة الإقفال (14 يوم) — تواصل مع الدعم';
  END IF;

  SELECT id INTO v_retained FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND code = '3800' LIMIT 1;
  IF v_retained IS NULL THEN RAISE EXCEPTION 'حساب الأرباح المحتجزة غير موجود'; END IF;

  v_entry_number := 'CLOSE-' || to_char(v_period.period_end, 'YYYYMMDD');
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (v_tenant, v_entry_number, v_period.period_end,
          'قيد إقفال الفترة ' || v_period.name || ' — ' || p_reason, 'fiscal_close', p_period_id, 'posted', 0, 0, v_uid)
  RETURNING id INTO v_entry_id;

  FOR r IN
    SELECT c.id AS account_id, COALESCE(SUM(l.credit - l.debit), 0) AS balance
    FROM public.chart_of_accounts c
    LEFT JOIN public.journal_entry_lines l ON l.account_id = c.id
    LEFT JOIN public.journal_entries j ON j.id = l.entry_id AND j.status = 'posted'
                                       AND j.entry_date BETWEEN v_period.period_start AND v_period.period_end
    WHERE c.tenant_id = v_tenant AND c.account_type = 'revenue'
    GROUP BY c.id
    HAVING COALESCE(SUM(l.credit - l.debit), 0) <> 0
  LOOP
    v_line_order := v_line_order + 1;
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_tenant, v_entry_id, r.account_id, r.balance, 0, 'إقفال إيرادات', v_line_order);
    v_total_revenue := v_total_revenue + r.balance;
  END LOOP;

  FOR r IN
    SELECT c.id AS account_id, COALESCE(SUM(l.debit - l.credit), 0) AS balance
    FROM public.chart_of_accounts c
    LEFT JOIN public.journal_entry_lines l ON l.account_id = c.id
    LEFT JOIN public.journal_entries j ON j.id = l.entry_id AND j.status = 'posted'
                                       AND j.entry_date BETWEEN v_period.period_start AND v_period.period_end
    WHERE c.tenant_id = v_tenant AND c.account_type = 'expense'
    GROUP BY c.id
    HAVING COALESCE(SUM(l.debit - l.credit), 0) <> 0
  LOOP
    v_line_order := v_line_order + 1;
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_tenant, v_entry_id, r.account_id, 0, r.balance, 'إقفال مصروفات', v_line_order);
    v_total_expense := v_total_expense + r.balance;
  END LOOP;

  v_net_profit := v_total_revenue - v_total_expense;

  v_line_order := v_line_order + 1;
  IF v_net_profit >= 0 THEN
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_tenant, v_entry_id, v_retained, 0, v_net_profit, 'صافي الربح للأرباح المحتجزة', v_line_order);
  ELSE
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_tenant, v_entry_id, v_retained, -v_net_profit, 0, 'صافي الخسارة من الأرباح المحتجزة', v_line_order);
  END IF;

  UPDATE public.journal_entries SET
    total_debit = v_total_revenue + GREATEST(-v_net_profit, 0),
    total_credit = v_total_expense + GREATEST(v_net_profit, 0)
  WHERE id = v_entry_id;

  UPDATE public.fiscal_periods SET
    status = 'closed', net_profit = v_net_profit, closing_entry_id = v_entry_id,
    closed_at = now(), closed_by = v_uid
  WHERE id = p_period_id;

  BEGIN
    INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, record_id, old_values, new_values)
    VALUES (v_tenant, v_uid, 'fiscal_period_closed', 'fiscal_periods', p_period_id,
      jsonb_build_object('status', 'open'),
      jsonb_build_object(
        'status', 'closed',
        'reason', p_reason,
        'net_profit', v_net_profit,
        'closing_entry_id', v_entry_id,
        'closed_at', now()
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'entry_id', v_entry_id, 'entry_number', v_entry_number,
    'total_revenue', v_total_revenue, 'total_expense', v_total_expense,
    'net_profit', v_net_profit,
    'is_year_end', v_is_year_end
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_fiscal_period(UUID, TEXT) TO authenticated;
