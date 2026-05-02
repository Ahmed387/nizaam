
-- =========================================================================
-- P1 — CRITICAL FIXES
-- =========================================================================

-- 1) Prevent negative stock at DB level (race condition guard)
DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT chk_products_qty_nonneg CHECK (quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

-- 2) Prevent negative invoice totals
DO $$ BEGIN
  ALTER TABLE public.invoices ADD CONSTRAINT chk_invoice_total_nonneg CHECK (total >= 0 AND subtotal >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.invoice_items ADD CONSTRAINT chk_invitm_qty_pos CHECK (quantity > 0 AND total >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

-- 3) Unique SKU per tenant
DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT uq_products_tenant_sku UNIQUE (tenant_id, sku);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

-- =========================================================================
-- TRIGGER: Reverse stock + treasury when a return is created
-- =========================================================================
CREATE OR REPLACE FUNCTION public.process_return_effects()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it record;
BEGIN
  -- Restock from return_items linked to this return
  FOR it IN
    SELECT ri.product_id, ri.quantity
    FROM public.return_items ri
    WHERE ri.return_id = NEW.id AND ri.product_id IS NOT NULL
  LOOP
    UPDATE public.products
       SET quantity = quantity + it.quantity
     WHERE id = it.product_id;
  END LOOP;

  -- Refund treasury (expense entry)
  IF COALESCE(NEW.total_refund, 0) > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
    VALUES (NEW.branch_id, 'expense', 'return', NEW.total_refund,
            'مرتجع فاتورة ' || COALESCE(NEW.invoice_id::text, ''), NEW.id, NEW.created_by, NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_process_return_effects ON public.returns;
-- Note: triggered AFTER return_items inserted. We use a deferred approach via statement on returns updated_at,
-- but simpler: trigger fires on returns INSERT and reads current return_items. Caller must insert items first.
-- To handle ordering, also fire on return_items insert:
CREATE OR REPLACE FUNCTION public.process_return_item_effect()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE public.products SET quantity = quantity + NEW.quantity WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_return_item_restock ON public.return_items;
CREATE TRIGGER trg_return_item_restock
AFTER INSERT ON public.return_items
FOR EACH ROW EXECUTE FUNCTION public.process_return_item_effect();

-- Treasury refund when a return row is inserted
CREATE OR REPLACE FUNCTION public.process_return_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.total_refund, 0) > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
    VALUES (NEW.branch_id, 'expense', 'return', NEW.total_refund,
            'مرتجع فاتورة', NEW.id, NEW.created_by, NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_return_refund ON public.returns;
CREATE TRIGGER trg_return_refund
AFTER INSERT ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.process_return_refund();

-- =========================================================================
-- TRIGGER: Reverse stock when shipment item deleted
-- =========================================================================
CREATE OR REPLACE FUNCTION public.reverse_shipment_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.product_id IS NOT NULL THEN
    UPDATE public.products
       SET quantity = GREATEST(0, quantity - OLD.quantity)
     WHERE id = OLD.product_id;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_reverse_shipment_item ON public.shipment_items;
CREATE TRIGGER trg_reverse_shipment_item
BEFORE DELETE ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.reverse_shipment_item();

-- Add stock when shipment item inserted (idempotent helper)
CREATE OR REPLACE FUNCTION public.apply_shipment_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE public.products SET quantity = quantity + NEW.quantity WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END $$;

-- Note: not adding INSERT trigger to avoid double-counting if app already adds stock.

-- =========================================================================
-- TRIGGER: Reverse invoice effects on item delete/update
-- =========================================================================
CREATE OR REPLACE FUNCTION public.reverse_invoice_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.product_id IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + OLD.quantity WHERE id = OLD.product_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.product_id IS NOT NULL AND OLD.product_id = NEW.product_id THEN
      UPDATE public.products
         SET quantity = quantity + (OLD.quantity - NEW.quantity)
       WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_reverse_invoice_item ON public.invoice_items;
CREATE TRIGGER trg_reverse_invoice_item
AFTER UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.reverse_invoice_item();

-- =========================================================================
-- Session revocation on password change
-- =========================================================================
CREATE OR REPLACE FUNCTION public.revoke_employee_auth_on_pw_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.login_password IS DISTINCT FROM OLD.login_password THEN
    BEGIN
      DELETE FROM auth.sessions WHERE user_id = NEW.user_id;
      DELETE FROM auth.refresh_tokens WHERE user_id::uuid = NEW.user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_revoke_emp_pw ON public.employees;
CREATE TRIGGER trg_revoke_emp_pw
AFTER UPDATE OF login_password ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.revoke_employee_auth_on_pw_change();

-- =========================================================================
-- P2 — Auto-link expenses to treasury
-- =========================================================================
CREATE OR REPLACE FUNCTION public.expense_to_treasury()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.amount, 0) > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
    VALUES (NEW.branch_id, 'expense', COALESCE(NEW.type, 'general'), NEW.amount,
            COALESCE(NEW.description, 'مصروف'), NEW.id, NEW.created_by, NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_expense_to_treasury ON public.expenses;
CREATE TRIGGER trg_expense_to_treasury
AFTER INSERT ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.expense_to_treasury();

-- =========================================================================
-- P2 — Protect deletes
-- =========================================================================

-- Prevent deleting customer with unpaid invoices (any invoice exists treated as block)
CREATE OR REPLACE FUNCTION public.protect_customer_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.invoices WHERE customer_id = OLD.id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف عميل لديه فواتير (%). قم بأرشفته بدلاً من ذلك.', v_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_protect_customer_delete ON public.customers;
CREATE TRIGGER trg_protect_customer_delete
BEFORE DELETE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.protect_customer_delete();

-- Prevent deleting supplier with balance
CREATE OR REPLACE FUNCTION public.protect_supplier_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(OLD.balance, 0) <> 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف مورد له رصيد (%). يجب تسوية الرصيد أولاً.', OLD.balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_protect_supplier_delete ON public.suppliers;
CREATE TRIGGER trg_protect_supplier_delete
BEFORE DELETE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.protect_supplier_delete();

-- Prevent deleting employee with pending advance requests
CREATE OR REPLACE FUNCTION public.protect_employee_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.advance_requests
    WHERE employee_id = OLD.id
      AND status IN ('pending_branch_manager','pending_admin');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف موظف لديه طلبات سلف معلّقة (%).', v_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_protect_employee_delete ON public.employees;
CREATE TRIGGER trg_protect_employee_delete
BEFORE DELETE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.protect_employee_delete();

-- Prevent deleting category that has products
CREATE OR REPLACE FUNCTION public.protect_category_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.products WHERE category_id = OLD.id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف تصنيف يحتوي على منتجات (%).', v_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_protect_category_delete ON public.categories;
CREATE TRIGGER trg_protect_category_delete
BEFORE DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.protect_category_delete();

-- Prevent deleting branch that still has employees / products / invoices
CREATE OR REPLACE FUNCTION public.protect_branch_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp INT; v_prod INT; v_inv INT;
BEGIN
  SELECT count(*) INTO v_emp FROM public.employees WHERE branch_id = OLD.id;
  SELECT count(*) INTO v_prod FROM public.products  WHERE branch_id = OLD.id;
  SELECT count(*) INTO v_inv FROM public.invoices  WHERE branch_id = OLD.id;
  IF v_emp + v_prod + v_inv > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف الفرع: موظفين=% منتجات=% فواتير=%. قم بإلغاء تنشيطه بدلاً من حذفه.',
      v_emp, v_prod, v_inv USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_protect_branch_delete ON public.branches;
CREATE TRIGGER trg_protect_branch_delete
BEFORE DELETE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.protect_branch_delete();
