-- إعادة بناء دالة apply_supplier_credit لتتوافق مع الهيكل الحديث للأرصدة
-- الهدف: إزالة الاعتماد على العمود المحذوف contacts.balance والاعتماد على رصيد الدائن المخزن credit_balance
-- مع عزل المستأجر والصلاحيات ومنع التسجيل المحاسبي المزدوج.

DROP FUNCTION IF EXISTS public.apply_supplier_credit(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.apply_supplier_credit(
  p_contact_id uuid,
  p_payment_plan_id uuid,
  p_branch_id uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_contact_type text;
  v_credit numeric;
  v_remaining numeric;
  v_apply numeric;
  v_plan_total numeric;
  v_plan_paid numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  -- عزل المستأجر: جهة الاتصال + التحقق من عدم تعليق الشركة
  SELECT tenant_id, type, COALESCE(credit_balance, 0)
    INTO v_tenant, v_contact_type, v_credit
  FROM public.contacts
  WHERE id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود';
  END IF;

  IF v_contact_type <> 'supplier' THEN
    RAISE EXCEPTION 'جهة الاتصال ليست مورداً';
  END IF;

  PERFORM public.assert_same_tenant(v_tenant);

  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;

  -- التحقق من أن الفرع ينتمي لنفس المستأجر
  PERFORM 1 FROM public.branches
  WHERE id = p_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفرع لا ينتمي لنفس الشركة';
  END IF;

  -- الصلاحيات: المالك/السوبر أدمن/المدير العام، أو مستخدم مرتبط بالفرع ولديه صلاحية shipments.create
  IF NOT (
    public.is_super_admin(v_uid)
    OR public.is_admin(v_uid)
    OR (
      public.user_in_branch(v_uid, p_branch_id)
      AND public.has_permission(v_uid, 'shipments.create')
    )
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تطبيق رصيد المورد';
  END IF;

  IF v_credit <= 0 THEN
    RETURN 0;
  END IF;

  -- قفل خطة الدفع والتحقق من أنها تخص نفس المورد/المستأجر
  SELECT total_amount, COALESCE(paid_amount, 0)
    INTO v_plan_total, v_plan_paid
  FROM public.payment_plans
  WHERE id = p_payment_plan_id
    AND tenant_id = v_tenant
    AND entity_type = 'supplier'
    AND entity_id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'خطة الدفع غير موجودة أو لا تخص هذا المورد';
  END IF;

  v_remaining := GREATEST(v_plan_total - v_plan_paid, 0);
  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  v_apply := LEAST(v_credit, v_remaining);
  IF v_apply <= 0 THEN
    RETURN 0;
  END IF;

  -- تسجيل معاملة تسوية اصطناعية (بدون تأثير على الخزينة/النقدية)
  -- طريقة 'settlement' مستبعدة من إجمالي المدفوع النقدي في v_contact_balances،
  -- مما يمنع التسجيل المحاسبي المزدوج عند خصم credit_balance.
  INSERT INTO public.payment_transactions(
    tenant_id, branch_id, payment_plan_id, installment_id, direction,
    amount, payment_method, fee_amount, total_with_fee,
    created_by, contact_id
  ) VALUES (
    v_tenant, p_branch_id, p_payment_plan_id, NULL, 'out',
    v_apply, 'settlement', 0, v_apply,
    v_uid, p_contact_id
  );

  -- تحديث خطة الدفع
  UPDATE public.payment_plans SET
    paid_amount = COALESCE(paid_amount, 0) + v_apply,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount, 0) + v_apply), 0),
    status = CASE
      WHEN total_amount - (COALESCE(paid_amount, 0) + v_apply) <= 0 THEN 'settled'
      ELSE status
    END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  -- خصم الرصيد الدائن المخزن في contacts (المصدر الوحيد للائتمان المتاح)
  UPDATE public.contacts
  SET credit_balance = COALESCE(credit_balance, 0) - v_apply
  WHERE id = p_contact_id;

  RETURN v_apply;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_supplier_credit(uuid, uuid, uuid) TO authenticated;