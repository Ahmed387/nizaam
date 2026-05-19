
-- 1) record_payment_transaction: atomically record a payment toward a plan/installment + treasury impact + fee as separate expense
CREATE OR REPLACE FUNCTION public.record_payment_transaction(
  p_payment_plan_id uuid,
  p_installment_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text,
  p_transfer_to_account text,
  p_received_by_name text,
  p_fee_amount numeric,
  p_fee_type text,
  p_fee_on_customer boolean,
  p_direction text  -- 'in' (we receive) or 'out' (we pay)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id uuid;
  v_treasury_id uuid;
  v_fee_treasury_id uuid;
  v_branch uuid;
  v_tenant uuid;
  v_plan record;
  v_installment record;
  v_total_with_fee numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF p_payment_plan_id IS NULL THEN RAISE EXCEPTION 'payment_plan_id required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;

  SELECT * INTO v_plan FROM payment_plans WHERE id = p_payment_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found'; END IF;
  v_branch := v_plan.branch_id;
  v_tenant := v_plan.tenant_id;

  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  -- Treasury entry for the principal
  INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_number, transfer_to_account, created_by, tenant_id)
  VALUES (
    v_branch,
    CASE WHEN p_direction='in' THEN 'income' ELSE 'expense' END,
    CASE WHEN p_direction='in' THEN 'payment_in' ELSE 'payment_out' END,
    p_amount,
    'دفعة خطة #' || substr(p_payment_plan_id::text,1,8) || ' — ' || v_plan.entity_name,
    p_payment_method,
    p_reference_number,
    p_transfer_to_account,
    v_uid,
    v_tenant
  ) RETURNING id INTO v_treasury_id;

  -- Fee as separate expense when company bears it OR always expense for outgoing payments
  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO expenses(branch_id, type, amount, description, date, payment_method, reference_number, is_fee, created_by, tenant_id)
    VALUES (
      v_branch, 'عمولة تحويل', p_fee_amount,
      'عمولة ' || p_payment_method || ' — دفعة خطة #' || substr(p_payment_plan_id::text,1,8),
      CURRENT_DATE, p_payment_method, p_reference_number, true, v_uid, v_tenant
    );
    INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'expense', 'fee', p_fee_amount, 'عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_tenant)
    RETURNING id INTO v_fee_treasury_id;
  END IF;

  -- Record transaction
  INSERT INTO payment_transactions(
    payment_plan_id, installment_id, branch_id, tenant_id,
    direction, amount, payment_method, fee_amount, fee_type, total_with_fee,
    reference_number, transfer_to_account, received_by_name,
    treasury_id, fee_treasury_id, created_by
  ) VALUES (
    p_payment_plan_id, p_installment_id, v_branch, v_tenant,
    p_direction, p_amount, p_payment_method, COALESCE(p_fee_amount,0), p_fee_type, v_total_with_fee,
    p_reference_number, p_transfer_to_account, p_received_by_name,
    v_treasury_id, v_fee_treasury_id, v_uid
  ) RETURNING id INTO v_tx_id;

  -- Update installment if provided
  IF p_installment_id IS NOT NULL THEN
    SELECT * INTO v_installment FROM payment_installments WHERE id = p_installment_id;
    UPDATE payment_installments SET
      paid_amount = COALESCE(paid_amount,0) + p_amount,
      paid_at = CASE WHEN COALESCE(paid_amount,0) + p_amount >= amount THEN now() ELSE paid_at END,
      status = CASE WHEN COALESCE(paid_amount,0) + p_amount >= amount THEN 'paid' ELSE 'pending' END,
      updated_at = now()
    WHERE id = p_installment_id;
  END IF;

  -- Update plan totals
  UPDATE payment_plans SET
    paid_amount = COALESCE(paid_amount,0) + p_amount,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount,0) + p_amount), 0),
    status = CASE WHEN total_amount - (COALESCE(paid_amount,0) + p_amount) <= 0 THEN 'completed' ELSE status END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  RETURN v_tx_id;
END $$;

-- 2) Mark overdue installments and notify admins (idempotent — only notify once per day)
CREATE OR REPLACE FUNCTION public.mark_overdue_installments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
  v_admin uuid;
BEGIN
  UPDATE payment_installments
    SET status = 'overdue', updated_at = now()
  WHERE status = 'pending'
    AND due_date < CURRENT_DATE
    AND paid_amount < amount;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Notify admins per tenant about overdue counts
  FOR r IN
    SELECT pp.tenant_id, COUNT(pi.id) AS overdue_count, SUM(pi.amount - pi.paid_amount) AS total_due
    FROM payment_installments pi
    JOIN payment_plans pp ON pp.id = pi.payment_plan_id
    WHERE pi.status = 'overdue'
    GROUP BY pp.tenant_id
  LOOP
    FOR v_admin IN
      SELECT ur.user_id FROM user_roles ur
      JOIN profiles p ON p.id = ur.user_id
      WHERE ur.role = 'admin' AND p.tenant_id = r.tenant_id
    LOOP
      -- avoid duplicate same-day notification
      IF NOT EXISTS (
        SELECT 1 FROM notifications
        WHERE user_id = v_admin AND type = 'overdue_installments'
          AND created_at::date = CURRENT_DATE
      ) THEN
        INSERT INTO notifications(user_id, tenant_id, type, title, body, link)
        VALUES (
          v_admin, r.tenant_id, 'overdue_installments',
          'أقساط متأخرة',
          'يوجد ' || r.overdue_count || ' قسط متأخر بإجمالي ' || ROUND(r.total_due,2) || ' جنيه',
          '/admin/receivables'
        );
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END $$;

-- 3) Payment plans summary for receivables report
CREATE OR REPLACE FUNCTION public.payment_plans_summary(p_tenant_id uuid)
RETURNS TABLE(
  entity_type text,
  total_owed numeric,
  overdue_amount numeric,
  due_this_week numeric,
  due_this_month numeric,
  plans_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pp.entity_type,
    COALESCE(SUM(pp.remaining_amount),0) AS total_owed,
    COALESCE(SUM(CASE WHEN pi.status='overdue' THEN pi.amount - pi.paid_amount END),0) AS overdue_amount,
    COALESCE(SUM(CASE WHEN pi.status='pending' AND pi.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 THEN pi.amount - pi.paid_amount END),0) AS due_this_week,
    COALESCE(SUM(CASE WHEN pi.status IN ('pending','overdue') AND pi.due_date <= date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day' THEN pi.amount - pi.paid_amount END),0) AS due_this_month,
    COUNT(DISTINCT pp.id) AS plans_count
  FROM payment_plans pp
  LEFT JOIN payment_installments pi ON pi.payment_plan_id = pp.id
  WHERE pp.tenant_id = p_tenant_id AND pp.status = 'active'
  GROUP BY pp.entity_type;
$$;

-- Add missing column to treasury for fee flag if not exists
ALTER TABLE public.treasury ADD COLUMN IF NOT EXISTS is_fee boolean NOT NULL DEFAULT false;
