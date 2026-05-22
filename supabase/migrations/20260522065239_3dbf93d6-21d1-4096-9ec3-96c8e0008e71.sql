
-- Add flag indicating whether the transfer fee was already debited by the payment provider
ALTER TABLE public.treasury_transfers
  ADD COLUMN IF NOT EXISTS fee_actually_charged boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.treasury_transfers.fee_actually_charged IS
  'true = العمولة اتخصمت فعلاً من البنك/المحفظة (تفضل كمصروف عند الرفض). false = لسه ماتخصمتش (ترجع مع المبلغ).';

-- Update reject function to refund fee back to sender when it was not actually charged
CREATE OR REPLACE FUNCTION public.reject_treasury_transfer(p_transfer_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tr record;
  v_refund_amount numeric;
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

  -- If fee was not actually charged yet, refund it together with the amount; otherwise it stays as expense
  v_refund_amount := v_tr.amount + CASE WHEN COALESCE(v_tr.fee_actually_charged, true) THEN 0 ELSE COALESCE(v_tr.fee_amount, 0) END;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method)
  VALUES
    (v_tr.to_branch_id, 'expense', 'transfer_refund', v_refund_amount,
     'رفض تحويل: ' || COALESCE(p_reason,''), v_user, v_tr.tenant_id, COALESCE(v_tr.payment_method,'cash')),
    (v_tr.from_branch_id, 'income', 'transfer_refund', v_refund_amount,
     'استرداد تحويل مرفوض' || CASE WHEN NOT COALESCE(v_tr.fee_actually_charged, true) AND COALESCE(v_tr.fee_amount,0) > 0 THEN ' (شامل العمولة)' ELSE '' END || ': ' || COALESCE(p_reason,''),
     v_user, v_tr.tenant_id, COALESCE(v_tr.payment_method,'cash'));

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
$function$;
