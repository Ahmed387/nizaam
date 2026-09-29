CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF NEW.tenant_id IS NULL OR COALESCE(NEW.is_system, false) THEN RETURN NEW; END IF;
  IF public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count
  FROM public.branches
  WHERE tenant_id = NEW.tenant_id AND COALESCE(is_system, false) = false;
  IF v_count >= 3 THEN
    RAISE EXCEPTION 'وصلت للحد الأقصى من الفروع (3 فروع لكل شركة)' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_system_branch_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.is_system
  ) THEN
    RAISE EXCEPTION 'هذا وعاء مالي نظامي وليس فرعًا تشغيليًا — لا يمكن تسجيل بيع أو شراء أو حضور أو وردية عليه';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_contact_credit_deposit(
  p_contact_id uuid,
  p_amount numeric,
  p_method text,
  p_description text DEFAULT NULL,
  p_voucher_date date DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_transferred_from text DEFAULT NULL,
  p_transferred_to text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_cname text;
  v_branch uuid; v_cat uuid; v_cat_name text := 'إيداع رصيد تحت الحساب — حساب الإدارة';
  v_num text; v_tr uuid; v_id uuid; v_uname text; v_desc text;
  v_date date := COALESCE(p_voucher_date, public.cairo_today());
  v_pm text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'إيداع الرصيد تحت الحساب متاح للأدمن والمالك فقط';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF p_method NOT IN ('cash', 'bank') THEN RAISE EXCEPTION 'طريقة الاستلام يجب أن تكون الخزينة الرئيسية أو الحساب البنكي العام للشركة'; END IF;
  v_pm := p_method;

  SELECT tenant_id, name INTO v_tenant, v_cname
  FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الجهة غير موجودة'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  PERFORM public._validate_transfer_payment(v_pm, p_reference_number, p_transferred_from, p_transferred_to);

  SELECT id INTO v_branch
  FROM public.branches
  WHERE tenant_id = v_tenant AND code = 'MAIN-TREASURY' AND is_system = true
  LIMIT 1;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'الخزينة الرئيسية (الإدارة) غير مهيأة لهذه الشركة — تم رفض الإيداع لحماية أدراج الفروع وخزينة الشركاء';
  END IF;

  SELECT id INTO v_cat FROM public.voucher_categories
  WHERE tenant_id = v_tenant AND type = 'receipt' AND system_key = 'credit_deposit' LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO public.voucher_categories
      (tenant_id, name, type, is_system, system_key, is_active, is_deductible_from_profit, is_added_to_profit)
    VALUES (v_tenant, v_cat_name, 'receipt', true, 'credit_deposit', true, false, false)
    RETURNING id INTO v_cat;
  END IF;

  SELECT name INTO v_uname FROM public.profiles WHERE id = v_uid;
  v_num := public.next_voucher_number(v_tenant, 'receipt');
  v_desc := COALESCE(NULLIF(BTRIM(p_description), ''), 'إيداع دفعة تحت الحساب طرف الإدارة');

  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  INSERT INTO public.treasury
    (tenant_id, branch_id, type, category, amount, description, payment_method,
     reference_number, transfer_to_account, transfer_from_account, is_fee, created_by)
  VALUES
    (v_tenant, v_branch, 'income', v_cat_name, p_amount,
     v_desc || ' — ' || v_cname || ' (' || v_num || ')', v_pm,
     p_reference_number, p_transferred_to, p_transferred_from, false, v_uid)
  RETURNING id INTO v_tr;

  INSERT INTO public.vouchers
    (tenant_id, branch_id, voucher_number, type, source, source_type, source_id,
     treasury_id, category_id, amount, payment_method, fee_amount, reference_number,
     transferred_to, transferred_from, party_type, party_id, party_name, description,
     voucher_date, created_by, created_by_name)
  VALUES
    (v_tenant, v_branch, v_num, 'receipt', 'manual', 'credit_deposit', p_contact_id,
     v_tr, v_cat, p_amount, v_pm, 0, p_reference_number,
     p_transferred_to, p_transferred_from, 'other', p_contact_id, v_cname, v_desc,
     v_date, v_uid, v_uname)
  RETURNING id INTO v_id;
  PERFORM set_config('app.skip_treasury_voucher', '0', true);

  UPDATE public.contacts
  SET credit_balance = COALESCE(credit_balance, 0) - p_amount
  WHERE id = p_contact_id;

  INSERT INTO public.customer_credit_log (tenant_id, contact_id, amount, type, notes, created_by)
  VALUES (v_tenant, p_contact_id, p_amount, 'credit_added', v_num || ' — ' || v_desc, v_uid);

  INSERT INTO public.audit_log
    (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES
    (v_uid, COALESCE(v_uname, '?'), v_tenant, v_branch, 'CREATE', 'voucher', v_id::text,
     jsonb_build_object('voucher_number', v_num, 'kind', 'credit_deposit',
       'financial_container', 'MAIN-TREASURY', 'contact_id', p_contact_id,
       'amount', p_amount, 'method', v_pm));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_contact_credit_deposit(uuid,numeric,text,text,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_contact_credit_deposit(uuid,numeric,text,text,date,text,text,text) TO authenticated;