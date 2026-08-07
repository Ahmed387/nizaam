CREATE OR REPLACE FUNCTION public.guard_return_item_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice uuid;
  v_qty numeric;
  v_line_total numeric;
  v_unit numeric;
  v_max numeric;
BEGIN
  SELECT invoice_id INTO v_invoice FROM public.returns WHERE id = NEW.return_id;
  IF v_invoice IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(total),0)
    INTO v_qty, v_line_total
  FROM public.invoice_items
  WHERE invoice_id = v_invoice AND product_id = NEW.product_id;

  IF v_qty <= 0 THEN RETURN NEW; END IF;

  v_unit := v_line_total / v_qty;
  v_max := ROUND(v_unit * NEW.quantity, 2) + 0.05;

  IF COALESCE(NEW.refund,0) < 0 THEN
    RAISE EXCEPTION 'مبلغ الاسترداد لا يمكن أن يكون سالباً';
  END IF;

  IF COALESCE(NEW.refund,0) > v_max THEN
    RAISE EXCEPTION 'مبلغ الاسترداد (%) أكبر من قيمة الصنف في الفاتورة (%)',
      ROUND(NEW.refund,2), ROUND(v_unit * NEW.quantity, 2);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_return_item_refund ON public.return_items;
CREATE TRIGGER trg_guard_return_item_refund
BEFORE INSERT OR UPDATE ON public.return_items
FOR EACH ROW EXECUTE FUNCTION public.guard_return_item_refund();

CREATE OR REPLACE FUNCTION public.guard_purchase_return_item_value()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shipment uuid;
  v_qty numeric;
  v_total numeric;
  v_unit numeric;
BEGIN
  SELECT shipment_id INTO v_shipment FROM public.purchase_returns WHERE id = NEW.purchase_return_id;
  IF v_shipment IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(total),0)
    INTO v_qty, v_total
  FROM public.shipment_items
  WHERE shipment_id = v_shipment AND product_id = NEW.product_id;

  IF v_qty <= 0 THEN RETURN NEW; END IF;
  v_unit := v_total / v_qty;

  IF COALESCE(NEW.unit_cost,0) < 0 OR COALESCE(NEW.total,0) < 0 THEN
    RAISE EXCEPTION 'قيمة مرتجع الشراء لا يمكن أن تكون سالبة';
  END IF;

  IF COALESCE(NEW.total,0) > ROUND(v_unit * NEW.quantity, 2) + 0.05 THEN
    RAISE EXCEPTION 'قيمة مرتجع الشراء (%) أكبر من قيمة الصنف في فاتورة الشراء (%)',
      ROUND(NEW.total,2), ROUND(v_unit * NEW.quantity, 2);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_purchase_return_item_value ON public.purchase_return_items;
CREATE TRIGGER trg_guard_purchase_return_item_value
BEFORE INSERT OR UPDATE ON public.purchase_return_items
FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_return_item_value();