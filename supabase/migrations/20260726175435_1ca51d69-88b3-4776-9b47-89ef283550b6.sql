
DROP TRIGGER IF EXISTS trg_balance_invoices ON public.invoices;
DROP TRIGGER IF EXISTS trg_balance_returns ON public.returns;
DROP TRIGGER IF EXISTS trg_balance_invoice_payments ON public.invoice_payments;
DROP TRIGGER IF EXISTS trg_balance_purchase_returns ON public.purchase_returns;
DROP TRIGGER IF EXISTS trg_balance_shipments ON public.shipments;
DROP TRIGGER IF EXISTS trg_balance_shipment_items ON public.shipment_items;
DROP TRIGGER IF EXISTS trg_balance_vouchers ON public.vouchers;
DROP TRIGGER IF EXISTS trg_balance_payment_transactions ON public.payment_transactions;
DROP TRIGGER IF EXISTS trg_balance_supplier_payments ON public.supplier_payments;

DROP FUNCTION IF EXISTS public.trg_refresh_contact_balance() CASCADE;
DROP FUNCTION IF EXISTS public.recalc_contact_balance(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.recalc_contact_balance() CASCADE;

ALTER TABLE public.contacts DROP COLUMN IF EXISTS balance;
