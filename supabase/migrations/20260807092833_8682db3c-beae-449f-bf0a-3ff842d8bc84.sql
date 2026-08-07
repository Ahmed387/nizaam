-- 1) seed function: add partner capital categories
CREATE OR REPLACE FUNCTION public.seed_voucher_categories(_tenant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO voucher_categories (tenant_id, name, type, is_system, system_key) VALUES
    (_tenant, 'مدفوعات موردين', 'payment', true, 'supplier_payment'),
    (_tenant, 'رواتب موظفين', 'payment', true, 'salary'),
    (_tenant, 'سلف موظفين', 'payment', true, 'advance'),
    (_tenant, 'إيجارات', 'payment', true, 'rent'),
    (_tenant, 'كهرباء ومياه', 'payment', true, 'utilities'),
    (_tenant, 'صيانة', 'payment', true, 'maintenance'),
    (_tenant, 'مصاريف شحن', 'payment', true, 'shipping'),
    (_tenant, 'عمولات تحويل', 'payment', true, 'transfer_fee'),
    (_tenant, 'مرتجعات للعملاء', 'payment', true, 'customer_return'),
    (_tenant, 'تحويلات بين الفروع', 'payment', true, 'branch_transfer_out'),
    (_tenant, 'سحب شركاء', 'payment', true, 'partner_withdrawal'),
    (_tenant, 'أخرى', 'payment', true, 'other_payment')
  ON CONFLICT DO NOTHING;

  INSERT INTO voucher_categories (tenant_id, name, type, is_system, system_key) VALUES
    (_tenant, 'مبيعات نقدية', 'receipt', true, 'cash_sale'),
    (_tenant, 'تحصيل أقساط عملاء', 'receipt', true, 'installment'),
    (_tenant, 'تحويلات بين الفروع', 'receipt', true, 'branch_transfer_in'),
    (_tenant, 'رأس مال شركاء', 'receipt', true, 'partner_capital'),
    (_tenant, 'إيرادات أخرى', 'receipt', true, 'other_receipt')
  ON CONFLICT DO NOTHING;

  -- capital movements are NOT operating income/expense
  UPDATE voucher_categories
     SET is_deductible_from_profit = false,
         gl_account_code = CASE WHEN system_key = 'partner_capital' THEN '3100' ELSE '3200' END
   WHERE tenant_id = _tenant
     AND system_key IN ('partner_capital','partner_withdrawal');
END;
$$;

SELECT public.seed_voucher_categories(id) FROM public.tenants;

-- 2) treasury -> voucher category mapping
CREATE OR REPLACE FUNCTION public.map_treasury_to_category_key(_t treasury)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  cat TEXT := COALESCE(_t.category, '');
BEGIN
  IF _t.is_fee THEN RETURN 'transfer_fee'; END IF;
  -- partner capital movements (equity, never operating income/expense)
  IF cat ILIKE '%partner_contribution%' OR cat ILIKE '%partner_capital%' OR cat ILIKE '%رأس مال%' OR cat ILIKE '%راس مال%' THEN
    RETURN CASE WHEN _t.type='expense' THEN 'partner_withdrawal' ELSE 'partner_capital' END;
  END IF;
  IF cat ILIKE '%partner_withdraw%' OR cat ILIKE '%سحب شريك%' OR cat ILIKE '%سحب شركاء%' THEN RETURN 'partner_withdrawal'; END IF;
  IF cat ILIKE '%مورد%' OR cat ILIKE '%shipment%' OR cat ILIKE '%supplier%' THEN RETURN CASE WHEN _t.type='expense' THEN 'supplier_payment' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%راتب%' OR cat ILIKE '%salary%' THEN RETURN 'salary'; END IF;
  IF cat ILIKE '%سلف%' OR cat ILIKE '%advance%' THEN RETURN 'advance'; END IF;
  IF cat ILIKE '%إيجار%' OR cat ILIKE '%ايجار%' OR cat ILIKE '%rent%' THEN RETURN 'rent'; END IF;
  IF cat ILIKE '%كهرب%' OR cat ILIKE '%مياه%' OR cat ILIKE '%utilit%' THEN RETURN 'utilities'; END IF;
  IF cat ILIKE '%صيان%' OR cat ILIKE '%maintenance%' THEN RETURN 'maintenance'; END IF;
  IF cat ILIKE '%شحن%' OR cat ILIKE '%shipping%' THEN RETURN 'shipping'; END IF;
  IF cat ILIKE '%مرتجع%' OR cat ILIKE '%return%' THEN RETURN CASE WHEN _t.type='expense' THEN 'customer_return' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%تحويل%' OR cat ILIKE '%transfer%' THEN RETURN CASE WHEN _t.type='expense' THEN 'branch_transfer_out' ELSE 'branch_transfer_in' END; END IF;
  IF cat ILIKE '%قسط%' OR cat ILIKE '%installment%' THEN RETURN 'installment'; END IF;
  IF cat ILIKE '%مبيع%' OR cat ILIKE '%sale%' OR cat ILIKE '%invoice%' THEN RETURN 'cash_sale'; END IF;
  RETURN CASE WHEN _t.type='expense' THEN 'other_payment' ELSE 'other_receipt' END;
END;
$function$;