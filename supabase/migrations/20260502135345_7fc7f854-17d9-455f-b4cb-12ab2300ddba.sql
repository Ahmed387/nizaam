-- Trigger function: update supplier balance when shipment is added/updated/deleted
CREATE OR REPLACE FUNCTION public.update_supplier_balance_on_shipment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.suppliers
       SET balance = COALESCE(balance, 0) + COALESCE(NEW.total_cost, 0)
     WHERE id = NEW.supplier_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.supplier_id = OLD.supplier_id THEN
      UPDATE public.suppliers
         SET balance = COALESCE(balance, 0) + (COALESCE(NEW.total_cost, 0) - COALESCE(OLD.total_cost, 0))
       WHERE id = NEW.supplier_id;
    ELSE
      UPDATE public.suppliers
         SET balance = COALESCE(balance, 0) - COALESCE(OLD.total_cost, 0)
       WHERE id = OLD.supplier_id;
      UPDATE public.suppliers
         SET balance = COALESCE(balance, 0) + COALESCE(NEW.total_cost, 0)
       WHERE id = NEW.supplier_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.suppliers
       SET balance = COALESCE(balance, 0) - COALESCE(OLD.total_cost, 0)
     WHERE id = OLD.supplier_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_supplier_balance ON public.shipments;
CREATE TRIGGER trg_shipments_supplier_balance
AFTER INSERT OR UPDATE OR DELETE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.update_supplier_balance_on_shipment();

-- Trigger function: update supplier balance when payment is added/updated/deleted
CREATE OR REPLACE FUNCTION public.update_supplier_balance_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.suppliers
       SET balance = COALESCE(balance, 0) - COALESCE(NEW.amount, 0)
     WHERE id = NEW.supplier_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.supplier_id = OLD.supplier_id THEN
      UPDATE public.suppliers
         SET balance = COALESCE(balance, 0) - (COALESCE(NEW.amount, 0) - COALESCE(OLD.amount, 0))
       WHERE id = NEW.supplier_id;
    ELSE
      UPDATE public.suppliers
         SET balance = COALESCE(balance, 0) + COALESCE(OLD.amount, 0)
       WHERE id = OLD.supplier_id;
      UPDATE public.suppliers
         SET balance = COALESCE(balance, 0) - COALESCE(NEW.amount, 0)
       WHERE id = NEW.supplier_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.suppliers
       SET balance = COALESCE(balance, 0) + COALESCE(OLD.amount, 0)
     WHERE id = OLD.supplier_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payments_balance ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payments_balance
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.update_supplier_balance_on_payment();

-- One-time recalculation of all suppliers' balances based on existing data
UPDATE public.suppliers s
SET balance = COALESCE(
  (SELECT SUM(total_cost) FROM public.shipments WHERE supplier_id = s.id), 0
) - COALESCE(
  (SELECT SUM(amount) FROM public.supplier_payments WHERE supplier_id = s.id), 0
);