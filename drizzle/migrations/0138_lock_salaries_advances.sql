-- 0138: salaries, employee advances and profit distributions are cancel-only (owner «نفذ», 2026-10-30)
--
-- The browser could INSERT / UPDATE / DELETE `salaries`, `advances`, `advance_payments`, `profit_distributions` and
-- `profit_distribution_lines` directly (table grants + «admin» RLS). Example: a salary of 8,000 paid in October could
-- be changed to 6,000 or deleted from the API; the voucher, the till and the journal kept 8,000.
-- Now: no direct writes (only the server functions: pay / cancel salary, disburse / cancel advance, distribute /
-- reverse distribution), no hard delete, and a new `cancel_employee_advance` that cancels the disbursement on its own
-- day (voucher «ملغي» + till reversal + journal reversal, like every voucher cancel since 0084).
-- A wrong salary / advance is corrected by cancel + a new one. Partner movements follow in 0137 (same-day edit).

ALTER TABLE public.advances
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE OR REPLACE FUNCTION public.cancel_employee_advance(p_advance_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); a public.advances%ROWTYPE; v_emp record; r record; n int := 0;
BEGIN
  IF v_uid IS NULL OR NOT (public.is_admin(v_uid) OR public.is_owner(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'إلغاء السلفة للمالك والمدير بس' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  SELECT * INTO a FROM public.advances WHERE id = p_advance_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السلفة غير موجودة'; END IF;
  IF a.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_uid) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF a.status = 'cancelled' THEN RAISE EXCEPTION 'السلفة ملغية قبل كده'; END IF;
  IF EXISTS (SELECT 1 FROM public.advance_payments p WHERE p.advance_id = a.id)
     OR round(coalesce(a.remaining, 0), 2) < round(coalesce(a.amount, 0), 2) THEN
    RAISE EXCEPTION 'السلفة اتخصم منها من المرتب — الغي المرتب الأول وبعدين السلفة';
  END IF;
  SELECT id, branch_id, name INTO v_emp FROM public.employees WHERE id = a.employee_id;
  PERFORM public.assert_access(v_emp.branch_id, 'advances.update');

  -- the disbursement and its fee are cancelled on THEIR day (voucher «ملغي», till reversal, journal reversal)
  FOR r IN SELECT t.id FROM public.treasury t
            WHERE t.reference_id = a.id AND t.category IN ('advance', 'transfer_fee') AND t.type = 'expense'
            ORDER BY t.created_at LOOP
    PERFORM public.till_cancel_on_original_date(r.id, 'إلغاء سلفة ' || coalesce(v_emp.name, '') || ' — ' || p_reason);
    n := n + 1;
  END LOOP;

  UPDATE public.advances
     SET status = 'cancelled', remaining = 0, cancelled_at = now(), cancelled_by = v_uid, cancel_reason = p_reason
   WHERE id = a.id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity, entity_id, details, tenant_id)
  VALUES (v_uid, (SELECT coalesce(name, username) FROM public.profiles WHERE id = v_uid), 'cancel', 'advance', a.id,
          jsonb_build_object('employee', v_emp.name, 'amount', a.amount, 'reason', p_reason, 'till_rows_cancelled', n), a.tenant_id);

  RETURN jsonb_build_object('advance_id', a.id, 'amount', a.amount, 'till_rows_cancelled', n);
END $function$;
REVOKE ALL ON FUNCTION public.cancel_employee_advance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_employee_advance(uuid, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('cancel_employee_advance', '0138', 'owner: an employee advance is cancelled (on its own day), never edited or deleted')
ON CONFLICT DO NOTHING;

-- no direct writes from the browser; the server functions above are SECURITY DEFINER
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.salaries, public.advances, public.advance_payments,
  public.profit_distributions, public.profit_distribution_lines FROM authenticated, anon;

-- no hard delete (branch reset / go-live set app.allow_hard_delete)
DO $mig$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['salaries', 'advances', 'advance_payments', 'profit_distributions', 'profit_distribution_lines'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_block_hard_delete' AND tgrelid = format('public.%I', t)::regclass) THEN
      EXECUTE format('CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete()', t);
    END IF;
  END LOOP;
END
$mig$;
