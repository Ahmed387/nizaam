
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'branch_manager', 'cashier', 'warehouse', 'accountant');
CREATE TYPE public.invoice_status AS ENUM ('active', 'cancelled');
CREATE TYPE public.transfer_status AS ENUM ('pending', 'confirmed');
CREATE TYPE public.treasury_type AS ENUM ('income', 'expense');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer fns to avoid RLS recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
$$;

-- ============ BRANCHES ============
CREATE TABLE public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.branch_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  UNIQUE (user_id, branch_id)
);
ALTER TABLE public.branch_users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.user_in_branch(_user_id UUID, _branch_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.branch_users WHERE user_id = _user_id AND branch_id = _branch_id
  )
$$;

-- ============ CATEGORIES ============
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.categories ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- ============ PRODUCTS ============
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE NOT NULL,
  category_id UUID REFERENCES public.categories ON DELETE SET NULL,
  image TEXT,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  market_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  low_stock_alert INT NOT NULL DEFAULT 5,
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.products(branch_id);
CREATE INDEX ON public.products(category_id);

-- ============ PRICE LIST ============
CREATE TABLE public.price_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT NOT NULL,
  market_price NUMERIC(12,2) NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users
);
ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;

-- ============ CUSTOMERS ============
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.customers(branch_id);

-- ============ SUPPLIERS ============
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- ============ INVOICES ============
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers ON DELETE SET NULL,
  cashier_id UUID NOT NULL REFERENCES auth.users,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  discount_reason TEXT,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status invoice_status NOT NULL DEFAULT 'active',
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.invoices(branch_id);
CREATE INDEX ON public.invoices(created_at);

CREATE TABLE public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices ON DELETE CASCADE,
  product_id UUID REFERENCES public.products ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INT NOT NULL,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  market_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.invoice_items(invoice_id);

-- ============ SHIPMENTS ============
CREATE TABLE public.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers ON DELETE RESTRICT,
  received_by TEXT NOT NULL,
  arrival_date DATE NOT NULL,
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  admin_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.shipments(branch_id);

CREATE TABLE public.shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments ON DELETE CASCADE,
  product_id UUID REFERENCES public.products ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INT NOT NULL,
  cost_price NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL
);
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;

-- ============ STOCK TRANSFERS ============
CREATE TABLE public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  to_branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products ON DELETE CASCADE,
  quantity INT NOT NULL,
  reason TEXT,
  status transfer_status NOT NULL DEFAULT 'pending',
  transferred_by UUID NOT NULL REFERENCES auth.users,
  confirmed_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

-- ============ TREASURY ============
CREATE TABLE public.treasury (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  type treasury_type NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  reference_id UUID,
  created_by UUID NOT NULL REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.treasury ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.treasury(branch_id);
CREATE INDEX ON public.treasury(created_at);

CREATE TABLE public.treasury_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  to_branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT,
  transferred_by UUID NOT NULL REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.treasury_transfers ENABLE ROW LEVEL SECURITY;

-- ============ EMPLOYEES ============
CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  phone TEXT,
  base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  hire_date DATE NOT NULL,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.employees(branch_id);

CREATE TABLE public.salaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees ON DELETE CASCADE,
  month TEXT NOT NULL,
  base_salary NUMERIC(12,2) NOT NULL,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonuses NUMERIC(12,2) NOT NULL DEFAULT 0,
  advance_deduct NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by UUID NOT NULL REFERENCES auth.users
);
ALTER TABLE public.salaries ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  remaining NUMERIC(12,2) NOT NULL,
  monthly_deduct NUMERIC(12,2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.advances ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.advance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id UUID NOT NULL REFERENCES public.advances ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  month TEXT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.advance_payments ENABLE ROW LEVEL SECURITY;

-- ============ EXPENSES ============
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.expenses(branch_id);

-- ============ RETURNS ============
CREATE TABLE public.returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  reason TEXT NOT NULL,
  total_refund NUMERIC(12,2) NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.returns ON DELETE CASCADE,
  product_id UUID REFERENCES public.products ON DELETE SET NULL,
  quantity INT NOT NULL,
  refund NUMERIC(12,2) NOT NULL
);
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;

-- ============ AUDIT LOG ============
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  user_name TEXT NOT NULL,
  branch_id UUID REFERENCES public.branches ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.audit_log(created_at DESC);

