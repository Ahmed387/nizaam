
-- ENUMS
CREATE TYPE voucher_type AS ENUM ('receipt','payment');
CREATE TYPE voucher_source AS ENUM ('manual','system');
CREATE TYPE voucher_status AS ENUM ('active','cancelled');
CREATE TYPE voucher_party_type AS ENUM ('customer','supplier','employee','other');

-- ===================== voucher_categories =====================
CREATE TABLE public.voucher_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type voucher_type NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  parent_id UUID REFERENCES public.voucher_categories(id) ON DELETE RESTRICT,
  system_key TEXT, -- ثابت يستخدم للربط البرمجي
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type, name, parent_id)
);
CREATE INDEX idx_vc_tenant_type ON public.voucher_categories(tenant_id, type);
CREATE INDEX idx_vc_system_key ON public.voucher_categories(tenant_id, system_key);

ALTER TABLE public.voucher_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY vc_read ON public.voucher_categories FOR SELECT
USING ((tenant_id = current_tenant_id()) OR is_super_admin(auth.uid()));

CREATE POLICY vc_write ON public.voucher_categories FOR ALL
USING (((tenant_id = current_tenant_id()) AND is_admin(auth.uid())) OR is_super_admin(auth.uid()))
WITH CHECK (((tenant_id = current_tenant_id()) AND is_admin(auth.uid())) OR is_super_admin(auth.uid()));

CREATE POLICY vc_suspended ON public.voucher_categories AS RESTRICTIVE FOR ALL
USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended())
WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());

-- ===================== vouchers =====================
-- sequences per tenant: use a counters table
CREATE TABLE public.voucher_sequences (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type voucher_type NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, type)
);

CREATE TABLE public.vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  voucher_number TEXT NOT NULL,
  type voucher_type NOT NULL,
  source voucher_source NOT NULL,
  source_type TEXT, -- invoice/shipment/salary/advance/installment/return/transfer/expense/treasury
  source_id UUID,
  treasury_id UUID, -- ربط مع treasury لو موجودة
  category_id UUID NOT NULL REFERENCES public.voucher_categories(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','vodafone','instapay','bank')),
  fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  reference_number TEXT,
  transferred_to TEXT,
  party_type voucher_party_type,
  party_id UUID,
  party_name TEXT,
  description TEXT,
  voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status voucher_status NOT NULL DEFAULT 'active',
  cancelled_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_by UUID NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, voucher_number)
);
CREATE INDEX idx_vouchers_tenant_branch ON public.vouchers(tenant_id, branch_id);
CREATE INDEX idx_vouchers_type_date ON public.vouchers(type, voucher_date DESC);
CREATE INDEX idx_vouchers_treasury ON public.vouchers(treasury_id);
CREATE INDEX idx_vouchers_source ON public.vouchers(source_type, source_id);

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY v_read ON public.vouchers FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR ((tenant_id = current_tenant_id()) AND (
        is_admin(auth.uid())
        OR has_role(auth.uid(), 'viewer'::app_role)
        OR has_role(auth.uid(), 'accountant'::app_role)
        OR user_in_branch(auth.uid(), branch_id)
     ))
);

-- Manual insert: branch_manager في فرعه أو admin
CREATE POLICY v_insert_manual ON public.vouchers FOR INSERT
WITH CHECK (
  is_super_admin(auth.uid())
  OR ((tenant_id = current_tenant_id()) AND (
        is_admin(auth.uid())
        OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
     ))
);

CREATE POLICY v_update ON public.vouchers FOR UPDATE
USING (
  is_super_admin(auth.uid())
  OR ((tenant_id = current_tenant_id()) AND (
        is_admin(auth.uid())
        OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
     ))
);

CREATE POLICY v_suspended ON public.vouchers AS RESTRICTIVE FOR ALL
USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended())
WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());

ALTER TABLE public.voucher_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY vs_admin ON public.voucher_sequences FOR ALL
USING (false) WITH CHECK (false); -- only via definer functions

-- ===================== Functions =====================

