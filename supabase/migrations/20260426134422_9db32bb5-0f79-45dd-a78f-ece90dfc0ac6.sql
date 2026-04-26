
-- 1. Create tenants table
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  primary_color text DEFAULT '#6366f1',
  is_active boolean NOT NULL DEFAULT true,
  plan text NOT NULL DEFAULT 'free',
  max_branches integer NOT NULL DEFAULT 1,
  max_products integer NOT NULL DEFAULT 100,
  max_users integer NOT NULL DEFAULT 3,
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 2. Seed initial tenant
INSERT INTO public.tenants (name, slug, plan, max_branches, max_products, max_users)
VALUES ('A & N', 'a-n', 'enterprise', 999, 99999, 999);

-- 3. Add tenant_id to all tables
DO $$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'a-n';

  ALTER TABLE public.branches ADD COLUMN tenant_id uuid;
  UPDATE public.branches SET tenant_id = v_tenant_id;
  ALTER TABLE public.branches ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.profiles ADD COLUMN tenant_id uuid;
  UPDATE public.profiles SET tenant_id = v_tenant_id;

  ALTER TABLE public.user_roles ADD COLUMN tenant_id uuid;
  UPDATE public.user_roles SET tenant_id = v_tenant_id;

  ALTER TABLE public.branch_users ADD COLUMN tenant_id uuid;
  UPDATE public.branch_users SET tenant_id = v_tenant_id;
  ALTER TABLE public.branch_users ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.categories ADD COLUMN tenant_id uuid;
  UPDATE public.categories SET tenant_id = v_tenant_id;
  ALTER TABLE public.categories ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.products ADD COLUMN tenant_id uuid;
  UPDATE public.products SET tenant_id = v_tenant_id;
  ALTER TABLE public.products ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.customers ADD COLUMN tenant_id uuid;
  UPDATE public.customers SET tenant_id = v_tenant_id;
  ALTER TABLE public.customers ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.suppliers ADD COLUMN tenant_id uuid;
  UPDATE public.suppliers SET tenant_id = v_tenant_id;
  ALTER TABLE public.suppliers ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.employees ADD COLUMN tenant_id uuid;
  UPDATE public.employees SET tenant_id = v_tenant_id;
  ALTER TABLE public.employees ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.invoices ADD COLUMN tenant_id uuid;
  UPDATE public.invoices SET tenant_id = v_tenant_id;
  ALTER TABLE public.invoices ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.invoice_items ADD COLUMN tenant_id uuid;
  UPDATE public.invoice_items SET tenant_id = v_tenant_id;
  ALTER TABLE public.invoice_items ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.returns ADD COLUMN tenant_id uuid;
  UPDATE public.returns SET tenant_id = v_tenant_id;
  ALTER TABLE public.returns ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.return_items ADD COLUMN tenant_id uuid;
  UPDATE public.return_items SET tenant_id = v_tenant_id;
  ALTER TABLE public.return_items ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.shipments ADD COLUMN tenant_id uuid;
  UPDATE public.shipments SET tenant_id = v_tenant_id;
  ALTER TABLE public.shipments ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.shipment_items ADD COLUMN tenant_id uuid;
  UPDATE public.shipment_items SET tenant_id = v_tenant_id;
  ALTER TABLE public.shipment_items ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.expenses ADD COLUMN tenant_id uuid;
  UPDATE public.expenses SET tenant_id = v_tenant_id;
  ALTER TABLE public.expenses ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.treasury ADD COLUMN tenant_id uuid;
  UPDATE public.treasury SET tenant_id = v_tenant_id;
  ALTER TABLE public.treasury ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.treasury_transfers ADD COLUMN tenant_id uuid;
  UPDATE public.treasury_transfers SET tenant_id = v_tenant_id;
  ALTER TABLE public.treasury_transfers ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.stock_transfers ADD COLUMN tenant_id uuid;
  UPDATE public.stock_transfers SET tenant_id = v_tenant_id;
  ALTER TABLE public.stock_transfers ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.advances ADD COLUMN tenant_id uuid;
  UPDATE public.advances SET tenant_id = v_tenant_id;
  ALTER TABLE public.advances ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.advance_payments ADD COLUMN tenant_id uuid;
  UPDATE public.advance_payments SET tenant_id = v_tenant_id;
  ALTER TABLE public.advance_payments ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.salaries ADD COLUMN tenant_id uuid;
  UPDATE public.salaries SET tenant_id = v_tenant_id;
  ALTER TABLE public.salaries ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.price_list ADD COLUMN tenant_id uuid;
  UPDATE public.price_list SET tenant_id = v_tenant_id;
  ALTER TABLE public.price_list ALTER COLUMN tenant_id SET NOT NULL;

  ALTER TABLE public.audit_log ADD COLUMN tenant_id uuid;
  UPDATE public.audit_log SET tenant_id = v_tenant_id;

  ALTER TABLE public.settings ADD COLUMN tenant_id uuid;
  UPDATE public.settings SET tenant_id = v_tenant_id;
