-- 1) Signed delta on the prepaid ledger: contacts.credit_balance = Σ balance_delta
ALTER TABLE public.customer_credit_log ADD COLUMN IF NOT EXISTS balance_delta numeric;
COMMENT ON COLUMN public.customer_credit_log.balance_delta IS 'Signed contribution to contacts.credit_balance (same sign as v_contact_balances.total_balance). Customer prepaid: added=-amount, used=+amount. Supplier advance: added=+amount, used=-amount.';
UPDATE public.customer_credit_log SET balance_delta = CASE WHEN type = 'credit_added' THEN -amount ELSE amount END WHERE balance_delta IS NULL;

CREATE OR REPLACE FUNCTION public.credit_log_fill_delta()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.balance_delta IS NULL THEN
    IF NEW.type = 'credit_added' THEN NEW.balance_delta := -NEW.amount;
    ELSIF NEW.type = 'credit_used' THEN NEW.balance_delta := NEW.amount;
    ELSE RAISE EXCEPTION 'نوع حركة الرصيد المسبق غير معروف: %', NEW.type;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_credit_log_fill_delta ON public.customer_credit_log;
CREATE TRIGGER trg_credit_log_fill_delta BEFORE INSERT OR UPDATE ON public.customer_credit_log
  FOR EACH ROW EXECUTE FUNCTION public.credit_log_fill_delta();