-- Next voucher number
CREATE OR REPLACE FUNCTION public.next_voucher_number(_tenant UUID, _type voucher_type)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
  prefix TEXT;
BEGIN
  INSERT INTO voucher_sequences (tenant_id, type, last_number)
  VALUES (_tenant, _type, 1)
  ON CONFLICT (tenant_id, type) DO UPDATE SET last_number = voucher_sequences.last_number + 1
  RETURNING last_number INTO n;
  prefix := CASE WHEN _type = 'receipt' THEN 'RV' ELSE 'PV' END;
  RETURN prefix || '-' || lpad(n::text, 4, '0');
END;
$$;

-- Seed system categories for a tenant
CREATE OR REPLACE FUNCTION public.seed_voucher_categories(_tenant UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Payment categories
  INSERT INTO voucher_categories (tenant_id, name, type, is_system, system_key) VALUES
    (_tenant, 'مدفوعات موردين', 'payment', true, 'supplier_payment'),
    (_tenant, 'رواتب موظفين', 'payment', true, 'salary'),
    (_tenant, 'سلف موظفين', 'payment', true, 'advance'),
    (_tenant, 'إيجارات', 'payment', true, 'rent'),
    (_tenant, 'كهرباء ومياه', 'payment', true, 'utilities'),
    (_tenant, 'صيانة', 'payment', true, 'maintenance'),
    (_tenant, 'مصاريف شحن', 'payment', true, 'shipping'),
    (_tenant, 'عمولات تحويل', 'payment', true, 'transfer_fee'),
    (_tenant, 'مرتجعات للعملاء', 'payment', true, 'customer_return'),
    (_tenant, 'تحويلات بين الفروع', 'payment', true, 'branch_transfer_out'),
    (_tenant, 'أخرى', 'payment', true, 'other_payment')
  ON CONFLICT DO NOTHING;

  -- Receipt categories
  INSERT INTO voucher_categories (tenant_id, name, type, is_system, system_key) VALUES
    (_tenant, 'مبيعات نقدية', 'receipt', true, 'cash_sale'),
    (_tenant, 'تحصيل أقساط عملاء', 'receipt', true, 'installment'),
    (_tenant, 'تحويلات بين الفروع', 'receipt', true, 'branch_transfer_in'),
    (_tenant, 'إيرادات أخرى', 'receipt', true, 'other_receipt')
  ON CONFLICT DO NOTHING;
END;
$$;

-- Seed for existing tenant(s)
SELECT seed_voucher_categories(id) FROM tenants;

-- Trigger to auto-seed for new tenants
CREATE OR REPLACE FUNCTION public.tenant_seed_vouchers_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_voucher_categories(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_seed_vouchers
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION tenant_seed_vouchers_trg();

-- Find/get a system category id for a given key (fallback to 'other')
CREATE OR REPLACE FUNCTION public.get_system_category(_tenant UUID, _type voucher_type, _key TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid UUID;
BEGIN
  SELECT id INTO cid FROM voucher_categories
   WHERE tenant_id = _tenant AND type = _type AND system_key = _key
   LIMIT 1;
  IF cid IS NULL THEN
    SELECT id INTO cid FROM voucher_categories
     WHERE tenant_id = _tenant AND type = _type
       AND system_key = (CASE WHEN _type='receipt' THEN 'other_receipt' ELSE 'other_payment' END)
     LIMIT 1;
  END IF;
  RETURN cid;
END;
$$;

-- Map treasury row (or description / context) to a system category key
CREATE OR REPLACE FUNCTION public.map_treasury_to_category_key(_t treasury)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cat TEXT := COALESCE(_t.category, '');
BEGIN
  IF _t.is_fee THEN RETURN 'transfer_fee'; END IF;
  -- normalize Arabic / common categories
  IF cat ILIKE '%مورد%' OR cat ILIKE '%shipment%' OR cat ILIKE '%supplier%' THEN RETURN CASE WHEN _t.type='expense' THEN 'supplier_payment' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%راتب%' OR cat ILIKE '%salary%' THEN RETURN 'salary'; END IF;
  IF cat ILIKE '%سلف%' OR cat ILIKE '%advance%' THEN RETURN 'advance'; END IF;
  IF cat ILIKE '%إيجار%' OR cat ILIKE '%ايجار%' OR cat ILIKE '%rent%' THEN RETURN 'rent'; END IF;
  IF cat ILIKE '%كهرب%' OR cat ILIKE '%مياه%' OR cat ILIKE '%utilit%' THEN RETURN 'utilities'; END IF;
  IF cat ILIKE '%صيان%' OR cat ILIKE '%maintenance%' THEN RETURN 'maintenance'; END IF;
  IF cat ILIKE '%شحن%' OR cat ILIKE '%shipping%' THEN RETURN 'shipping'; END IF;
  IF cat ILIKE '%مرتجع%' OR cat ILIKE '%return%' THEN RETURN CASE WHEN _t.type='expense' THEN 'customer_return' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%تحويل%فرع%' OR cat ILIKE '%branch_transfer%' THEN RETURN CASE WHEN _t.type='expense' THEN 'branch_transfer_out' ELSE 'branch_transfer_in' END; END IF;
  IF cat ILIKE '%قسط%' OR cat ILIKE '%installment%' THEN RETURN 'installment'; END IF;
  IF cat ILIKE '%مبيع%' OR cat ILIKE '%sale%' OR cat ILIKE '%invoice%' THEN RETURN 'cash_sale'; END IF;
  RETURN CASE WHEN _t.type='expense' THEN 'other_payment' ELSE 'other_receipt' END;
END;
$$;

-- Auto-create voucher from treasury insert
CREATE OR REPLACE FUNCTION public.treasury_to_voucher_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type voucher_type;
  cat_id UUID;
  key TEXT;
  vnum TEXT;
  uname TEXT;
BEGIN
  -- Skip if this treasury row was created as part of a manual voucher (avoid loop)
  IF EXISTS (SELECT 1 FROM vouchers WHERE treasury_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  v_type := CASE WHEN NEW.type = 'income' THEN 'receipt'::voucher_type ELSE 'payment'::voucher_type END;
  key := map_treasury_to_category_key(NEW);
  cat_id := get_system_category(NEW.tenant_id, v_type, key);
  vnum := next_voucher_number(NEW.tenant_id, v_type);
  SELECT name INTO uname FROM profiles WHERE id = NEW.created_by;

  INSERT INTO vouchers (
    tenant_id, branch_id, voucher_number, type, source, source_type, source_id,
    treasury_id, category_id, amount, payment_method, reference_number,
    transferred_to, description, voucher_date, created_by, created_by_name
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, vnum, v_type, 'system',
    'treasury', NEW.reference_id, NEW.id, cat_id, NEW.amount,
    NEW.payment_method, NEW.reference_number, NEW.transfer_to_account,
    NEW.description, NEW.created_at::date, NEW.created_by, uname
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_treasury_to_voucher
AFTER INSERT ON public.treasury
FOR EACH ROW EXECUTE FUNCTION treasury_to_voucher_trg();

-- When a treasury row is deleted, cancel its voucher
CREATE OR REPLACE FUNCTION public.treasury_delete_cancel_voucher_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE vouchers SET status='cancelled', cancelled_at=now(), cancel_reason='تم إلغاء العملية المصدر'
   WHERE treasury_id = OLD.id AND status='active';
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_treasury_delete_cancel_voucher
AFTER DELETE ON public.treasury
FOR EACH ROW EXECUTE FUNCTION treasury_delete_cancel_voucher_trg();

-- ===================== Manual voucher RPC =====================
CREATE OR REPLACE FUNCTION public.create_manual_voucher(
  p_branch_id UUID,
  p_type voucher_type,
  p_category_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_transferred_to TEXT DEFAULT NULL,
  p_fee_amount NUMERIC DEFAULT 0,
  p_party_type voucher_party_type DEFAULT NULL,
  p_party_id UUID DEFAULT NULL,
  p_party_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_voucher_date DATE DEFAULT CURRENT_DATE
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_id UUID;
  vnum TEXT;
  tr_id UUID;
  fee_tr_id UUID;
  uname TEXT;
  cat_name TEXT;
BEGIN
  -- permission check
  IF NOT (
    is_admin(auth.uid())
    OR (user_in_branch(auth.uid(), p_branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
    OR is_super_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لإضافة سند';
  END IF;

  SELECT tenant_id INTO v_tenant FROM branches WHERE id = p_branch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;

  -- category must belong to tenant and match type
  SELECT name INTO cat_name FROM voucher_categories
   WHERE id = p_category_id AND tenant_id = v_tenant AND type = p_type;
  IF cat_name IS NULL THEN RAISE EXCEPTION 'تصنيف غير صالح'; END IF;

  SELECT name INTO uname FROM profiles WHERE id = auth.uid();
  vnum := next_voucher_number(v_tenant, p_type);

  -- Create matching treasury row(s) WITHOUT triggering auto-voucher (we will link them)
  -- We need to insert treasury THEN link voucher.treasury_id; but our trigger creates the voucher first.
  -- Strategy: insert voucher with NULL treasury_id, then insert treasury, then UPDATE voucher.treasury_id
  -- and the treasury trigger checks "EXISTS treasury_id" so skip — but that check uses treasury_id of NEW.id which is not set yet.
  -- Alternative: insert voucher first, insert treasury, the trigger will create a DUPLICATE voucher.
  -- Better: set a session GUC to skip the trigger.
  PERFORM set_config('app.skip_treasury_voucher','1', true);

  INSERT INTO treasury (
    tenant_id, branch_id, type, category, amount, description,
    payment_method, reference_number, transfer_to_account,
    is_fee, created_by
  ) VALUES (
    v_tenant, p_branch_id,
    CASE WHEN p_type='receipt' THEN 'income'::treasury_type ELSE 'expense'::treasury_type END,
    cat_name, p_amount, p_description,
    p_payment_method, p_reference_number, p_transferred_to,
    false, auth.uid()
  ) RETURNING id INTO tr_id;

  INSERT INTO vouchers (
    tenant_id, branch_id, voucher_number, type, source,
    treasury_id, category_id, amount, payment_method,
    fee_amount, reference_number, transferred_to,
    party_type, party_id, party_name, description,
    voucher_date, created_by, created_by_name
  ) VALUES (
    v_tenant, p_branch_id, vnum, p_type, 'manual',
    tr_id, p_category_id, p_amount, p_payment_method,
    COALESCE(p_fee_amount,0), p_reference_number, p_transferred_to,
    p_party_type, p_party_id, p_party_name, p_description,
    p_voucher_date, auth.uid(), uname
  ) RETURNING id INTO v_id;

  -- Fee voucher if any (always payment)
  IF COALESCE(p_fee_amount,0) > 0 THEN
    INSERT INTO treasury (
      tenant_id, branch_id, type, category, amount, description,
      payment_method, is_fee, created_by
    ) VALUES (
      v_tenant, p_branch_id, 'expense'::treasury_type, 'عمولات تحويل',
      p_fee_amount, 'عمولة سند ' || vnum, p_payment_method, true, auth.uid()
    ) RETURNING id INTO fee_tr_id;

    INSERT INTO vouchers (
      tenant_id, branch_id, voucher_number, type, source, source_type, source_id,
      treasury_id, category_id, amount, payment_method,
      description, voucher_date, created_by, created_by_name
    ) VALUES (
      v_tenant, p_branch_id, next_voucher_number(v_tenant,'payment'),
      'payment', 'system', 'voucher_fee', v_id,
      fee_tr_id, get_system_category(v_tenant,'payment','transfer_fee'),
      p_fee_amount, p_payment_method,
      'عمولة تحويل سند ' || vnum, p_voucher_date, auth.uid(), uname
    );
  END IF;

  PERFORM set_config('app.skip_treasury_voucher','0', true);

  INSERT INTO audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), COALESCE(uname,'?'), v_tenant, p_branch_id, 'CREATE', 'voucher', v_id::text,
          jsonb_build_object('voucher_number', vnum, 'type', p_type, 'amount', p_amount));

  RETURN v_id;
END;
$$;

-- Update treasury trigger to honor the skip flag
CREATE OR REPLACE FUNCTION public.treasury_to_voucher_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type voucher_type;
  cat_id UUID;
  key TEXT;
  vnum TEXT;
  uname TEXT;
BEGIN
  IF current_setting('app.skip_treasury_voucher', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM vouchers WHERE treasury_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  v_type := CASE WHEN NEW.type = 'income' THEN 'receipt'::voucher_type ELSE 'payment'::voucher_type END;
  key := map_treasury_to_category_key(NEW);
  cat_id := get_system_category(NEW.tenant_id, v_type, key);
  vnum := next_voucher_number(NEW.tenant_id, v_type);
  SELECT name INTO uname FROM profiles WHERE id = NEW.created_by;

  INSERT INTO vouchers (
    tenant_id, branch_id, voucher_number, type, source, source_type, source_id,
    treasury_id, category_id, amount, payment_method, reference_number,
    transferred_to, description, voucher_date, created_by, created_by_name
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, vnum, v_type, 'system',
    'treasury', NEW.reference_id, NEW.id, cat_id, NEW.amount,
    NEW.payment_method, NEW.reference_number, NEW.transfer_to_account,
    NEW.description, NEW.created_at::date, NEW.created_by, uname
  );
  RETURN NEW;
END;
$$;

-- ===================== Cancel voucher RPC =====================
CREATE OR REPLACE FUNCTION public.cancel_voucher(p_voucher_id UUID, p_reason TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v vouchers%ROWTYPE;
  uname TEXT;
BEGIN
  SELECT * INTO v FROM vouchers WHERE id = p_voucher_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v.status = 'cancelled' THEN RAISE EXCEPTION 'السند ملغي بالفعل'; END IF;

  IF NOT (
    is_admin(auth.uid())
    OR is_super_admin(auth.uid())
    OR (user_in_branch(auth.uid(), v.branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لإلغاء السند';
  END IF;

  IF v.source = 'system' AND v.source_type <> 'treasury' THEN
    RAISE EXCEPTION 'السند مرتبط بـ % — قم بإلغاء المصدر أولاً', v.source_type;
  END IF;

  IF v.source = 'system' AND NOT is_admin(auth.uid()) AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'السندات التلقائية لا تُلغى إلا من قبل المدير العام';
  END IF;

  IF COALESCE(NULLIF(trim(p_reason),''), NULL) IS NULL THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب';
  END IF;

  -- Delete the linked treasury row (this will cascade cancel via trigger, but we want to mark this specific one)
  PERFORM set_config('app.skip_treasury_voucher','1', true);
  IF v.treasury_id IS NOT NULL THEN
    DELETE FROM treasury WHERE id = v.treasury_id;
  END IF;
  PERFORM set_config('app.skip_treasury_voucher','0', true);

  UPDATE vouchers
     SET status='cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason
   WHERE id = p_voucher_id;

  SELECT name INTO uname FROM profiles WHERE id = auth.uid();
  INSERT INTO audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), COALESCE(uname,'?'), v.tenant_id, v.branch_id, 'CANCEL', 'voucher', v.id::text,
          jsonb_build_object('voucher_number', v.voucher_number, 'reason', p_reason));
END;
$$;

-- ===================== Treasury balance view =====================
CREATE OR REPLACE VIEW public.voucher_treasury_balances AS
SELECT
  branch_id,
  tenant_id,
  payment_method,
  SUM(CASE WHEN type='receipt' THEN amount ELSE 0 END)::numeric(12,2) AS total_in,
  SUM(CASE WHEN type='payment' THEN amount ELSE 0 END)::numeric(12,2) AS total_out,
  (SUM(CASE WHEN type='receipt' THEN amount ELSE 0 END)
   - SUM(CASE WHEN type='payment' THEN amount ELSE 0 END))::numeric(12,2) AS balance
FROM vouchers
WHERE status = 'active'
GROUP BY branch_id, tenant_id, payment_method;

GRANT SELECT ON public.voucher_treasury_balances TO authenticated;
