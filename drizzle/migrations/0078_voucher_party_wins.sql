-- 0078 — A payment voucher to a named CUSTOMER is money given back to that customer, whatever category was
-- picked. 57 imported payment vouchers (701,690) had party = customer but category «مدفوعات موردين», so the
-- payment-voucher card counted them as «اتدفع للموردين» while the ledger (correctly) put them on the
-- customer side as refunds. The party now wins over the category; the 57 rows are reclassified.
-- Only vouchers.flow_class (a card label) changes — no amount, till row, ledger row or journal entry.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.voucher_flow_class_of'::regproc);
  IF position('(0078)' in d) = 0 THEN
    d := replace(d, E'    ELSE CASE\n      WHEN p_party_type = ''supplier'' OR c.system_key = ''supplier_payment''',
                    E'    ELSE CASE\n      -- a payment to a named customer is money given back to that customer, whatever category was picked (0078)\n      WHEN p_party_type = ''customer'' THEN ''customer_refund''\n      WHEN p_party_type = ''supplier'' OR c.system_key = ''supplier_payment''');
    IF position('(0078)' in d) = 0 THEN RAISE EXCEPTION '0078: voucher_flow_class_of patch failed'; END IF;
    EXECUTE d;
  END IF;
END $$;

UPDATE public.vouchers SET flow_class = 'customer_refund'
 WHERE status = 'active' AND type = 'payment' AND flow_class = 'supplier' AND party_type = 'customer';
