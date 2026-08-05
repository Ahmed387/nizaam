ALTER TABLE public.price_audit_log DROP CONSTRAINT IF EXISTS price_audit_log_entity_type_check;
ALTER TABLE public.price_audit_log ADD CONSTRAINT price_audit_log_entity_type_check
CHECK (entity_type = ANY (ARRAY['product','shipment','branch_settings','price_list','product_batch','sale_return','purchase_return','invoice','voucher','stock_adjustment','stock_transfer']));