-- ============ TRIGGER: auto-create profile ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ RLS POLICIES ============
-- profiles: self read, admin all
CREATE POLICY "profiles_self_read" ON public.profiles FOR SELECT USING (auth.uid() = id OR public.is_admin(auth.uid()));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE USING (auth.uid() = id OR public.is_admin(auth.uid()));
CREATE POLICY "profiles_admin_insert" ON public.profiles FOR INSERT WITH CHECK (public.is_admin(auth.uid()) OR auth.uid() = id);

-- user_roles: read self + admin manage
CREATE POLICY "roles_read" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "roles_admin_all" ON public.user_roles FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- branches: all auth read, admin manage
CREATE POLICY "branches_read" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "branches_admin_all" ON public.branches FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- branch_users
CREATE POLICY "branch_users_read" ON public.branch_users FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "branch_users_admin_all" ON public.branch_users FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- categories: all auth read, admin manage
CREATE POLICY "cat_read" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "cat_admin_all" ON public.categories FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- price_list: all auth read, admin manage
CREATE POLICY "pl_read" ON public.price_list FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_admin_all" ON public.price_list FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- products: branch members read + admin; manage = admin or branch_manager/warehouse in branch
CREATE POLICY "prod_read" ON public.products FOR SELECT USING (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "prod_write" ON public.products FOR ALL USING (
  public.is_admin(auth.uid()) OR (public.user_in_branch(auth.uid(), branch_id) AND (public.has_role(auth.uid(), 'branch_manager') OR public.has_role(auth.uid(), 'warehouse')))
) WITH CHECK (
  public.is_admin(auth.uid()) OR (public.user_in_branch(auth.uid(), branch_id) AND (public.has_role(auth.uid(), 'branch_manager') OR public.has_role(auth.uid(), 'warehouse')))
);

-- customers
CREATE POLICY "cust_read" ON public.customers FOR SELECT USING (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "cust_write" ON public.customers FOR ALL USING (public.user_in_branch(auth.uid(), branch_id)) WITH CHECK (public.user_in_branch(auth.uid(), branch_id));

-- suppliers (global)
CREATE POLICY "sup_read" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "sup_write" ON public.suppliers FOR ALL TO authenticated USING (
  public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'branch_manager') OR public.has_role(auth.uid(), 'warehouse')
) WITH CHECK (
  public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'branch_manager') OR public.has_role(auth.uid(), 'warehouse')
);

-- invoices
CREATE POLICY "inv_read" ON public.invoices FOR SELECT USING (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "inv_insert" ON public.invoices FOR INSERT WITH CHECK (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "inv_update" ON public.invoices FOR UPDATE USING (
  public.is_admin(auth.uid()) OR (public.user_in_branch(auth.uid(), branch_id) AND public.has_role(auth.uid(), 'branch_manager'))
);

CREATE POLICY "invitm_read" ON public.invoice_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.user_in_branch(auth.uid(), i.branch_id))
);
CREATE POLICY "invitm_write" ON public.invoice_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.user_in_branch(auth.uid(), i.branch_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.user_in_branch(auth.uid(), i.branch_id))
);

-- shipments
CREATE POLICY "ship_read" ON public.shipments FOR SELECT USING (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "ship_write" ON public.shipments FOR ALL USING (
  public.is_admin(auth.uid()) OR (public.user_in_branch(auth.uid(), branch_id) AND (public.has_role(auth.uid(), 'branch_manager') OR public.has_role(auth.uid(), 'warehouse')))
) WITH CHECK (
  public.is_admin(auth.uid()) OR (public.user_in_branch(auth.uid(), branch_id) AND (public.has_role(auth.uid(), 'branch_manager') OR public.has_role(auth.uid(), 'warehouse')))
);
CREATE POLICY "shipitm_read" ON public.shipment_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id AND public.user_in_branch(auth.uid(), s.branch_id))
);
CREATE POLICY "shipitm_write" ON public.shipment_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id AND public.user_in_branch(auth.uid(), s.branch_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id AND public.user_in_branch(auth.uid(), s.branch_id))
);

-- stock_transfers
CREATE POLICY "st_read" ON public.stock_transfers FOR SELECT USING (
  public.user_in_branch(auth.uid(), from_branch_id) OR public.user_in_branch(auth.uid(), to_branch_id)
);
CREATE POLICY "st_write" ON public.stock_transfers FOR ALL USING (
  public.is_admin(auth.uid()) OR public.user_in_branch(auth.uid(), from_branch_id) OR public.user_in_branch(auth.uid(), to_branch_id)
) WITH CHECK (
  public.is_admin(auth.uid()) OR public.user_in_branch(auth.uid(), from_branch_id) OR public.user_in_branch(auth.uid(), to_branch_id)
);

