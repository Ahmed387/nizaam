-- 1) process_sale: split treasury income per payment method
CREATE OR REPLACE FUNCTION public.process_sale(p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_percent numeric, p_discount_reason text, p_total numeric, p_payment_method text, p_items jsonb, p_payments jsonb DEFAULT NULL::jsonb, p_vat_rate numeric DEFAULT 0, p_vat_amount numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_invoice_number text;
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_user_name text;
  v_item jsonb;
  v_pay jsonb;
  v_pid uuid;
  v_qty numeric;
  v_sp numeric;
  v_ld numeric;
  v_cost numeric;
  v_prod record;
  v_pay_sum numeric := 0;
  v_pm text;
  v_fee numeric;
  v_fee_on_cust boolean;
  v_curr_balance numeric;
  v_floor text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'الفرع غير موجود';
  END IF;

  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'الفاتورة لازم يكون فيها صنف واحد على الأقل';
  END IF;

  -- validate items belong to this branch and have stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'الكمية لازم تكون أكبر من صفر';
    END IF;
    SELECT * INTO v_prod FROM public.products WHERE id = v_pid;
    IF v_prod IS NULL THEN
      RAISE EXCEPTION 'المنتج غير موجود';
    END IF;
    IF v_prod.branch_id IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'المنتج % مش تابع للفرع ده', v_prod.name;
    END IF;
    IF v_prod.quantity < v_qty THEN
      RAISE EXCEPTION 'الكمية المتاحة من % هي % فقط', v_prod.name, v_prod.quantity;
    END IF;
  END LOOP;

  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pay_sum := v_pay_sum + COALESCE((v_pay->>'amount')::numeric, 0);
      v_pm := COALESCE(v_pay->>'payment_method', 'cash');
      IF COALESCE((v_pay->>'amount')::numeric, 0) < 0 THEN
        RAISE EXCEPTION 'مبلغ الدفع لا يمكن أن يكون سالبًا';
      END IF;
    END LOOP;

    IF v_pay_sum > p_total + 0.01 THEN
      RAISE EXCEPTION 'مجموع طرق الدفع (%) أكبر من إجمالي الفاتورة (%)', v_pay_sum, p_total;
    END IF;
  END IF;

  v_invoice_number := public.next_invoice_number(p_branch_id);

  INSERT INTO public.invoices(
    branch_id, invoice_number, contact_id, subtotal,
    discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id, vat_rate, vat_amount,
    created_by, created_by_name, status
  ) VALUES (
    p_branch_id, v_invoice_number, p_customer_id, p_subtotal,
    COALESCE(p_discount_amount, 0), COALESCE(p_discount_percent, 0), p_discount_reason,
    p_total, COALESCE(p_payment_method, 'cash'), v_tenant,
    COALESCE(p_vat_rate, 0), COALESCE(p_vat_amount, 0),
    v_user, v_user_name, 'active'
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    v_sp  := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_ld  := COALESCE((v_item->>'line_discount')::numeric, 0);

    SELECT * INTO v_prod FROM public.products WHERE id = v_pid;
    v_cost := COALESCE(v_prod.cost_price, 0);

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, sku, quantity,
      selling_price, cost_price, unit_cost_at_sale, branch_id,
      total, tenant_id, price_list_item_id, returned_quantity, line_discount
    ) VALUES (
      v_invoice_id, v_pid, v_prod.name, v_prod.sku, v_qty,
      v_sp, v_cost, v_cost, p_branch_id,
      v_qty * v_sp - v_ld, v_tenant,
      NULLIF(v_item->>'price_list_item_id','')::uuid, NULL, v_ld
    );
    UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
  END LOOP;

  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pm := COALESCE(v_pay->>'payment_method', 'cash');
      v_fee := COALESCE((v_pay->>'fee_amount')::numeric, 0);
      v_fee_on_cust := COALESCE((v_pay->>'fee_on_customer')::boolean, false);

      INSERT INTO public.invoice_payments(
        invoice_id, tenant_id, branch_id,
        payment_method, amount, reference_number, received_by_name,
        transfer_to_account, transfer_from_account,
        fee_amount, fee_on_customer
      ) VALUES (
        v_invoice_id, v_tenant, p_branch_id,
        v_pm, (v_pay->>'amount')::numeric,
        NULLIF(v_pay->>'reference_number',''),
        COALESCE(NULLIF(v_pay->>'received_by_name',''), v_user_name),
        NULLIF(v_pay->>'transfer_to_account',''),
        NULLIF(v_pay->>'transfer_from_account',''),
        v_fee, v_fee_on_cust
      );

      IF v_fee > 0 AND NOT v_fee_on_cust THEN
        INSERT INTO public.expenses(
          branch_id, type, amount, description, date,
          payment_method, reference_number, is_fee, created_by, tenant_id
        ) VALUES (
          p_branch_id, 'عمولة تحويل', v_fee,
          'عمولة ' || v_pm || ' — فاتورة ' || v_invoice_number,
          CURRENT_DATE, v_pm, NULLIF(v_pay->>'reference_number',''),
          true, v_user, v_tenant
        );
      END IF;
    END LOOP;
  END IF;

  -- Treasury: one row PER payment method (was one merged row that defaulted to cash)
  IF v_pay_sum > 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      reference_id, created_by, tenant_id, payment_method
    )
    SELECT
      p_branch_id, 'income', 'sales',
      SUM(COALESCE((e->>'amount')::numeric, 0)),
      'فاتورة ' || v_invoice_number, v_invoice_id, v_user, v_tenant,
      COALESCE(NULLIF(e->>'payment_method',''), 'cash')
    FROM jsonb_array_elements(p_payments) e
    GROUP BY COALESCE(NULLIF(e->>'payment_method',''), 'cash')
    HAVING SUM(COALESCE((e->>'amount')::numeric, 0)) > 0;
  ELSIF p_payments IS NULL AND p_total > 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      reference_id, created_by, tenant_id, payment_method
    ) VALUES (
      p_branch_id, 'income', 'sales', p_total,
      'فاتورة ' || v_invoice_number, v_invoice_id, v_user, v_tenant,
      COALESCE(NULLIF(p_payment_method,''), 'cash')
    );
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT COALESCE(total_balance, 0) INTO v_curr_balance FROM public.v_contact_balances WHERE contact_id = p_customer_id;
  ELSE
    v_curr_balance := 0;
  END IF;

  UPDATE public.invoices
    SET current_balance = v_curr_balance
    WHERE id = v_invoice_id;

  RETURN v_invoice_id;
