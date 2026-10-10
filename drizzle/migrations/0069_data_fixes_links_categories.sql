-- 0069 — Data fixes found in the review (already applied on the test project uzqiwxxmzjdgkfbskmzg).
-- Idempotent: safe to re-run.

-- 1) Wrong customer↔supplier link: receipt vouchers from "both" contacts had been booked on the SUPPLIER side
--    ("refund from supplier") — 226 vouchers, ≈3.1M. Money received from someone we never bought from, or a
--    customer instalment, is a CUSTOMER collection. The unified ledger re-syncs the contact automatically.
--    (The 405 receipts left on the supplier side belong to contacts we DO buy from — mostly branches set up as
--    contacts; they need the owner's decision, see the report.)
WITH fix AS (
  SELECT v.id FROM public.vouchers v LEFT JOIN public.voucher_categories vc ON vc.id = v.category_id
   WHERE v.type = 'receipt' AND v.party_type = 'supplier' AND v.status = 'active'
     AND (vc.system_key = 'installment'
          OR NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.contact_id = v.party_id AND s.status = 'active')))
UPDATE public.vouchers v SET party_type = 'customer', flow_class = 'customer' FROM fix WHERE v.id = fix.id;

-- 2) Purchase-plan instalments paid to suppliers were filed under "نثريات / مصاريف غير مبوّبة" (an expense
--    deducted from profit) — 89 vouchers. They are supplier payments. Customer plan receipts → "تحصيل أقساط".
WITH sp AS (SELECT tenant_id, id FROM public.voucher_categories WHERE system_key = 'supplier_payment' AND type = 'payment')
UPDATE public.vouchers v SET category_id = sp.id, flow_class = 'supplier'
  FROM public.voucher_categories c, sp
 WHERE c.id = v.category_id AND c.system_key = 'other_payment' AND sp.tenant_id = v.tenant_id
   AND v.type = 'payment' AND v.description LIKE 'دفعة خطة #%';
WITH ic AS (SELECT tenant_id, id FROM public.voucher_categories WHERE system_key = 'installment' AND type = 'receipt')
UPDATE public.vouchers v SET category_id = ic.id
  FROM public.voucher_categories c, ic, public.treasury t
 WHERE c.id = v.category_id AND c.system_key = 'other_receipt' AND ic.tenant_id = v.tenant_id
   AND v.type = 'receipt' AND t.id = v.treasury_id AND t.category = 'payment_in';

-- 3) …and new plan payments get the right category from now on.
DO $$ DECLARE d text; n text; BEGIN
  d := pg_get_functiondef('public.map_treasury_to_category_key'::regproc);
  IF position('payment_out' IN d) = 0 THEN
    n := replace(d, $x$  IF _t.is_fee THEN RETURN 'transfer_fee'; END IF;$x$,
      $x$  IF _t.is_fee THEN RETURN 'transfer_fee'; END IF;
  -- payment plans (0069): money out to a supplier / money in from a customer, never an expense or other income
  IF cat = 'payment_out' THEN RETURN CASE WHEN _t.type='expense' THEN 'supplier_payment' ELSE 'other_receipt' END; END IF;
  IF cat = 'payment_in' THEN RETURN CASE WHEN _t.type='income' THEN 'installment' ELSE 'customer_return' END; END IF;$x$);
    IF n = d THEN RAISE EXCEPTION 'map_treasury_to_category_key: text not found'; END IF;
    EXECUTE n;
  END IF;
END $$;

-- 4) The contact «اسامه الراعي» (all of his documents were purged earlier) — owner asked to remove the account too.
DELETE FROM public.contacts c
 WHERE c.name = 'اسامه الراعي'
   AND NOT EXISTS (SELECT 1 FROM public.invoices WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.shipments WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.money_movements WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.payment_allocations WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.purchase_returns WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.payment_transactions WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.customer_credit_log WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.ledger_credit_balance_snapshot WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.pre_orders WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.quotes WHERE contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.supplier_payments WHERE contact_id = c.id);