END $$;

-- 4. Foreign keys
ALTER TABLE public.branches ADD CONSTRAINT branches_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.branch_users ADD CONSTRAINT branch_users_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.categories ADD CONSTRAINT categories_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT products_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.customers ADD CONSTRAINT customers_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.employees ADD CONSTRAINT employees_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.returns ADD CONSTRAINT returns_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.return_items ADD CONSTRAINT return_items_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.shipment_items ADD CONSTRAINT shipment_items_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.treasury ADD CONSTRAINT treasury_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.treasury_transfers ADD CONSTRAINT treasury_transfers_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.advances ADD CONSTRAINT advances_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.advance_payments ADD CONSTRAINT advance_payments_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.salaries ADD CONSTRAINT salaries_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.price_list ADD CONSTRAINT price_list_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.settings ADD CONSTRAINT settings_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- 5. Tenant-scoped uniques
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_code_key;
CREATE UNIQUE INDEX branches_tenant_code_uniq ON public.branches(tenant_id, code);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX products_tenant_sku_uniq ON public.products(tenant_id, sku);
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;
CREATE UNIQUE INDEX invoices_tenant_number_uniq ON public.invoices(tenant_id, invoice_number);

-- 6. Helper functions
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin', 'super_admin'))
$$;

-- 7. Update handle_new_user to set tenant from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := NULLIF(NEW.raw_user_meta_data->>'tenant_id','')::uuid;
  INSERT INTO public.profiles (id, name, username, tenant_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    v_tenant_id
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8. Promote admin@an.com to super_admin
INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT u.id, 'super_admin', NULL FROM auth.users u WHERE u.email = 'admin@an.com'
ON CONFLICT DO NOTHING;

-- 9. RLS policies
-- TENANTS
CREATE POLICY tenants_super_all ON public.tenants FOR ALL
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY tenants_member_read ON public.tenants FOR SELECT
  USING (id = current_tenant_id() OR is_super_admin(auth.uid()));

-- BRANCHES
DROP POLICY IF EXISTS branches_admin_all ON public.branches;
DROP POLICY IF EXISTS branches_read ON public.branches;
CREATE POLICY branches_read ON public.branches FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY branches_write ON public.branches FOR ALL
  USING ((tenant_id = current_tenant_id() AND is_admin(auth.uid())) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND is_admin(auth.uid())) OR is_super_admin(auth.uid()));

-- PROFILES
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_insert ON public.profiles;
CREATE POLICY profiles_read ON public.profiles FOR SELECT
  USING (auth.uid() = id OR is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));
CREATE POLICY profiles_update ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));
CREATE POLICY profiles_insert ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id OR is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));

-- USER_ROLES
DROP POLICY IF EXISTS roles_admin_all ON public.user_roles;
DROP POLICY IF EXISTS roles_read ON public.user_roles;
CREATE POLICY user_roles_read ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id OR is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));
CREATE POLICY user_roles_write ON public.user_roles FOR ALL
  USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())))
  WITH CHECK (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));

-- BRANCH_USERS
DROP POLICY IF EXISTS branch_users_admin_all ON public.branch_users;
DROP POLICY IF EXISTS branch_users_read ON public.branch_users;
CREATE POLICY branch_users_read ON public.branch_users FOR SELECT
  USING (auth.uid() = user_id OR is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));
CREATE POLICY branch_users_write ON public.branch_users FOR ALL
  USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())))
  WITH CHECK (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));

