-- 1) Reason becomes mandatory on void
CREATE OR REPLACE FUNCTION public.void_payment_transaction(p_tx_id uuid, p_reason text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res uuid;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب (5 أحرف على الأقل)';
  END IF;
  SELECT public._void_payment_transaction_exec(p_tx_id, btrim(p_reason)) INTO v_res;
  RETURN v_res;
END;
$function$;

-- 2) Request void: cashier -> approval request, manager/admin/owner -> immediate
CREATE OR REPLACE FUNCTION public.request_void_payment_transaction(p_tx_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tx record;
  v_plan record;
  v_name text;
  v_req_id uuid;
  v_privileged boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب (5 أحرف على الأقل)';
  END IF;

  SELECT * INTO v_tx FROM public.payment_transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF v_tx.tenant_id <> public.current_tenant_id() THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF v_tx.voided_at IS NOT NULL THEN RAISE EXCEPTION 'transaction already voided'; END IF;

  SELECT * INTO v_plan FROM public.payment_plans WHERE id = v_tx.payment_plan_id;

  v_privileged := public.is_admin(v_uid)
    OR public.is_owner(v_uid)
    OR public.is_super_admin(v_uid)
    OR public.has_role(v_uid, 'branch_manager'::app_role)
    OR public.has_role(v_uid, 'accountant'::app_role);

  IF v_privileged THEN
    PERFORM public.void_payment_transaction(p_tx_id, btrim(p_reason));
    RETURN jsonb_build_object('status', 'voided');
  END IF;

  -- already pending?
  IF EXISTS (
    SELECT 1 FROM public.approval_requests
    WHERE entity_type = 'payment_void' AND entity_id = p_tx_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('status', 'already_pending');
  END IF;

  SELECT name INTO v_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.approval_requests(
    tenant_id, branch_id, entity_type, entity_id, entity_label,
    action, payload, reason, requested_by, requested_by_name
  ) VALUES (
    v_tx.tenant_id, v_tx.branch_id, 'payment_void', p_tx_id,
    'إلغاء دفعة ' || to_char(v_tx.amount, 'FM999999990.00') || ' ج.م'
      || COALESCE(' — ' || v_plan.entity_name, ''),
    'delete'::approval_action,
    jsonb_build_object(
      'amount', v_tx.amount,
      'payment_method', v_tx.payment_method,
      'direction', v_tx.direction,
      'payment_plan_id', v_tx.payment_plan_id,
      'installment_id', v_tx.installment_id,
      'entity_name', v_plan.entity_name
    ),
    btrim(p_reason), v_uid, COALESCE(v_name, 'مستخدم')
  ) RETURNING id INTO v_req_id;

  RETURN jsonb_build_object('status', 'pending', 'request_id', v_req_id);
END;
$function$;

-- 3) Decide on a void request (branch manager / admin / owner)
CREATE OR REPLACE FUNCTION public.decide_payment_void_request(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_req FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_req.entity_type <> 'payment_void' THEN RAISE EXCEPTION 'not a void request'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'الطلب تم البت فيه بالفعل'; END IF;
  IF v_req.tenant_id <> public.current_tenant_id() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF v_req.requested_by = v_uid AND NOT (public.is_admin(v_uid) OR public.is_owner(v_uid)) THEN
    RAISE EXCEPTION 'مينفعش توافق على طلبك بنفسك';
  END IF;

  v_allowed := public.is_admin(v_uid)
    OR public.is_owner(v_uid)
    OR public.is_super_admin(v_uid)
    OR (public.has_role(v_uid, 'branch_manager'::app_role)
        AND (v_req.branch_id IS NULL OR public.user_in_branch(v_uid, v_req.branch_id)));

  IF NOT v_allowed THEN RAISE EXCEPTION 'مسموح لمدير الفرع أو الأدمن فقط'; END IF;

  IF p_approve THEN
    PERFORM public.void_payment_transaction(v_req.entity_id, v_req.reason);
  END IF;

  UPDATE public.approval_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END::approval_status,
      admin_id = v_uid,
      admin_note = p_note,
      decided_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END;
$function$;

-- 4) RLS: cashiers can create (via definer only), branch managers can read/decide their branch
DROP POLICY IF EXISTS "ar_read_branch_manager" ON public.approval_requests;
CREATE POLICY "ar_read_branch_manager" ON public.approval_requests
FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (public.is_owner(auth.uid())
       OR (public.has_role(auth.uid(), 'branch_manager'::app_role)
           AND branch_id IS NOT NULL
           AND public.user_in_branch(auth.uid(), branch_id)))
);