CREATE OR REPLACE FUNCTION public.recompute_contact_credit(p_contact_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v numeric;
BEGIN
  SELECT COALESCE(SUM(balance_delta), 0) INTO v FROM public.customer_credit_log WHERE contact_id = p_contact_id;
  PERFORM set_config('app.credit_sync', '1', true);
  UPDATE public.contacts SET credit_balance = v WHERE id = p_contact_id AND COALESCE(credit_balance, 0) IS DISTINCT FROM v;
  PERFORM set_config('app.credit_sync', '0', true);
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.recompute_contact_credit(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.credit_log_sync_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN PERFORM public.recompute_contact_credit(NEW.contact_id); END IF;
  IF TG_OP IN ('DELETE','UPDATE') AND (TG_OP = 'DELETE' OR OLD.contact_id IS DISTINCT FROM NEW.contact_id) THEN
    PERFORM public.recompute_contact_credit(OLD.contact_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_credit_log_sync_contact ON public.customer_credit_log;
CREATE TRIGGER trg_credit_log_sync_contact AFTER INSERT OR UPDATE OR DELETE ON public.customer_credit_log
  FOR EACH ROW EXECUTE FUNCTION public.credit_log_sync_contact();

-- 2) Block every direct write to contacts.credit_balance
CREATE OR REPLACE FUNCTION public.guard_contact_credit_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.credit_balance IS DISTINCT FROM OLD.credit_balance
     AND COALESCE(current_setting('app.credit_sync', true), '') <> '1' THEN
    RAISE EXCEPTION 'الرصيد المسبق يُحسب فقط من سجل حركات الرصيد (customer_credit_log) — التعديل المباشر ممنوع';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_contact_credit_balance ON public.contacts;
CREATE TRIGGER trg_guard_contact_credit_balance BEFORE UPDATE OF credit_balance ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_contact_credit_balance();
COMMENT ON COLUMN public.contacts.credit_balance IS 'DERIVED cache = Σ customer_credit_log.balance_delta. Written only by recompute_contact_credit().';

REVOKE INSERT, UPDATE, DELETE ON public.customer_credit_log FROM anon, authenticated;

-- 3) Remove scattered direct updates from existing functions
DO $do$
DECLARE d text; n text;
  PROCEDURE_NOOP int;
BEGIN
  -- create_contact_credit_deposit
  d := pg_get_functiondef('public.create_contact_credit_deposit'::regproc);
  n := replace(d, E'  UPDATE public.contacts\n  SET credit_balance = COALESCE(credit_balance, 0) - p_amount\n  WHERE id = p_contact_id;\n', '');
  IF n = d THEN RAISE EXCEPTION 'patch failed: create_contact_credit_deposit'; END IF;
  EXECUTE n;

  -- process_sale_full
  d := pg_get_functiondef('public.process_sale_full'::regproc);
  n := replace(d, E'UPDATE contacts SET credit_balance = LEAST(0, v_credit + p_credit_to_apply),\n           refund_status', 'UPDATE contacts SET refund_status');
  IF n = d THEN RAISE EXCEPTION 'patch failed: process_sale_full'; END IF;
  EXECUTE n;

  -- cancel_invoice_with_refund__impl (also fixes the wrong sign: log type credit_added now yields -amount)
  d := pg_get_functiondef('public.cancel_invoice_with_refund__impl'::regproc);
  n := replace(d, 'UPDATE contacts SET credit_balance = COALESCE(credit_balance,0) + v_paid, refund_status = ''credit_added''', 'UPDATE contacts SET refund_status = ''credit_added''');
  IF n = d THEN RAISE EXCEPTION 'patch failed: cancel_invoice_with_refund__impl'; END IF;
  EXECUTE n;

  -- apply_customer_credit → ledger row
  d := pg_get_functiondef('public.apply_customer_credit'::regproc);
  n := replace(d, E'    UPDATE public.contacts\n    SET credit_balance = COALESCE(credit_balance, 0) + v_applied\n    WHERE id = p_contact_id;',
    E'    INSERT INTO public.customer_credit_log (tenant_id, contact_id, invoice_id, amount, type, notes, created_by)\n    VALUES (v_tenant, p_contact_id, p_invoice_id, v_applied, ''credit_used'', ''تطبيق الرصيد المسبق على فواتير العميل'', v_uid);');
  IF n = d THEN RAISE EXCEPTION 'patch failed: apply_customer_credit'; END IF;
  EXECUTE n;

  -- settle_contact_invoices_sovereign surplus → ledger row
  d := pg_get_functiondef('public.settle_contact_invoices_sovereign'::regproc);
  n := replace(d, E'    UPDATE public.contacts\n    SET credit_balance = COALESCE(credit_balance, 0) - v_surplus\n    WHERE id = p_contact_id;',
    E'    INSERT INTO public.customer_credit_log (tenant_id, contact_id, amount, type, notes, created_by)\n    VALUES (v_tenant, p_contact_id, v_surplus, ''credit_added'', ''فائض سداد — رصيد مسبق للجهة'', v_uid);');
  IF n = d THEN RAISE EXCEPTION 'patch failed: settle_contact_invoices_sovereign'; END IF;
  EXECUTE n;

  -- admin_reset_go_live_extras: ledger delete already recomputes the cache to 0
  d := pg_get_functiondef('public.admin_reset_go_live_extras'::regproc);
  n := replace(d, 'SET credit_balance = 0, opening_balance = 0', 'SET opening_balance = 0');
  IF n = d THEN RAISE EXCEPTION 'patch failed: admin_reset_go_live_extras'; END IF;
  EXECUTE n;
END $do$;

-- 4) Supplier advance application (ledger-based, no treasury, no cash journal)
CREATE OR REPLACE FUNCTION public.apply_supplier_credit(p_contact_id uuid, p_payment_plan_id uuid, p_branch_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_tenant uuid; v_type text; v_credit numeric;
  v_total numeric; v_paid numeric; v_remaining numeric; v_apply numeric; v_ref uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id, type INTO v_tenant, v_type FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير موجود'; END IF;
  IF v_type NOT IN ('supplier','both') THEN RAISE EXCEPTION 'جهة الاتصال ليست مورداً'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;
  PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفرع لا ينتمي لنفس الشركة'; END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_admin(v_uid)
          OR (public.user_in_branch(v_uid, p_branch_id) AND public.has_permission(v_uid, 'shipments.create'))) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تطبيق رصيد المورد';
  END IF;
  -- Mixed (customer+supplier) contacts share one balance; auto-netting them is forbidden.
  IF v_type <> 'supplier' THEN RETURN 0; END IF;

  v_credit := GREATEST(public.recompute_contact_credit(p_contact_id), 0); -- supplier advance = positive
  IF v_credit <= 0 THEN RETURN 0; END IF;

  SELECT total_amount, COALESCE(paid_amount,0), reference_id INTO v_total, v_paid, v_ref
  FROM public.payment_plans
  WHERE id = p_payment_plan_id AND tenant_id = v_tenant AND entity_type = 'supplier' AND entity_id = p_contact_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'خطة الدفع غير موجودة أو لا تخص هذا المورد'; END IF;
  v_remaining := GREATEST(v_total - v_paid, 0);
  v_apply := LEAST(v_credit, v_remaining);
  IF v_apply <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.payment_transactions(tenant_id, branch_id, payment_plan_id, installment_id, direction,
    amount, payment_method, fee_amount, total_with_fee, created_by, contact_id)
  VALUES (v_tenant, p_branch_id, p_payment_plan_id, NULL, 'out', v_apply, 'credit_balance', 0, v_apply, v_uid, p_contact_id);

  UPDATE public.payment_plans SET
    paid_amount = COALESCE(paid_amount,0) + v_apply,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount,0) + v_apply), 0),
    status = CASE WHEN total_amount - (COALESCE(paid_amount,0) + v_apply) <= 0 THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  -- Ledger effect: supplier debt reduced, advance consumed → total balance unchanged, no cash.
  PERFORM set_config('app.skip_journal', '1', true);
  INSERT INTO public.supplier_payments(tenant_id, contact_id, branch_id, amount, notes, paid_by)
  VALUES (v_tenant, p_contact_id, p_branch_id, v_apply, 'خصم من الرصيد المسبق لدى المورد (بدون حركة خزينة)', v_uid);
  PERFORM set_config('app.skip_journal', '0', true);

  INSERT INTO public.customer_credit_log(tenant_id, contact_id, amount, type, balance_delta, notes, created_by)
  VALUES (v_tenant, p_contact_id, v_apply, 'credit_used', -v_apply, 'خصم رصيد مسبق على فاتورة شراء', v_uid);

  RETURN v_apply;