-- treasury
CREATE POLICY "tr_read" ON public.treasury FOR SELECT USING (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "tr_write" ON public.treasury FOR ALL USING (public.user_in_branch(auth.uid(), branch_id)) WITH CHECK (public.user_in_branch(auth.uid(), branch_id));

CREATE POLICY "trt_read" ON public.treasury_transfers FOR SELECT USING (
  public.user_in_branch(auth.uid(), from_branch_id) OR public.user_in_branch(auth.uid(), to_branch_id)
);
CREATE POLICY "trt_write" ON public.treasury_transfers FOR ALL USING (
  public.is_admin(auth.uid()) OR public.user_in_branch(auth.uid(), from_branch_id)
) WITH CHECK (
  public.is_admin(auth.uid()) OR public.user_in_branch(auth.uid(), from_branch_id)
);

-- employees + salaries + advances + advance_payments
CREATE POLICY "emp_read" ON public.employees FOR SELECT USING (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "emp_write" ON public.employees FOR ALL USING (
  public.is_admin(auth.uid()) OR (public.user_in_branch(auth.uid(), branch_id) AND public.has_role(auth.uid(), 'branch_manager'))
) WITH CHECK (
  public.is_admin(auth.uid()) OR (public.user_in_branch(auth.uid(), branch_id) AND public.has_role(auth.uid(), 'branch_manager'))
);

CREATE POLICY "sal_read" ON public.salaries FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND public.user_in_branch(auth.uid(), e.branch_id))
);
CREATE POLICY "sal_write" ON public.salaries FOR ALL USING (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND public.user_in_branch(auth.uid(), e.branch_id) AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'branch_manager')))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND public.user_in_branch(auth.uid(), e.branch_id) AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'branch_manager')))
);

CREATE POLICY "adv_read" ON public.advances FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND public.user_in_branch(auth.uid(), e.branch_id))
);
CREATE POLICY "adv_write" ON public.advances FOR ALL USING (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND public.user_in_branch(auth.uid(), e.branch_id) AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'branch_manager')))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND public.user_in_branch(auth.uid(), e.branch_id) AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'branch_manager')))
);

CREATE POLICY "advp_read" ON public.advance_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.advances a JOIN public.employees e ON e.id = a.employee_id WHERE a.id = advance_id AND public.user_in_branch(auth.uid(), e.branch_id))
);
CREATE POLICY "advp_write" ON public.advance_payments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.advances a JOIN public.employees e ON e.id = a.employee_id WHERE a.id = advance_id AND public.user_in_branch(auth.uid(), e.branch_id) AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'branch_manager')))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.advances a JOIN public.employees e ON e.id = a.employee_id WHERE a.id = advance_id AND public.user_in_branch(auth.uid(), e.branch_id) AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'branch_manager')))
);

-- expenses
CREATE POLICY "exp_read" ON public.expenses FOR SELECT USING (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "exp_write" ON public.expenses FOR ALL USING (public.user_in_branch(auth.uid(), branch_id)) WITH CHECK (public.user_in_branch(auth.uid(), branch_id));

-- returns
CREATE POLICY "ret_read" ON public.returns FOR SELECT USING (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "ret_write" ON public.returns FOR ALL USING (public.user_in_branch(auth.uid(), branch_id)) WITH CHECK (public.user_in_branch(auth.uid(), branch_id));
CREATE POLICY "retitm_read" ON public.return_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.returns r WHERE r.id = return_id AND public.user_in_branch(auth.uid(), r.branch_id))
);
CREATE POLICY "retitm_write" ON public.return_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.returns r WHERE r.id = return_id AND public.user_in_branch(auth.uid(), r.branch_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.returns r WHERE r.id = return_id AND public.user_in_branch(auth.uid(), r.branch_id))
);

-- audit_log: read by admin or branch members; insert by any auth; no update/delete
CREATE POLICY "audit_read" ON public.audit_log FOR SELECT USING (
  public.is_admin(auth.uid()) OR (branch_id IS NOT NULL AND public.user_in_branch(auth.uid(), branch_id))
);
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- ============ HELPERS ============
CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.branch_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.sku_seq START 100000;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT 'INV-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(nextval('public.invoice_seq')::TEXT, 5, '0')
$$;

CREATE OR REPLACE FUNCTION public.next_branch_code()
RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT 'FR-' || LPAD(nextval('public.branch_seq')::TEXT, 3, '0')
$$;

CREATE OR REPLACE FUNCTION public.next_sku()
RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT 'SKU-' || nextval('public.sku_seq')::TEXT
$$;