-- CATEGORIES
DROP POLICY IF EXISTS cat_admin_all ON public.categories;
DROP POLICY IF EXISTS cat_read ON public.categories;
CREATE POLICY cat_read ON public.categories FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY cat_write ON public.categories FOR ALL
  USING ((tenant_id = current_tenant_id() AND is_admin(auth.uid())) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND is_admin(auth.uid())) OR is_super_admin(auth.uid()));

-- PRICE_LIST
DROP POLICY IF EXISTS pl_admin_all ON public.price_list;
DROP POLICY IF EXISTS pl_read ON public.price_list;
CREATE POLICY pl_read ON public.price_list FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY pl_write ON public.price_list FOR ALL
  USING ((tenant_id = current_tenant_id() AND is_admin(auth.uid())) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND is_admin(auth.uid())) OR is_super_admin(auth.uid()));

-- SUPPLIERS
DROP POLICY IF EXISTS sup_read ON public.suppliers;
DROP POLICY IF EXISTS sup_write ON public.suppliers;
CREATE POLICY sup_read ON public.suppliers FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY sup_write ON public.suppliers FOR ALL TO authenticated
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))) OR is_super_admin(auth.uid()));

-- PRODUCTS
DROP POLICY IF EXISTS prod_read ON public.products;
DROP POLICY IF EXISTS prod_write ON public.products;
CREATE POLICY prod_read ON public.products FOR SELECT
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY prod_write ON public.products FOR ALL
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND (has_role(auth.uid(), 'branch_manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND (has_role(auth.uid(), 'branch_manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))))) OR is_super_admin(auth.uid()));

-- CUSTOMERS
DROP POLICY IF EXISTS cust_read ON public.customers;
DROP POLICY IF EXISTS cust_write ON public.customers;
CREATE POLICY cust_read ON public.customers FOR SELECT
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY cust_write ON public.customers FOR ALL
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));

-- EMPLOYEES
DROP POLICY IF EXISTS emp_read ON public.employees;
DROP POLICY IF EXISTS emp_write ON public.employees;
CREATE POLICY emp_read ON public.employees FOR SELECT
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY emp_write ON public.employees FOR ALL
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role)))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role)))) OR is_super_admin(auth.uid()));

-- INVOICES
DROP POLICY IF EXISTS inv_insert ON public.invoices;
DROP POLICY IF EXISTS inv_read ON public.invoices;
DROP POLICY IF EXISTS inv_update ON public.invoices;
CREATE POLICY inv_read ON public.invoices FOR SELECT
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY inv_insert ON public.invoices FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id));
CREATE POLICY inv_update ON public.invoices FOR UPDATE
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role)))) OR is_super_admin(auth.uid()));

-- INVOICE_ITEMS
DROP POLICY IF EXISTS invitm_read ON public.invoice_items;
DROP POLICY IF EXISTS invitm_write ON public.invoice_items;
CREATE POLICY invitm_read ON public.invoice_items FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY invitm_write ON public.invoice_items FOR ALL
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()))
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));

-- RETURNS
DROP POLICY IF EXISTS ret_read ON public.returns;
DROP POLICY IF EXISTS ret_write ON public.returns;
CREATE POLICY ret_read ON public.returns FOR SELECT
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY ret_write ON public.returns FOR ALL
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));

-- RETURN_ITEMS
DROP POLICY IF EXISTS retitm_read ON public.return_items;
DROP POLICY IF EXISTS retitm_write ON public.return_items;
CREATE POLICY retitm_read ON public.return_items FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY retitm_write ON public.return_items FOR ALL
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()))
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));

-- SHIPMENTS
DROP POLICY IF EXISTS ship_read ON public.shipments;
DROP POLICY IF EXISTS ship_write ON public.shipments;
CREATE POLICY ship_read ON public.shipments FOR SELECT
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY ship_write ON public.shipments FOR ALL
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND (has_role(auth.uid(), 'branch_manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND (has_role(auth.uid(), 'branch_manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))))) OR is_super_admin(auth.uid()));

