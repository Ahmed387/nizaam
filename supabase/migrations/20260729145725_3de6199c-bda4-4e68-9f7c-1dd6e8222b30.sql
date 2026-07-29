
-- 1) Drop duplicate audit triggers (keep the older `audit_trigger` which stores full old/new snapshot)
DROP TRIGGER IF EXISTS trg_audit_invoices ON public.invoices;
DROP TRIGGER IF EXISTS trg_audit_products ON public.products;
DROP TRIGGER IF EXISTS trg_audit_returns ON public.returns;
DROP TRIGGER IF EXISTS trg_audit_stock_transfers ON public.stock_transfers;
DROP TRIGGER IF EXISTS trg_audit_supplier_payments ON public.supplier_payments;
DROP TRIGGER IF EXISTS trg_audit_treasury_transfers ON public.treasury_transfers;
DROP TRIGGER IF EXISTS trg_audit_price_list_items ON public.price_list_items;

-- 2) Harden trigger functions with SET search_path
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