END;
$function$;

-- 2) Treasury guard: validate the balance of the SPECIFIC payment method
CREATE OR REPLACE FUNCTION public.check_treasury_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric;
  v_method_balance numeric;
  v_code text;
  v_pm text := COALESCE(NULLIF(NEW.payment_method, ''), 'cash');
  v_label text;
BEGIN
  IF NEW.type = 'expense' THEN
    SELECT code INTO v_code FROM public.branches WHERE id = NEW.branch_id;
    IF v_code = 'PARTNER-CASH' THEN RETURN NEW; END IF;

    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.treasury WHERE branch_id = NEW.branch_id;

    IF v_balance < NEW.amount THEN
      RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_method_balance
      FROM public.treasury
      WHERE branch_id = NEW.branch_id
        AND COALESCE(NULLIF(payment_method, ''), 'cash') = v_pm;

    IF v_method_balance < NEW.amount THEN
      v_label := CASE v_pm
        WHEN 'cash' THEN 'النقدي'
        WHEN 'instapay' THEN 'انستاباي'
        WHEN 'bank' THEN 'الحساب البنكي'
        WHEN 'bank_transfer' THEN 'التحويل البنكي'
        WHEN 'vodafone' THEN 'فودافون كاش'
        WHEN 'wallet' THEN 'المحفظة'
        ELSE v_pm
      END;
      RAISE EXCEPTION 'رصيد % مش كفاية — المتاح % جنيه والمطلوب % جنيه. اختار وسيلة دفع تانية أو حوّل رصيد للوسيلة دي الأول.',
        v_label, v_method_balance, NEW.amount
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- 3) Wallet balances: include custom/other methods so the parts sum to the total
DROP FUNCTION IF EXISTS public.get_branch_wallet_balances(uuid);
CREATE FUNCTION public.get_branch_wallet_balances(p_branch_id uuid)
 RETURNS TABLE(cash_balance numeric, vodafone_balance numeric, instapay_balance numeric, bank_balance numeric, other_balance numeric, total_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT COALESCE(NULLIF(payment_method, ''), 'cash') AS pm,
           (CASE WHEN type='income' THEN amount ELSE -amount END) AS signed
    FROM public.treasury WHERE branch_id = p_branch_id
  )
  SELECT
    COALESCE(SUM(CASE WHEN pm='cash'     THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm IN ('vodafone','wallet','etisalat','orange') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm='instapay' THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm IN ('bank','bank_transfer') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm NOT IN ('cash','vodafone','wallet','etisalat','orange','instapay','bank','bank_transfer') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(signed), 0)
  FROM t;
$function$;

GRANT EXECUTE ON FUNCTION public.get_branch_wallet_balances(uuid) TO authenticated, service_role;