
-- 1) Drop old triggers + functions
DROP TRIGGER IF EXISTS trg_shipments_supplier_balance ON public.shipments;
DROP TRIGGER IF EXISTS trg_supplier_payments_balance ON public.supplier_payments;
DROP TRIGGER IF EXISTS trg_protect_customer_delete ON public.customers;
DROP TRIGGER IF EXISTS trg_protect_supplier_delete ON public.suppliers;
DROP FUNCTION IF EXISTS public.update_supplier_balance_on_shipment() CASCADE;
DROP FUNCTION IF EXISTS public.update_supplier_balance_on_payment() CASCADE;
DROP FUNCTION IF EXISTS public.protect_customer_delete() CASCADE;
DROP FUNCTION IF EXISTS public.protect_supplier_delete() CASCADE;

-- 2) Drop FK constraints on dependents (cascade keeps columns)
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_customer_id_fkey;
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_customer_id_fkey;
ALTER TABLE public.pre_orders DROP CONSTRAINT IF EXISTS pre_orders_customer_id_fkey;
ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_supplier_id_fkey;
ALTER TABLE public.purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_supplier_id_fkey;
ALTER TABLE public.supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_supplier_id_fkey;

-- 3) Rename columns to contact_id
ALTER TABLE public.invoices RENAME COLUMN customer_id TO contact_id;
ALTER TABLE public.quotes RENAME COLUMN customer_id TO contact_id;
ALTER TABLE public.pre_orders RENAME COLUMN customer_id TO contact_id;
ALTER TABLE public.shipments RENAME COLUMN supplier_id TO contact_id;
ALTER TABLE public.purchase_returns RENAME COLUMN supplier_id TO contact_id;
ALTER TABLE public.supplier_payments RENAME COLUMN supplier_id TO contact_id;

-- 4) Drop old tables
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.suppliers CASCADE;

-- 5) Create unified contacts table
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_person text,
  phone text,
  address text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'both' CHECK (type IN ('customer','supplier','both')),
  balance numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_tenant ON public.contacts(tenant_id);
CREATE INDEX idx_contacts_branch ON public.contacts(branch_id);
CREATE INDEX idx_contacts_phone ON public.contacts(phone);

-- 6) GRANTs + RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_read" ON public.contacts FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'viewer'::app_role)
    OR branch_id IS NULL
    OR user_in_branch(auth.uid(), branch_id)
  ))
);

CREATE POLICY "contacts_write" ON public.contacts FOR ALL
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR (branch_id IS NULL AND (
      has_role(auth.uid(), 'branch_manager'::app_role)
      OR has_role(auth.uid(), 'warehouse'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
    ))
    OR (branch_id IS NOT NULL AND user_in_branch(auth.uid(), branch_id))
  ))
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR (branch_id IS NULL AND (
      has_role(auth.uid(), 'branch_manager'::app_role)
      OR has_role(auth.uid(), 'warehouse'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
    ))
    OR (branch_id IS NOT NULL AND user_in_branch(auth.uid(), branch_id))
  ))
);

CREATE POLICY "contacts_suspended" ON public.contacts AS RESTRICTIVE FOR ALL
USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended())
WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());

-- tenant auto-fill + audit
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();
CREATE TRIGGER audit_contacts AFTER DELETE OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- 7) FKs from dependents to contacts
ALTER TABLE public.invoices ADD CONSTRAINT invoices_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.pre_orders ADD CONSTRAINT pre_orders_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_returns ADD CONSTRAINT purchase_returns_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT;

-- 8) Balance triggers (sign: + = owed to us, - = we owe them)
CREATE OR REPLACE FUNCTION public.contact_balance_apply(_contact uuid, _delta numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.contacts SET balance = COALESCE(balance,0) + _delta WHERE id = _contact;
$$;

-- shipment received => we owe the supplier
CREATE OR REPLACE FUNCTION public.tg_shipments_contact_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM contact_balance_apply(NEW.contact_id, -COALESCE(NEW.total_cost,0));
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.contact_id = OLD.contact_id THEN
      PERFORM contact_balance_apply(NEW.contact_id, -(COALESCE(NEW.total_cost,0) - COALESCE(OLD.total_cost,0)));
    ELSE
      PERFORM contact_balance_apply(OLD.contact_id, COALESCE(OLD.total_cost,0));
      PERFORM contact_balance_apply(NEW.contact_id, -COALESCE(NEW.total_cost,0));
    END IF;
  ELSIF TG_OP='DELETE' THEN
    PERFORM contact_balance_apply(OLD.contact_id, COALESCE(OLD.total_cost,0));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_shipments_contact_balance
AFTER INSERT OR UPDATE OR DELETE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.tg_shipments_contact_balance();

-- supplier payment => we paid them
CREATE OR REPLACE FUNCTION public.tg_supplier_payments_contact_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM contact_balance_apply(NEW.contact_id, COALESCE(NEW.amount,0));
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.contact_id = OLD.contact_id THEN
      PERFORM contact_balance_apply(NEW.contact_id, COALESCE(NEW.amount,0) - COALESCE(OLD.amount,0));
    ELSE
      PERFORM contact_balance_apply(OLD.contact_id, -COALESCE(OLD.amount,0));
      PERFORM contact_balance_apply(NEW.contact_id, COALESCE(NEW.amount,0));
    END IF;
  ELSIF TG_OP='DELETE' THEN
    PERFORM contact_balance_apply(OLD.contact_id, -COALESCE(OLD.amount,0));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_supplier_payments_contact_balance
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_supplier_payments_contact_balance();

-- purchase return => supplier refunds us
CREATE OR REPLACE FUNCTION public.tg_purchase_returns_contact_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM contact_balance_apply(NEW.contact_id, COALESCE(NEW.total_amount,0));
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.contact_id = OLD.contact_id THEN
      PERFORM contact_balance_apply(NEW.contact_id, COALESCE(NEW.total_amount,0) - COALESCE(OLD.total_amount,0));
    ELSE
      PERFORM contact_balance_apply(OLD.contact_id, -COALESCE(OLD.total_amount,0));
      PERFORM contact_balance_apply(NEW.contact_id, COALESCE(NEW.total_amount,0));
    END IF;
  ELSIF TG_OP='DELETE' THEN
    PERFORM contact_balance_apply(OLD.contact_id, -COALESCE(OLD.total_amount,0));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_purchase_returns_contact_balance
AFTER INSERT OR UPDATE OR DELETE ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_purchase_returns_contact_balance();

-- 9) Protect delete: forbid deleting contact with related history
CREATE OR REPLACE FUNCTION public.protect_contact_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices WHERE contact_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.shipments WHERE contact_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.purchase_returns WHERE contact_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.supplier_payments WHERE contact_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.pre_orders WHERE contact_id = OLD.id) THEN
    RAISE EXCEPTION 'لا يمكن حذف جهة اتصال لها عمليات مرتبطة';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER trg_protect_contact_delete BEFORE DELETE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.protect_contact_delete();

-- 10) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;
