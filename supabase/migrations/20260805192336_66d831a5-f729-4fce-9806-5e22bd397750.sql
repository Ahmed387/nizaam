ALTER TABLE public.treasury_transfers ADD COLUMN IF NOT EXISTS dest_credited_at timestamptz;

UPDATE public.treasury_transfers
   SET dest_credited_at = created_at
 WHERE dest_credited_at IS NULL AND rejected_at IS NULL;

CREATE OR REPLACE FUNCTION public.transfer_treasury_atomic(
  p_from_branch uuid,
  p_to_branch uuid,
  p_amount numeric,
  p_reason text,
  p_payment_method text DEFAULT 'cash'::text,
  p_fee_amount numeric DEFAULT 0,
  p_reference_number text DEFAULT NULL::text,
  p_transfer_to_account text DEFAULT NULL::text,
  p_fee_actually_charged boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_transfer_id uuid;
  v_wallet_balance numeric;
  v_fee numeric := COALESCE(p_fee_amount, 0);
  v_fee_charged boolean := COALESCE(p_fee_actually_charged, true);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;
  IF p_from_branch = p_to_branch THEN RAISE EXCEPTION 'مينفعش تحوّل لنفس الفرع'; END IF;
  IF p_payment_method NOT IN ('cash','vodafone','instapay','bank') THEN RAISE EXCEPTION 'طريقة دفع غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO v_wallet_balance
    FROM public.treasury
    WHERE branch_id = p_from_branch AND payment_method = p_payment_method;

  IF v_wallet_balance < (p_amount + CASE WHEN v_fee_charged THEN v_fee ELSE 0 END) THEN
    RAISE EXCEPTION 'رصيد وعاء % غير كافٍ — المتاح: % ج.م', p_payment_method, v_wallet_balance;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;

  INSERT INTO public.treasury_transfers(
    from_branch_id, to_branch_id, amount, reason, transferred_by, tenant_id,
    payment_method, fee_amount, reference_number, transfer_to_account, fee_actually_charged
  ) VALUES (
    p_from_branch, p_to_branch, p_amount, p_reason, v_user, v_tenant,
    p_payment_method, v_fee, p_reference_number, p_transfer_to_account, v_fee_charged
  ) RETURNING id INTO v_transfer_id;

  -- الفرع المرسل: الفلوس بتخرج فورًا
  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_number, transfer_to_account, reference_id)
  VALUES (p_from_branch, 'expense', 'transfer', p_amount,
          'تحويل لفرع: ' || COALESCE(p_reason, ''), v_user, v_tenant,
          p_payment_method, p_reference_number, p_transfer_to_account, v_transfer_id);

  -- العمولة تتسجل مصروف بس لو فعلاً اتخصمت
  IF v_fee > 0 AND v_fee_charged THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, is_fee, reference_number, reference_id)
    VALUES (p_from_branch, 'expense', 'transfer_fee', v_fee,
            'عمولة تحويل (' || p_payment_method || ')', v_user, v_tenant,
            p_payment_method, true, p_reference_number, v_transfer_id);
  END IF;

  -- الفرع المستلم: مفيش إضافة لحد ما يأكد الاستلام
  RETURN v_transfer_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.acknowledge_treasury_transfer__impl(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_tr record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v_tr FROM public.treasury_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF v_tr IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF NOT (is_admin(v_user) OR user_in_branch(v_user, v_tr.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تأكيد هذا التحويل';
  END IF;
  IF v_tr.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'التحويل مرفوض بالفعل'; END IF;
  IF v_tr.acknowledged_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.treasury_transfers
    SET acknowledged_at = now(), acknowledged_by = v_user
    WHERE id = p_transfer_id;

  -- إضافة الفلوس لخزنة الفرع المستلم عند التأكيد (لو لسه مضافتش)
  IF v_tr.dest_credited_at IS NULL THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_number, reference_id)
    VALUES (v_tr.to_branch_id, 'income', 'transfer', v_tr.amount,
            'تحويل وارد: ' || COALESCE(v_tr.reason, ''), v_user, v_tr.tenant_id,
            COALESCE(v_tr.payment_method,'cash'), v_tr.reference_number, v_tr.id);

    UPDATE public.treasury_transfers SET dest_credited_at = now() WHERE id = p_transfer_id;
  END IF;

  INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
  SELECT bu.user_id, v_tr.tenant_id,
         '✅ تأكيد استلام تحويل',
         'تم تأكيد استلام التحويل بقيمة ' || v_tr.amount || ' ج.م',
         'general', 'treasury_transfer', v_tr.id,
         '/branch/' || v_tr.from_branch_id || '/treasury'
  FROM public.branch_users bu
  JOIN public.user_roles ur ON ur.user_id = bu.user_id
  WHERE bu.branch_id = v_tr.from_branch_id AND ur.role = 'branch_manager';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reject_treasury_transfer__impl(p_transfer_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_tr record;
  v_refund numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v_tr FROM public.treasury_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF v_tr IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF v_tr.acknowledged_at IS NOT NULL THEN RAISE EXCEPTION 'تم تأكيد التحويل بالفعل'; END IF;
  IF v_tr.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'تم رفض التحويل بالفعل'; END IF;
  IF NOT (is_admin(v_user) OR user_in_branch(v_user, v_tr.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية رفض هذا التحويل';
  END IF;

  UPDATE public.treasury_transfers
    SET rejected_at = now(), rejected_by = v_user, rejection_reason = p_reason
    WHERE id = p_transfer_id;

  -- العمولة: لو اتخصمت فعلاً تفضل مصروف، لو لأ ترجع مع المبلغ
  v_refund := v_tr.amount + CASE WHEN COALESCE(v_tr.fee_actually_charged, true) THEN 0 ELSE COALESCE(v_tr.fee_amount, 0) END;

  -- لو الفلوس كانت اتضافت للفرع المستلم (تحويلات قديمة) لازم تتسحب منه
  IF v_tr.dest_credited_at IS NOT NULL THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id)
    VALUES (v_tr.to_branch_id, 'expense', 'transfer_refund', v_refund,
            'رفض تحويل: ' || COALESCE(p_reason,''), v_user, v_tr.tenant_id,
            COALESCE(v_tr.payment_method,'cash'), v_tr.id);

    UPDATE public.treasury_transfers SET dest_credited_at = NULL WHERE id = p_transfer_id;
  END IF;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id)
  VALUES (v_tr.from_branch_id, 'income', 'transfer_refund', v_refund,
          'استرداد تحويل مرفوض' || CASE WHEN NOT COALESCE(v_tr.fee_actually_charged, true) AND COALESCE(v_tr.fee_amount,0) > 0 THEN ' (شامل العمولة)' ELSE '' END || ': ' || COALESCE(p_reason,''),
          v_user, v_tr.tenant_id, COALESCE(v_tr.payment_method,'cash'), v_tr.id);

  INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
  SELECT bu.user_id, v_tr.tenant_id,
         '❌ رفض تحويل خزنة',
         'تم رفض تحويل ' || v_tr.amount || ' ج.م — السبب: ' || COALESCE(p_reason,''),
         'general', 'treasury_transfer', v_tr.id,
         '/branch/' || v_tr.from_branch_id || '/treasury'
  FROM public.branch_users bu
  JOIN public.user_roles ur ON ur.user_id = bu.user_id
  WHERE bu.branch_id = v_tr.from_branch_id AND ur.role = 'branch_manager';
END;
$fn$;