-- SHIPMENT_ITEMS
DROP POLICY IF EXISTS shipitm_read ON public.shipment_items;
DROP POLICY IF EXISTS shipitm_write ON public.shipment_items;
CREATE POLICY shipitm_read ON public.shipment_items FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY shipitm_write ON public.shipment_items FOR ALL
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()))
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));

-- EXPENSES
DROP POLICY IF EXISTS exp_read ON public.expenses;
DROP POLICY IF EXISTS exp_write ON public.expenses;
CREATE POLICY exp_read ON public.expenses FOR SELECT
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY exp_write ON public.expenses FOR ALL
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));

-- TREASURY
DROP POLICY IF EXISTS tr_read ON public.treasury;
DROP POLICY IF EXISTS tr_write ON public.treasury;
CREATE POLICY tr_read ON public.treasury FOR SELECT
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY tr_write ON public.treasury FOR ALL
  USING ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));

-- TREASURY_TRANSFERS
DROP POLICY IF EXISTS trt_read ON public.treasury_transfers;
DROP POLICY IF EXISTS trt_write ON public.treasury_transfers;
CREATE POLICY trt_read ON public.treasury_transfers FOR SELECT
  USING ((tenant_id = current_tenant_id() AND (user_in_branch(auth.uid(), from_branch_id) OR user_in_branch(auth.uid(), to_branch_id))) OR is_super_admin(auth.uid()));
CREATE POLICY trt_write ON public.treasury_transfers FOR ALL
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR user_in_branch(auth.uid(), from_branch_id))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR user_in_branch(auth.uid(), from_branch_id))) OR is_super_admin(auth.uid()));

-- STOCK_TRANSFERS
DROP POLICY IF EXISTS st_read ON public.stock_transfers;
DROP POLICY IF EXISTS st_write ON public.stock_transfers;
CREATE POLICY st_read ON public.stock_transfers FOR SELECT
  USING ((tenant_id = current_tenant_id() AND (user_in_branch(auth.uid(), from_branch_id) OR user_in_branch(auth.uid(), to_branch_id))) OR is_super_admin(auth.uid()));
CREATE POLICY st_write ON public.stock_transfers FOR ALL
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR user_in_branch(auth.uid(), from_branch_id) OR user_in_branch(auth.uid(), to_branch_id))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR user_in_branch(auth.uid(), from_branch_id) OR user_in_branch(auth.uid(), to_branch_id))) OR is_super_admin(auth.uid()));

-- ADVANCES
DROP POLICY IF EXISTS adv_read ON public.advances;
DROP POLICY IF EXISTS adv_write ON public.advances;
CREATE POLICY adv_read ON public.advances FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY adv_write ON public.advances FOR ALL
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))) OR is_super_admin(auth.uid()));

-- ADVANCE_PAYMENTS
DROP POLICY IF EXISTS advp_read ON public.advance_payments;
DROP POLICY IF EXISTS advp_write ON public.advance_payments;
CREATE POLICY advp_read ON public.advance_payments FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY advp_write ON public.advance_payments FOR ALL
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))) OR is_super_admin(auth.uid()));

-- SALARIES
DROP POLICY IF EXISTS sal_read ON public.salaries;
DROP POLICY IF EXISTS sal_write ON public.salaries;
CREATE POLICY sal_read ON public.salaries FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY sal_write ON public.salaries FOR ALL
  USING ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))) OR is_super_admin(auth.uid()));

-- AUDIT_LOG
DROP POLICY IF EXISTS audit_insert ON public.audit_log;
DROP POLICY IF EXISTS audit_read ON public.audit_log;
CREATE POLICY audit_read ON public.audit_log FOR SELECT
  USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR (branch_id IS NOT NULL AND user_in_branch(auth.uid(), branch_id)))));
CREATE POLICY audit_insert ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- SETTINGS
DROP POLICY IF EXISTS settings_admin_write ON public.settings;
DROP POLICY IF EXISTS settings_read_all ON public.settings;
CREATE POLICY settings_read ON public.settings FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));
CREATE POLICY settings_write ON public.settings FOR ALL
  USING ((tenant_id = current_tenant_id() AND is_admin(auth.uid())) OR is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = current_tenant_id() AND is_admin(auth.uid())) OR is_super_admin(auth.uid()));