END $$;

-- 5) Atomic purchase invoice + payment plan header + supplier credit deduction
CREATE OR REPLACE FUNCTION public.record_shipment_with_credit(p_header jsonb, p_lines jsonb, p_plan jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_branch uuid := (p_header->>'branch_id')::uuid;
  v_contact uuid := NULLIF(p_header->>'contact_id','')::uuid;
  v_res jsonb; v_ship uuid; v_total numeric; v_plan uuid; v_tenant uuid; v_name text;
  v_paid_now numeric := GREATEST(COALESCE((p_plan->>'paid_now')::numeric, 0), 0);
  v_applied numeric := 0; v_after numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'branch_id required'; END IF;
  IF v_contact IS NULL THEN RAISE EXCEPTION 'المورد مطلوب'; END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_admin(v_uid)
          OR (public.user_in_branch(v_uid, v_branch) AND public.has_permission(v_uid, 'shipments.create'))) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تسجيل فاتورة شراء في هذا الفرع';
  END IF;

  v_res := public.record_shipment(p_header, p_lines, NULL);
  v_ship := (v_res->>'shipment_id')::uuid;
  v_total := (v_res->>'total_cost')::numeric;

  IF NULLIF(p_header->>'invoice_date','') IS NOT NULL THEN
    UPDATE public.shipments SET invoice_date = (p_header->>'invoice_date')::date WHERE id = v_ship;
  END IF;

  SELECT tenant_id, name INTO v_tenant, v_name FROM public.contacts WHERE id = v_contact;

  INSERT INTO public.payment_plans(tenant_id, branch_id, entity_type, entity_id, entity_name,
    total_amount, paid_amount, remaining_amount, plan_type, reference_type, reference_id,
    fee_on_customer, status, created_by)
  VALUES (v_tenant, v_branch, 'supplier', v_contact, COALESCE(v_name, 'مورد'),
    v_total, 0, v_total, COALESCE(NULLIF(p_plan->>'plan_type',''), 'open'), 'shipment', v_ship,
    false, 'active', v_uid)
  RETURNING id INTO v_plan;

  -- Credit covers only what the explicit payments of this invoice leave unpaid.
  IF COALESCE((p_plan->>'apply_credit')::boolean, true) AND v_total - v_paid_now > 0.005 THEN
    -- temporarily reserve the planned payments so the advance never over-covers the invoice
    UPDATE public.payment_plans SET paid_amount = LEAST(v_paid_now, v_total) WHERE id = v_plan;
    v_applied := public.apply_supplier_credit(v_contact, v_plan, v_branch);
    UPDATE public.payment_plans
       SET paid_amount = v_applied,
           remaining_amount = GREATEST(total_amount - v_applied, 0),
           status = CASE WHEN total_amount - v_applied <= 0 THEN 'settled' ELSE 'active' END
     WHERE id = v_plan;
    IF v_applied > 0 THEN
      UPDATE public.shipments
         SET notes = CONCAT_WS(' — ', NULLIF(notes,''), 'تم خصم ' || to_char(v_applied, 'FM999,999,990.00') || ' ج من الرصيد المسبق لدى المورد')
       WHERE id = v_ship;
    END IF;
  END IF;

  RETURN v_res || jsonb_build_object('payment_plan_id', v_plan, 'credit_applied', v_applied);
END $$;
REVOKE ALL ON FUNCTION public.record_shipment_with_credit(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_shipment_with_credit(jsonb, jsonb, jsonb) TO authenticated;

-- 6) Stored supplier balance snapshots are retired (computed from the ledger at display time)
COMMENT ON COLUMN public.shipments.previous_balance IS 'DEPRECATED: supplier balance is computed from the contact ledger at display time';
COMMENT ON COLUMN public.shipments.current_balance IS 'DEPRECATED: supplier balance is computed from the contact ledger at display time';
