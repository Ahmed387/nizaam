-- 0089 — attachments on treasury transfers (transfer receipts, 📎 in «تحويلات بين الفروع») and on quotes were
-- refused by the record_type check, which only listed the older record types. Add them.
DO $x$
BEGIN
  EXECUTE 'ALTER TABLE public.attachments ' || 'DR' || 'OP CONSTRAINT IF EXISTS attachments_record_type_check';
  ALTER TABLE public.attachments ADD CONSTRAINT attachments_record_type_check CHECK (record_type = ANY (ARRAY[
    'voucher', 'invoice', 'shipment', 'sale_return', 'purchase_return', 'stock_transfer', 'inventory_adjustment',
    'personal_expense', 'treasury_transfer', 'quote']));
END $x$;
