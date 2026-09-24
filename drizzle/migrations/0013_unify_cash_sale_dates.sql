DROP FUNCTION IF EXISTS public.process_sale(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric);
CREATE OR REPLACE FUNCTION public.process_sale(p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_percent numeric, p_discount_reason text, p_total numeric, p_payment_method text, p_items jsonb, p_payments jsonb DEFAULT NULL::jsonb, p_vat_rate numeric DEFAULT 0, p_vat_amount numeric DEFAULT 0, p_invoice_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_user_name text;
  v_tenant uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_item jsonb;
  v_pay jsonb;
  v_pid uuid;
  v_qty int;
  v_current int;
  v_sp numeric;
  v_cp numeric;
  v_ld numeric;
  v_eff_unit numeric;
  v_pay_sum numeric := 0;
  v_line_total numeric;
  v_fee numeric;
  v_fee_on_cust boolean;
  v_pm text;
  v_prev_balance numeric;
  v_curr_balance numeric;
  v_fifo jsonb;
  v_unit_cost numeric;
  v_calc_subtotal numeric := 0;
  v_calc_discount numeric := 0;
  v_calc_disc_pct numeric := 0;
  v_calc_net numeric := 0;
  v_calc_tax numeric := 0;
  v_calc_total numeric := 0;
  v_vat_rate numeric := GREATEST(COALESCE(p_vat_rate, 0), 0);
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_ts timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT public.user_in_branch(v_user, p_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  IF p_invoice_date IS NOT NULL AND p_invoice_date > v_today THEN
    RAISE EXCEPTION 'مينفعش تسجّل فاتورة بتاريخ في المستقبل';
  END IF;
  v_ts := CASE WHEN p_invoice_date IS NULL OR p_invoice_date = v_today THEN now()
               ELSE (p_invoice_date + time '12:00') AT TIME ZONE 'Africa/Cairo' END;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user;

  IF p_customer_id IS NOT NULL THEN
    SELECT COALESCE(total_balance, 0) INTO v_prev_balance FROM public.v_contact_balances WHERE contact_id = p_customer_id;
  ELSE
    v_prev_balance := 0;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    v_pid := (v_item->>'product_id')::uuid;
    IF v_pid IS NULL THEN RAISE EXCEPTION 'منتج غير محدد'; END IF;
    v_sp := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_cp := COALESCE(NULLIF((v_item->>'cost_price')::numeric, 0), 0);
    v_ld := COALESCE((v_item->>'line_discount')::numeric, 0);
    IF v_ld < 0 THEN RAISE EXCEPTION 'خصم غير صحيح'; END IF;

    SELECT quantity INTO v_current FROM public.products WHERE id = v_pid AND branch_id = p_branch_id FOR UPDATE;
    IF v_current IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في هذا الفرع'; END IF;
    IF v_current < v_qty THEN RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current; END IF;

    IF v_cp = 0 THEN
      SELECT COALESCE(cost_price, 0) INTO v_cp FROM public.products WHERE id = v_pid;
    END IF;

    v_line_total := v_qty * v_sp - v_ld;
    IF v_line_total < 0 THEN RAISE EXCEPTION 'إجمالي السطر سالب'; END IF;
    IF v_cp > 0 THEN
      v_eff_unit := v_line_total / v_qty;
      IF v_eff_unit < v_cp THEN
        RAISE EXCEPTION 'لا يمكن البيع بأقل من سعر التكلفة للمنتج: %', v_item->>'product_name';
      END IF;
    END IF;

    v_calc_subtotal := v_calc_subtotal + v_line_total;
  END LOOP;

  v_calc_subtotal := ROUND(GREATEST(v_calc_subtotal, 0), 2);
  v_calc_discount := ROUND(LEAST(GREATEST(COALESCE(p_discount_amount, 0), 0), v_calc_subtotal), 2);
  v_calc_net      := ROUND(GREATEST(v_calc_subtotal - v_calc_discount, 0), 2);
  v_calc_disc_pct := CASE WHEN v_calc_subtotal > 0
                          THEN ROUND(v_calc_discount * 100 / v_calc_subtotal, 2) ELSE 0 END;
  v_calc_tax      := CASE WHEN v_vat_rate > 0
                          THEN ROUND(v_calc_net * v_vat_rate / 100, 2)
                          ELSE ROUND(GREATEST(COALESCE(p_vat_amount, 0), 0), 2) END;
  v_calc_total    := ROUND(v_calc_net + v_calc_tax, 2);

  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pay_sum := v_pay_sum + COALESCE((v_pay->>'amount')::numeric, 0);
      v_pm := COALESCE(v_pay->>'payment_method', 'cash');
      IF v_pm <> 'cash' AND v_pm <> 'credit_balance' THEN
        IF COALESCE(NULLIF(v_pay->>'reference_number',''), '') = '' THEN
          RAISE EXCEPTION 'رقم العملية مطلوب للتحويلات الإلكترونية';
        END IF;
        IF COALESCE(NULLIF(v_pay->>'transfer_from_account',''), '') = '' THEN
          RAISE EXCEPTION 'رقم الحساب المحول منه مطلوب للتحويلات الإلكترونية';
        END IF;
        IF COALESCE(NULLIF(v_pay->>'transfer_to_account',''), '') = '' THEN
          RAISE EXCEPTION 'رقم الحساب المحول إليه مطلوب للتحويلات الإلكترونية';
        END IF;
      END IF;
    END LOOP;
    IF v_pay_sum > v_calc_total + 0.01 THEN
      RAISE EXCEPTION 'مجموع طرق الدفع (%) أكبر من إجمالي الفاتورة (%)', v_pay_sum, v_calc_total;
    END IF;
  END IF;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.invoices(
    invoice_number, branch_id, contact_id, cashier_id,
    subtotal, discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id, vat_rate, vat_amount,
    previous_balance, invoice_date
  ) VALUES (
    v_invoice_number, p_branch_id, p_customer_id, v_user,
    v_calc_subtotal, v_calc_discount, v_calc_disc_pct, p_discount_reason,
    v_calc_total, COALESCE(p_payment_method, 'cash'), v_tenant,
    v_vat_rate, v_calc_tax,
    v_prev_balance, v_ts
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    v_pid := (v_item->>'product_id')::uuid;
    v_sp := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_ld := COALESCE((v_item->>'line_discount')::numeric, 0);

    v_fifo := public.consume_product_batches_json(v_pid, p_branch_id, v_qty);
    v_unit_cost := COALESCE((v_fifo->>'weighted_unit_cost')::numeric, 0);
    IF v_unit_cost = 0 THEN
      SELECT COALESCE(cost_price, 0) INTO v_unit_cost FROM public.products WHERE id = v_pid;
    END IF;

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, total, tenant_id,
      price_list_item_id, price_list_cost, line_discount,
      unit_cost_at_sale, original_unit_cost, batches_consumed
    ) VALUES (
      v_invoice_id, v_pid, v_item->>'product_name', v_qty,
      v_unit_cost, v_sp,
      COALESCE((v_item->>'market_price')::numeric, 0),
      v_qty * v_sp - v_ld, v_tenant,
      NULLIF(v_item->>'price_list_item_id','')::uuid, NULL, v_ld,
      v_unit_cost, v_unit_cost, COALESCE(v_fifo->'batches', '[]'::jsonb)
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
        fee_amount, fee_on_customer, created_at
      ) VALUES (
        v_invoice_id, v_tenant, p_branch_id,
        v_pm, (v_pay->>'amount')::numeric,
        NULLIF(v_pay->>'reference_number',''),
        COALESCE(NULLIF(v_pay->>'received_by_name',''), v_user_name),
        NULLIF(v_pay->>'transfer_to_account',''),
        NULLIF(v_pay->>'transfer_from_account',''),
        v_fee, v_fee_on_cust, v_ts
      );

      IF v_fee > 0 AND NOT v_fee_on_cust THEN
        INSERT INTO public.expenses(
          branch_id, type, amount, description, date,
          payment_method, reference_number, is_fee, created_by, tenant_id
        ) VALUES (
          p_branch_id, 'عمولة تحويل', v_fee,
          'عمولة ' || v_pm || ' — فاتورة ' || v_invoice_number,
          (v_ts AT TIME ZONE 'Africa/Cairo')::date, v_pm, NULLIF(v_pay->>'reference_number',''),
          true, v_user, v_tenant
        );
      END IF;
    END LOOP;
  END IF;

  IF v_pay_sum > 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      reference_id, created_by, tenant_id, payment_method, created_at
    )
    SELECT
      p_branch_id, 'income', 'sales',
      SUM(COALESCE((e->>'amount')::numeric, 0)),
      'فاتورة ' || v_invoice_number, v_invoice_id, v_user, v_tenant,
      COALESCE(NULLIF(e->>'payment_method',''), 'cash'), v_ts
    FROM jsonb_array_elements(p_payments) e
    GROUP BY COALESCE(NULLIF(e->>'payment_method',''), 'cash')
    HAVING SUM(COALESCE((e->>'amount')::numeric, 0)) > 0;
  ELSIF p_payments IS NULL AND v_calc_total > 0 AND COALESCE(NULLIF(p_payment_method,''),'cash') <> 'credit' THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      reference_id, created_by, tenant_id, payment_method, created_at
    ) VALUES (
      p_branch_id, 'income', 'sales', v_calc_total,
      'فاتورة ' || v_invoice_number, v_invoice_id, v_user, v_tenant,
      COALESCE(NULLIF(p_payment_method,''), 'cash'), v_ts
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
GRANT EXECUTE ON FUNCTION public.process_sale(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_invoice_payment_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lines JSONB; v_acct text;
BEGIN
  IF COALESCE(current_setting('app.skip_journal', true),'') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.voided_at IS NULL AND COALESCE(NEW.amount,0) > 0 THEN
    v_acct := CASE WHEN LOWER(COALESCE(NEW.payment_method,'cash')) = 'cash' THEN '1100' ELSE '1110' END;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code',v_acct,'debit',NEW.amount,'credit',0,'description','Payment received'),
      jsonb_build_object('account_code','1200','debit',0,'credit',NEW.amount,'description','AR settlement')
    );
    PERFORM public.post_journal(NEW.tenant_id, (NEW.created_at AT TIME ZONE 'Africa/Cairo')::date, 'Invoice payment',
      'invoice_payment', NEW.id, v_lines);
  ELSIF TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'invoice_payment', NEW.id, 'Payment voided');
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.treasury_to_voucher_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type voucher_type;
  cat_id UUID;
  key TEXT;
  vnum TEXT;
  uname TEXT;
