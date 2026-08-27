-- 1) VAT columns on shipments
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS vat_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS vat_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount numeric NOT NULL DEFAULT 0;

-- 2) Input VAT account (asset) for every tenant + default seed
INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
SELECT t.id, '1350', 'Input VAT (Purchases)', 'ضريبة القيمة المضافة على المشتريات', 'asset', 'debit', true
FROM public.tenants t
ON CONFLICT (tenant_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
  VALUES
    (p_tenant_id,'1000','Assets','الأصول','asset','debit',true),
    (p_tenant_id,'1100','Cash / Treasury','الخزينة','asset','debit',true),
    (p_tenant_id,'1110','Bank','البنك','asset','debit',true),
    (p_tenant_id,'1200','Accounts Receivable','العملاء (مدينون)','asset','debit',true),
    (p_tenant_id,'1300','Inventory','المخزون','asset','debit',true),
    (p_tenant_id,'1350','Input VAT (Purchases)','ضريبة القيمة المضافة على المشتريات','asset','debit',true),
    (p_tenant_id,'1400','Partner Advances Receivable','سلف الشركاء','asset','debit',true),
    (p_tenant_id,'1500','Fixed Assets','الأصول الثابتة','asset','debit',true),
    (p_tenant_id,'1590','Accumulated Depreciation','مجمع الإهلاك','asset','credit',true),
    (p_tenant_id,'2000','Liabilities','الخصوم','liability','credit',true),
    (p_tenant_id,'2100','Accounts Payable','الموردون (دائنون)','liability','credit',true),
    (p_tenant_id,'2200','VAT Payable','ضريبة القيمة المضافة المستحقة','liability','credit',true),
    (p_tenant_id,'2300','Accrued Expenses','مصروفات مستحقة','liability','credit',true),
    (p_tenant_id,'3000','Equity','حقوق الملكية','equity','credit',true),
    (p_tenant_id,'3100','Partner Capital','رأس مال الشركاء','equity','credit',true),
    (p_tenant_id,'3200','Partner Drawings','مسحوبات الشركاء','equity','debit',true),
    (p_tenant_id,'3300','Retained Earnings (Legacy)','أرباح محتجزة (قديم)','equity','credit',true),
    (p_tenant_id,'3800','Retained Earnings','الأرباح المحتجزة','equity','credit',true),
    (p_tenant_id,'3850','Profit Distributions Payable','مستحقات توزيع أرباح','liability','credit',true),
    (p_tenant_id,'3900','Income Summary','ملخص الدخل','equity','credit',true),
    (p_tenant_id,'4000','Revenue','الإيرادات','revenue','credit',true),
    (p_tenant_id,'4100','Sales Revenue','إيراد المبيعات','revenue','credit',true),
    (p_tenant_id,'4200','Other Income','إيرادات أخرى','revenue','credit',true),
    (p_tenant_id,'4900','Sales Returns','مردودات المبيعات','revenue','debit',true),
    (p_tenant_id,'5000','Expenses','المصروفات','expense','debit',true),
    (p_tenant_id,'5100','Cost of Goods Sold','تكلفة البضاعة المباعة','expense','debit',true),
    (p_tenant_id,'5200','Salaries Expense','الرواتب','expense','debit',true),
    (p_tenant_id,'5300','Rent Expense','الإيجارات','expense','debit',true),
    (p_tenant_id,'5400','Utilities Expense','المرافق','expense','debit',true),
    (p_tenant_id,'5500','Operating Expenses','مصروفات تشغيلية','expense','debit',true),
    (p_tenant_id,'5900','Other Expenses','مصروفات أخرى','expense','debit',true),
    (p_tenant_id,'6500','Depreciation Expense','مصروف الإهلاك','expense','debit',true),
    (p_tenant_id,'6900','Loss on Asset Disposal','خسائر بيع أصول','expense','debit',true)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END $function$;

-- 3) record_shipment with VAT
CREATE OR REPLACE FUNCTION public.record_shipment(p_header jsonb, p_lines jsonb, p_plan jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_branch uuid := (p_header->>'branch_id')::uuid;
  v_ship_id uuid;
  v_num text;
  ln jsonb;
  v_pid uuid;
  v_qty int;
  v_cost numeric;
  v_disc_pct numeric;
  v_disc_amt numeric;
  v_name text;
  v_image text;
  v_sku text;
  v_net numeric;
  v_net_unit numeric;
  v_brand text; v_model text; v_color text; v_ptype text; v_capacity text; v_size text;
  v_shipping numeric := COALESCE((p_header->>'shipping_cost')::numeric, 0);
  v_customs  numeric := COALESCE((p_header->>'customs_cost')::numeric, 0);
  v_other    numeric := COALESCE((p_header->>'other_cost')::numeric, 0);
  v_admin    numeric := COALESCE((p_header->>'admin_cost')::numeric, 0);
  v_extras   numeric;
  v_it record;
  v_subtotal numeric := 0;
  v_total_qty int := 0;
  v_share numeric;
  v_unit_extra numeric;
  v_inv_disc_type text := COALESCE(NULLIF(p_header->>'discount_type',''), 'amount');
  v_inv_disc_value numeric := COALESCE((p_header->>'discount_value')::numeric, 0);
  v_inv_disc numeric := 0;
  v_factor numeric := 1;
  v_base numeric;
  v_vat_type text := COALESCE(NULLIF(p_header->>'vat_type',''), 'percent');
  v_vat_value numeric := COALESCE((p_header->>'vat_value')::numeric, 0);
  v_vat numeric := 0;
BEGIN
  IF v_branch IS NULL THEN RAISE EXCEPTION 'branch_id required'; END IF;

  v_extras := v_shipping + v_customs + v_other;
  v_num := public.next_shipment_number();

  INSERT INTO public.shipments(
    tenant_id, branch_id, shipment_number, contact_id, arrival_date, received_by,
    shipping_cost, customs_cost, other_cost, other_cost_description,
    total_extra_costs, admin_cost, total_cost, notes,
    discount_type, discount_value, discount_amount,
    vat_type, vat_value, vat_amount
  ) VALUES (
    v_tenant, v_branch, v_num,
    NULLIF(p_header->>'contact_id','')::uuid,
    COALESCE(NULLIF(p_header->>'arrival_date','')::date, CURRENT_DATE),
    NULLIF(p_header->>'received_by',''),
    v_shipping, v_customs, v_other, NULLIF(p_header->>'other_cost_description',''),
    v_extras, v_admin, 0,
    NULLIF(p_header->>'notes',''),
    v_inv_disc_type, v_inv_disc_value, 0,
    v_vat_type, v_vat_value, 0
  ) RETURNING id INTO v_ship_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_pid := NULLIF(ln->>'product_id','')::uuid;
    v_qty := (ln->>'quantity')::int;
    v_cost := (ln->>'cost_price')::numeric;
    v_disc_pct := COALESCE((ln->>'discount_percent')::numeric, 0);
    v_disc_amt := COALESCE((ln->>'discount_amount')::numeric, 0);
    v_name := ln->>'product_name';
    v_image := NULLIF(ln->>'image','');
    v_brand := NULLIF(ln->>'brand','');
    v_model := NULLIF(ln->>'model','');
    v_color := NULLIF(ln->>'color','');
    v_ptype := NULLIF(ln->>'product_type','');
    v_capacity := NULLIF(ln->>'capacity','');
    v_size := NULLIF(ln->>'size','');
    v_net := GREATEST(0, v_qty*v_cost - (v_qty*v_cost*v_disc_pct/100) - v_disc_amt);
    v_net_unit := CASE WHEN v_qty > 0 THEN v_net / v_qty ELSE v_cost END;

    IF v_pid IS NULL THEN
      v_sku := COALESCE(NULLIF(ln->>'sku',''), 'SKU-' || upper(substr(md5(random()::text),1,10)));
      INSERT INTO public.products(branch_id, tenant_id, name, sku, cost_price, selling_price, market_price, quantity, image,
                                  brand, model, color, product_type, capacity, size)
      VALUES (v_branch, v_tenant, v_name, v_sku, v_cost, v_cost*1.3, v_cost*1.3, 0, v_image,
              v_brand, v_model, v_color, v_ptype, v_capacity, v_size)
      RETURNING id INTO v_pid;
    ELSE
      UPDATE public.products
         SET brand = COALESCE(brand, v_brand),
             model = COALESCE(model, v_model),
             color = COALESCE(color, v_color),
             product_type = COALESCE(product_type, v_ptype),
             capacity = COALESCE(capacity, v_capacity),
             size = COALESCE(size, v_size)
       WHERE id = v_pid
         AND (v_brand IS NOT NULL OR v_model IS NOT NULL OR v_color IS NOT NULL
              OR v_ptype IS NOT NULL OR v_capacity IS NOT NULL OR v_size IS NOT NULL);
    END IF;

    UPDATE public.products SET quantity = COALESCE(quantity,0) + v_qty WHERE id = v_pid;

    INSERT INTO public.shipment_items(
      tenant_id, shipment_id, product_id, product_name, quantity, cost_price,
      discount_percent, discount_amount, total, base_unit_price,
      brand, model, color, product_type, capacity, size
    ) VALUES (
      v_tenant, v_ship_id, v_pid, v_name, v_qty, v_cost,
      v_disc_pct, v_disc_amt, v_net, v_net_unit,
      v_brand, v_model, v_color, v_ptype, v_capacity, v_size
    );

    INSERT INTO public.product_batches(
      tenant_id, branch_id, product_id, shipment_id,
      quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, true_unit_cost,
      batch_type
    ) VALUES (
      v_tenant, v_branch, v_pid, v_ship_id,
      v_qty, v_qty,
      v_net_unit, v_net_unit, v_net_unit,
      'purchase'
    );

    v_subtotal := v_subtotal + v_net;
    v_total_qty := v_total_qty + v_qty;
  END LOOP;

  IF v_inv_disc_type = 'percent' THEN
    v_inv_disc := v_subtotal * GREATEST(0, LEAST(100, v_inv_disc_value)) / 100;
  ELSE
    v_inv_disc := GREATEST(0, v_inv_disc_value);
  END IF;
  v_inv_disc := LEAST(v_inv_disc, v_subtotal);
  v_factor := CASE WHEN v_subtotal > 0 THEN (v_subtotal - v_inv_disc) / v_subtotal ELSE 1 END;

  IF v_vat_type = 'percent' THEN
    v_vat := (v_subtotal - v_inv_disc) * GREATEST(0, LEAST(100, v_vat_value)) / 100;
  ELSE
    v_vat := GREATEST(0, v_vat_value);
  END IF;

  UPDATE public.shipments
     SET total_cost = (v_subtotal - v_inv_disc) + v_extras + v_admin + v_vat,
         discount_amount = v_inv_disc,
         vat_amount = v_vat
   WHERE id = v_ship_id;

  FOR v_it IN SELECT id, product_id, quantity, total, base_unit_price FROM public.shipment_items WHERE shipment_id = v_ship_id LOOP
    v_share := CASE WHEN v_subtotal > 0 THEN (COALESCE(v_it.total,0) / v_subtotal) * v_extras ELSE 0 END;
    v_unit_extra := CASE WHEN v_it.quantity > 0 THEN v_share / v_it.quantity ELSE 0 END;
    v_base := COALESCE(v_it.base_unit_price, 0) * v_factor;

    UPDATE public.shipment_items
       SET shipping_cost_per_unit = v_unit_extra,
           true_unit_cost = v_base + v_unit_extra
     WHERE id = v_it.id;

    UPDATE public.product_batches
       SET base_purchase_price = v_base,
           cost_price = v_base + v_unit_extra,
           shipping_cost_per_unit = v_unit_extra,
           true_unit_cost = v_base + v_unit_extra
     WHERE shipment_id = v_ship_id AND product_id = v_it.product_id;
  END LOOP;

  RETURN jsonb_build_object(
    'shipment_id', v_ship_id,
    'shipment_number', v_num,
    'subtotal', v_subtotal,
    'invoice_discount', v_inv_disc,
    'vat_amount', v_vat,
    'total_cost', (v_subtotal - v_inv_disc) + v_extras + v_admin + v_vat
  );
END;
$function$;

-- 4) edit_shipment__impl with VAT
CREATE OR REPLACE FUNCTION public.edit_shipment__impl(p_shipment_id uuid, p_header jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ship shipments%ROWTYPE; v_old record; v_new jsonb; v_pid uuid;
  v_qty int; v_cost numeric; v_disc_pct numeric; v_disc_amt numeric;
  v_net numeric; v_net_unit numeric; v_items_net numeric := 0; v_total numeric;
  v_branch uuid; v_tenant uuid; v_sku text; v_name text; v_image text;
  v_paid numeric; v_plan_id uuid; v_new_qty int; v_cur_qty int;
  v_shipping numeric; v_customs numeric; v_other numeric; v_admin numeric;
  v_extras numeric; v_share numeric; v_unit_extra numeric;
  v_it record;
  v_inv_disc_type text; v_inv_disc_value numeric; v_inv_disc numeric := 0;
  v_factor numeric := 1; v_base numeric; v_consumed numeric;
  v_vat_type text; v_vat_value numeric; v_vat numeric := 0;
BEGIN
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشحنة غير موجودة'; END IF;
  v_branch := v_ship.branch_id; v_tenant := v_ship.tenant_id;

  v_shipping := COALESCE((p_header->>'shipping_cost')::numeric, v_ship.shipping_cost, 0);
  v_customs  := COALESCE((p_header->>'customs_cost')::numeric, v_ship.customs_cost, 0);
  v_other    := COALESCE((p_header->>'other_cost')::numeric, v_ship.other_cost, 0);
  v_admin    := COALESCE((p_header->>'admin_cost')::numeric, v_ship.admin_cost, 0);
  v_extras   := v_shipping + v_customs + v_other;

  v_inv_disc_type  := COALESCE(NULLIF(p_header->>'discount_type',''), v_ship.discount_type, 'amount');
  v_inv_disc_value := COALESCE((p_header->>'discount_value')::numeric, v_ship.discount_value, 0);
  v_vat_type  := COALESCE(NULLIF(p_header->>'vat_type',''), v_ship.vat_type, 'percent');
  v_vat_value := COALESCE((p_header->>'vat_value')::numeric, v_ship.vat_value, 0);

  FOR v_old IN SELECT * FROM shipment_items WHERE shipment_id = p_shipment_id LOOP
    SELECT value INTO v_new FROM jsonb_array_elements(p_items) value
      WHERE (value->>'id')::uuid = v_old.id LIMIT 1;

    IF v_new IS NULL THEN
      IF v_old.product_id IS NOT NULL THEN
        SELECT COALESCE(SUM(quantity_purchased - quantity_remaining), 0) INTO v_consumed
          FROM product_batches
         WHERE shipment_id = p_shipment_id AND product_id = v_old.product_id;
        IF v_consumed > 0 THEN
          RAISE EXCEPTION 'لا يمكن حذف %: اتباع/اتصرف % قطعة من دفعة الشحنة دي بالفعل',
            v_old.product_name, v_consumed;
        END IF;
        v_cur_qty := COALESCE((SELECT quantity FROM products WHERE id = v_old.product_id), 0);
        IF v_cur_qty - v_old.quantity < 0 THEN
          RAISE EXCEPTION 'لا يمكن حذف %: المخزون الحالي (%) أقل من كمية الشحنة (%)',
            v_old.product_name, v_cur_qty, v_old.quantity;
        END IF;
        DELETE FROM product_batches WHERE shipment_id = p_shipment_id AND product_id = v_old.product_id;
      END IF;
      DELETE FROM shipment_items WHERE id = v_old.id;
    ELSE
      v_qty := (v_new->>'quantity')::int;
      v_cost := (v_new->>'cost_price')::numeric;
      v_disc_pct := COALESCE((v_new->>'discount_percent')::numeric, 0);
      v_disc_amt := COALESCE((v_new->>'discount_amount')::numeric, 0);
      v_net := GREATEST(0, v_qty*v_cost - (v_qty*v_cost*v_disc_pct/100) - v_disc_amt);
      v_net_unit := CASE WHEN v_qty > 0 THEN v_net/v_qty ELSE v_cost END;

      IF v_old.product_id IS NOT NULL THEN
        v_cur_qty := COALESCE((SELECT quantity FROM products WHERE id = v_old.product_id), 0);
        v_new_qty := v_cur_qty + (v_qty - v_old.quantity);
        IF v_new_qty < 0 THEN
          RAISE EXCEPTION 'لا يمكن تقليل كمية %: المخزون (%) لا يكفي', v_old.product_name, v_cur_qty;
        END IF;
        UPDATE products SET quantity = v_new_qty WHERE id = v_old.product_id;
      END IF;

      UPDATE shipment_items SET
        quantity = v_qty, cost_price = v_cost,
        discount_percent = v_disc_pct, discount_amount = v_disc_amt,
        total = v_net,
        base_unit_price = v_net_unit,
        product_name = COALESCE(v_new->>'product_name', product_name)
      WHERE id = v_old.id;

      v_items_net := v_items_net + v_net;
    END IF;
  END LOOP;

  FOR v_new IN SELECT value FROM jsonb_array_elements(p_items) value WHERE value->>'id' IS NULL LOOP
    v_pid := NULLIF(v_new->>'product_id', '')::uuid;
    v_qty := (v_new->>'quantity')::int;
    v_cost := (v_new->>'cost_price')::numeric;
    v_disc_pct := COALESCE((v_new->>'discount_percent')::numeric, 0);
    v_disc_amt := COALESCE((v_new->>'discount_amount')::numeric, 0);
    v_name := v_new->>'product_name';
    v_sku := COALESCE(NULLIF(v_new->>'sku', ''), 'SKU-' || upper(substr(md5(random()::text), 1, 10)));
    v_image := NULLIF(v_new->>'image', '');
    v_net := GREATEST(0, v_qty*v_cost - (v_qty*v_cost*v_disc_pct/100) - v_disc_amt);
    v_net_unit := CASE WHEN v_qty > 0 THEN v_net/v_qty ELSE v_cost END;

    IF v_pid IS NULL THEN
      INSERT INTO products(branch_id, tenant_id, name, sku, cost_price, selling_price, market_price, quantity, image,
                           brand, model, color, product_type, capacity, size)
      VALUES (v_branch, v_tenant, v_name, v_sku, v_cost, v_cost*1.3, v_cost*1.3, 0, v_image,
              NULLIF(btrim(v_new->>'brand'),''), NULLIF(btrim(v_new->>'model'),''),
              NULLIF(btrim(v_new->>'color'),''), NULLIF(btrim(v_new->>'product_type'),''),
              NULLIF(btrim(v_new->>'capacity'),''), NULLIF(btrim(v_new->>'size'),''))
      RETURNING id INTO v_pid;
    END IF;

    UPDATE products SET quantity = COALESCE(quantity, 0) + v_qty WHERE id = v_pid;

    INSERT INTO shipment_items(shipment_id, product_id, product_name, quantity, cost_price,
                               discount_percent, discount_amount, total, base_unit_price, tenant_id)
    VALUES (p_shipment_id, v_pid, v_name, v_qty, v_cost, v_disc_pct, v_disc_amt, v_net, v_net_unit, v_tenant);

    INSERT INTO product_batches(tenant_id, branch_id, product_id, shipment_id,
                                quantity_purchased, quantity_remaining, cost_price,
                                base_purchase_price, true_unit_cost)
    VALUES (v_tenant, v_branch, v_pid, p_shipment_id, v_qty, v_qty, v_net_unit, v_net_unit, v_net_unit);

    v_items_net := v_items_net + v_net;
  END LOOP;

  IF v_inv_disc_type = 'percent' THEN
    v_inv_disc := v_items_net * GREATEST(0, LEAST(100, v_inv_disc_value)) / 100;
  ELSE
    v_inv_disc := GREATEST(0, v_inv_disc_value);
  END IF;
  v_inv_disc := LEAST(v_inv_disc, v_items_net);
  v_factor := CASE WHEN v_items_net > 0 THEN (v_items_net - v_inv_disc) / v_items_net ELSE 1 END;

  IF v_vat_type = 'percent' THEN
    v_vat := (v_items_net - v_inv_disc) * GREATEST(0, LEAST(100, v_vat_value)) / 100;
  ELSE
    v_vat := GREATEST(0, v_vat_value);
  END IF;

  FOR v_it IN SELECT * FROM shipment_items WHERE shipment_id = p_shipment_id LOOP
    v_share := CASE WHEN v_items_net > 0 THEN (v_it.total / v_items_net) * v_extras ELSE 0 END;
    v_unit_extra := CASE WHEN v_it.quantity > 0 THEN v_share / v_it.quantity ELSE 0 END;
    v_base := COALESCE(v_it.base_unit_price, 0) * v_factor;
    UPDATE shipment_items
       SET shipping_cost_per_unit = v_unit_extra,
           true_unit_cost = v_base + v_unit_extra
     WHERE id = v_it.id;
    UPDATE product_batches
       SET base_purchase_price = v_base,
           shipping_cost_per_unit = v_unit_extra,
           true_unit_cost = v_base + v_unit_extra,
           cost_price = v_base + v_unit_extra,
           quantity_remaining = GREATEST(0, quantity_remaining + (v_it.quantity - quantity_purchased)),
           quantity_purchased = v_it.quantity
     WHERE shipment_id = p_shipment_id AND product_id = v_it.product_id;
  END LOOP;

  v_total := (v_items_net - v_inv_disc) + v_extras + v_admin + v_vat;

  UPDATE shipments SET
    arrival_date  = COALESCE((p_header->>'arrival_date')::date, arrival_date),
    received_by   = COALESCE(NULLIF(p_header->>'received_by', ''), received_by),
    shipping_cost = v_shipping,
    customs_cost  = v_customs,
    other_cost    = v_other,
    other_cost_description = COALESCE(p_header->>'other_cost_description', other_cost_description),
    total_extra_costs = v_extras,
    admin_cost    = v_admin,
    discount_type = v_inv_disc_type,
    discount_value = v_inv_disc_value,
    discount_amount = v_inv_disc,
    vat_type      = v_vat_type,
    vat_value     = v_vat_value,
    vat_amount    = v_vat,
    notes         = NULLIF(p_header->>'notes', ''),
    total_cost    = v_total
  WHERE id = p_shipment_id;

  SELECT id, paid_amount INTO v_plan_id, v_paid
    FROM payment_plans
    WHERE reference_type = 'shipment' AND reference_id = p_shipment_id
    LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    UPDATE payment_plans SET
      total_amount     = v_total,
      remaining_amount = GREATEST(0, v_total - v_paid)
    WHERE id = v_plan_id;
  END IF;

  RETURN jsonb_build_object('total', v_total, 'items_net', v_items_net, 'extras', v_extras,
                            'invoice_discount', v_inv_disc, 'vat_amount', v_vat,
                            'plan_overpaid', COALESCE(v_paid, 0) > v_total);
END$function$;

-- 5) journal: split inventory vs input VAT
CREATE OR REPLACE FUNCTION public.sync_shipment_journal(p_shipment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s RECORD; v_lines jsonb; v_existing uuid; v_vat numeric; v_goods numeric;
BEGIN
  SELECT id, tenant_id, invoice_date, shipment_number, total_cost, COALESCE(vat_amount,0) AS vat_amount
    INTO s FROM public.shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_existing FROM public.journal_entries
   WHERE source_type = 'shipment' AND source_id = s.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entry_lines WHERE entry_id = v_existing;
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF COALESCE(s.total_cost, 0) <= 0 THEN RETURN; END IF;

  v_vat := LEAST(GREATEST(COALESCE(s.vat_amount,0), 0), s.total_cost);
  v_goods := s.total_cost - v_vat;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1300','debit',v_goods,'credit',0,'description','Shipment '||s.shipment_number||' inventory received'),
    jsonb_build_object('account_code','2100','debit',0,'credit',s.total_cost,'description','Shipment '||s.shipment_number||' payable to supplier')
  );
  IF v_vat > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code','1350','debit',v_vat,'credit',0,'description','Shipment '||s.shipment_number||' input VAT')
    );
  END IF;
  PERFORM public.post_journal(s.tenant_id, s.invoice_date::date, 'Shipment '||s.shipment_number, 'shipment', s.id, v_lines);
END $function$;