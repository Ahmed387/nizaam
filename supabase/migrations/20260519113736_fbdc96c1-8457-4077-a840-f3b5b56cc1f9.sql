
-- Add payment_method to expenses
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='expenses' AND column_name='payment_method') THEN
    ALTER TABLE public.expenses ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_method_check CHECK (payment_method IN ('cash','vodafone','instapay','bank'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='expenses' AND column_name='reference_number') THEN
    ALTER TABLE public.expenses ADD COLUMN reference_number TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='expenses' AND column_name='transfer_to_account') THEN
    ALTER TABLE public.expenses ADD COLUMN transfer_to_account TEXT;
  END IF;
END $$;

-- Update expense_to_treasury to pass payment_method
CREATE OR REPLACE FUNCTION public.expense_to_treasury()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.amount, 0) > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id, payment_method, reference_number, transfer_to_account)
    VALUES (NEW.branch_id, 'expense', COALESCE(NEW.type, 'general'), NEW.amount,
            COALESCE(NEW.description, 'مصروف'), NEW.id, NEW.created_by, NEW.tenant_id,
            COALESCE(NEW.payment_method,'cash'), NEW.reference_number, NEW.transfer_to_account);
  END IF;
  RETURN NEW;
END $$;

-- Updated transfer_treasury_atomic with payment_method + fee
DROP FUNCTION IF EXISTS public.transfer_treasury_atomic(uuid, uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.transfer_treasury_atomic(
  p_from_branch uuid,
  p_to_branch uuid,
  p_amount numeric,
  p_reason text,
  p_payment_method text DEFAULT 'cash',
  p_fee_amount numeric DEFAULT 0,
  p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_transfer_id uuid;
  v_wallet_balance numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;
  IF p_payment_method NOT IN ('cash','vodafone','instapay','bank') THEN RAISE EXCEPTION 'طريقة دفع غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;

  -- Wallet-level balance check
  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO v_wallet_balance
    FROM public.treasury
    WHERE branch_id = p_from_branch AND payment_method = p_payment_method;

  IF v_wallet_balance < (p_amount + COALESCE(p_fee_amount,0)) THEN
    RAISE EXCEPTION 'رصيد وعاء % غير كافٍ — المتاح: % ج.م', p_payment_method, v_wallet_balance;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;

  INSERT INTO public.treasury_transfers(
    from_branch_id, to_branch_id, amount, reason, transferred_by, tenant_id,
    payment_method, fee_amount, reference_number, transfer_to_account
  ) VALUES (
    p_from_branch, p_to_branch, p_amount, p_reason, v_user, v_tenant,
    p_payment_method, COALESCE(p_fee_amount,0), p_reference_number, p_transfer_to_account
  ) RETURNING id INTO v_transfer_id;

  -- Debit sender (amount)
  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_number, transfer_to_account)
  VALUES (p_from_branch, 'expense', 'transfer', p_amount,
          'تحويل لفرع: ' || COALESCE(p_reason, ''), v_user, v_tenant,
          p_payment_method, p_reference_number, p_transfer_to_account);

  -- Debit sender (fee) as separate expense
  IF COALESCE(p_fee_amount,0) > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, is_fee, reference_number)
    VALUES (p_from_branch, 'expense', 'transfer_fee', p_fee_amount,
            'عمولة تحويل (' || p_payment_method || ')', v_user, v_tenant,
            p_payment_method, true, p_reference_number);
  END IF;

  -- Credit receiver
  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_number)
  VALUES (p_to_branch, 'income', 'transfer', p_amount,
          'تحويل وارد: ' || COALESCE(p_reason, ''), v_user, v_tenant,
          p_payment_method, p_reference_number);

  RETURN v_transfer_id;
END;
$$;

-- Reject transfer: refund amount to sender (fee stays consumed)
CREATE OR REPLACE FUNCTION public.reject_treasury_transfer(p_transfer_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tr record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v_tr FROM public.treasury_transfers WHERE id = p_transfer_id;
  IF v_tr IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF v_tr.acknowledged_at IS NOT NULL THEN RAISE EXCEPTION 'تم تأكيد التحويل بالفعل'; END IF;
  IF v_tr.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'تم رفض التحويل بالفعل'; END IF;
  IF NOT (is_admin(v_user) OR user_in_branch(v_user, v_tr.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية رفض هذا التحويل';
  END IF;

  UPDATE public.treasury_transfers
    SET rejected_at = now(), rejected_by = v_user, rejection_reason = p_reason
    WHERE id = p_transfer_id;

  -- Reverse: debit receiver, credit sender (amount only — fee already lost)
  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method)
  VALUES
    (v_tr.to_branch_id, 'expense', 'transfer_refund', v_tr.amount,
     'رفض تحويل: ' || COALESCE(p_reason,''), v_user, v_tr.tenant_id, COALESCE(v_tr.payment_method,'cash')),
    (v_tr.from_branch_id, 'income', 'transfer_refund', v_tr.amount,
     'استرداد تحويل مرفوض: ' || COALESCE(p_reason,''), v_user, v_tr.tenant_id, COALESCE(v_tr.payment_method,'cash'));

  -- Notify sender branch managers
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
$$;
