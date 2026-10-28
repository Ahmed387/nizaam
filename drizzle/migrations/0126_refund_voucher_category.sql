-- 0126: the voucher of money given back on a cancelled sale invoice is «مرتجعات للعملاء», never «نثريات» (owner «نفذ», 2026-10-28)
--
-- The till row of that refund has category 'sales_refund'. map_treasury_to_category_key matched it on «%sale%» →
-- 'cash_sale' (a RECEIPT category), found no payment category with that key and fell back to «نثريات / مصاريف غير
-- مبوّبة» — PV-3031 (5,650, IN04916) sat under «نثريات». Now any '%refund%' till row maps to 'customer_return' when
-- money goes out ('other_receipt' when it comes in), before the «sale» rule; PV-3031 and any voucher like it move to
-- «مرتجعات للعملاء». Only the category changes: amount, date, till and ledger untouched (the category posts no journal
-- for contact money).

CREATE OR REPLACE FUNCTION public.map_treasury_to_category_key(_t treasury)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  cat TEXT := COALESCE(_t.category, '');
BEGIN
  IF _t.is_fee THEN RETURN 'transfer_fee'; END IF;
  -- payment plans (0069): money out to a supplier / money in from a customer, never an expense or other income
  IF cat = 'payment_out' THEN RETURN CASE WHEN _t.type='expense' THEN 'supplier_payment' ELSE 'other_receipt' END; END IF;
  IF cat = 'payment_in' THEN RETURN CASE WHEN _t.type='income' THEN 'installment' ELSE 'customer_return' END; END IF;
  -- 0126: money given back on a cancelled / returned document ('sales_refund', …) is a customer refund
  IF cat ILIKE '%refund%' THEN RETURN CASE WHEN _t.type='expense' THEN 'customer_return' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%capital_allocation%' THEN
    RETURN CASE WHEN _t.type='expense' THEN 'branch_transfer_out' ELSE 'branch_transfer_in' END;
  END IF;
  IF cat ILIKE '%advance_repayment%' THEN RETURN 'other_receipt'; END IF;
  IF cat ILIKE '%partner_contribution%' OR cat ILIKE '%partner_capital%' OR cat ILIKE '%رأس مال%' OR cat ILIKE '%راس مال%' THEN
    RETURN CASE WHEN _t.type='expense' THEN 'partner_withdrawal' ELSE 'partner_capital' END;
  END IF;
  IF cat ILIKE '%partner_withdraw%' OR cat ILIKE '%سحب شريك%' OR cat ILIKE '%سحب شركاء%' THEN RETURN 'partner_withdrawal'; END IF;
  IF cat ILIKE '%مورد%' OR cat ILIKE '%shipment%' OR cat ILIKE '%supplier%' THEN RETURN CASE WHEN _t.type='expense' THEN 'supplier_payment' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%راتب%' OR cat ILIKE '%salary%' THEN RETURN 'salary'; END IF;
  IF cat ILIKE '%سلف%' OR cat ILIKE '%advance%' THEN RETURN CASE WHEN _t.type='expense' THEN 'advance' ELSE 'other_receipt' END; END IF;
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

-- the vouchers already filed under «نثريات» for a refund till row (PV-3031)
UPDATE public.vouchers v
   SET category_id = public.get_system_category(v.tenant_id, 'payment', 'customer_return')
  FROM public.treasury t, public.voucher_categories c
 WHERE t.id = v.treasury_id AND c.id = v.category_id
   AND v.type = 'payment' AND v.source = 'system'
   AND t.category ILIKE '%refund%' AND c.system_key = 'other_payment'
   AND public.get_system_category(v.tenant_id, 'payment', 'customer_return') IS NOT NULL;
