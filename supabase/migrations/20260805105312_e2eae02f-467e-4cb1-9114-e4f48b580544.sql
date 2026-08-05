ALTER TABLE public.price_audit_log DROP CONSTRAINT IF EXISTS price_audit_log_price_type_check;
ALTER TABLE public.price_audit_log ADD CONSTRAINT price_audit_log_price_type_check
CHECK (price_type = ANY (ARRAY['selling_price','cost_price','market_price','min_price','discount_limit','shipping_cost','true_unit_cost','cancel','void','edit','create','delete','refund']));