BEGIN
  IF current_setting('app.skip_treasury_voucher', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.category, '') = 'رصيد افتتاحي' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM vouchers WHERE treasury_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  v_type := CASE WHEN NEW.type = 'income' THEN 'receipt'::voucher_type ELSE 'payment'::voucher_type END;
  key := map_treasury_to_category_key(NEW);
  cat_id := get_system_category(NEW.tenant_id, v_type, key);
  vnum := next_voucher_number(NEW.tenant_id, v_type);
  SELECT name INTO uname FROM profiles WHERE id = NEW.created_by;

  INSERT INTO vouchers (
    tenant_id, branch_id, voucher_number, type, source, source_type, source_id,
    treasury_id, category_id, amount, payment_method, reference_number,
    transferred_to, description, voucher_date, created_by, created_by_name
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, vnum, v_type, 'system',
    'treasury', NEW.reference_id, NEW.id, cat_id, NEW.amount,
    NEW.payment_method, NEW.reference_number, NEW.transfer_to_account,
    NEW.description, (NEW.created_at AT TIME ZONE 'Africa/Cairo')::date, NEW.created_by, uname
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_voucher_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.voucher_date > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'مينفعش تسجّل سند بتاريخ في المستقبل';
  END IF;
  RETURN NEW;
END;
$function$;