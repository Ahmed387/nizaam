
-- ============================================================
-- Price & Cost Audit Log System
-- ============================================================

CREATE TABLE IF NOT EXISTS public.price_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  entity_type text NOT NULL CHECK (entity_type IN ('product','shipment','branch_settings','price_list','product_batch')),
  entity_id uuid,
  entity_name text,
  price_type text NOT NULL CHECK (price_type IN ('selling_price','cost_price','market_price','min_price','discount_limit','shipping_cost','true_unit_cost')),
  old_value numeric,
  new_value numeric,
  changed_by uuid,
  changed_by_name text,
  changed_by_role text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  change_reason text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','shipment','price_list_import','system')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.price_audit_log TO authenticated;
GRANT ALL ON public.price_audit_log TO service_role;

ALTER TABLE public.price_audit_log ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user in the same tenant
CREATE POLICY "tenant members read price_audit_log"
ON public.price_audit_log FOR SELECT
TO authenticated
USING (
  tenant_id IS NULL OR tenant_id IN (
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- Insert: allow authenticated (triggers run as definer regardless)
CREATE POLICY "authenticated insert price_audit_log"
ON public.price_audit_log FOR INSERT
TO authenticated
WITH CHECK (true);

-- Append-only: no UPDATE / DELETE policies (denied by default)

CREATE INDEX IF NOT EXISTS idx_price_audit_entity ON public.price_audit_log (entity_id, price_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_audit_tenant_created ON public.price_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_audit_branch ON public.price_audit_log (branch_id, created_at DESC);

-- Realtime
ALTER TABLE public.price_audit_log REPLICA IDENTITY FULL;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='price_audit_log';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.price_audit_log';
  END IF;
END $$;

-- ============================================================
-- Helper: resolve current user name & role
-- ============================================================
CREATE OR REPLACE FUNCTION public._audit_user_info(_uid uuid)
RETURNS TABLE(uname text, urole text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT name FROM public.profiles WHERE id = _uid), 'النظام') AS uname,
    COALESCE((SELECT role::text FROM public.user_roles WHERE user_id = _uid ORDER BY
      CASE role::text
        WHEN 'super_admin' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'branch_manager' THEN 3
        WHEN 'accountant' THEN 4
        WHEN 'cashier' THEN 5
        ELSE 9 END
      LIMIT 1), 'system') AS urole;
$$;

-- ============================================================
-- Helper: write a single audit row + suspicious alerts
-- ============================================================
CREATE OR REPLACE FUNCTION public._audit_write(
  _tenant uuid,
  _etype text, _eid uuid, _ename text,
  _ptype text, _old numeric, _new numeric,
  _branch uuid, _reason text, _source text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  uinfo record;
  hr int := EXTRACT(HOUR FROM (now() AT TIME ZONE 'Africa/Cairo'))::int;
  admins uuid[];
  cur_cost numeric;
BEGIN
  SELECT * INTO uinfo FROM public._audit_user_info(uid);

  INSERT INTO public.price_audit_log(
    tenant_id, entity_type, entity_id, entity_name, price_type,
    old_value, new_value, changed_by, changed_by_name, changed_by_role,
    branch_id, change_reason, source
  ) VALUES (
    _tenant, _etype, _eid, _ename, _ptype,
    _old, _new, uid, uinfo.uname, uinfo.urole,
    _branch, _reason, _source
  );

  -- Suspicious alerts: only for manual selling_price changes on products
  IF _source = 'manual' AND _etype = 'product' AND _ptype = 'selling_price' AND _old IS NOT NULL AND _new IS NOT NULL THEN
    SELECT ARRAY(SELECT ur.user_id FROM public.user_roles ur
                 JOIN public.profiles p ON p.id = ur.user_id
                 WHERE p.tenant_id = _tenant AND ur.role::text IN ('admin','super_admin'))
      INTO admins;

    -- Alert 1: drop > 20%
    IF _old > 0 AND _new < _old AND ((_old - _new) / _old) > 0.20 THEN
      INSERT INTO public.notifications(user_id, title, body, type)
      SELECT u, '⚠️ تخفيض كبير في السعر',
        'المنتج: '||COALESCE(_ename,'')||' من '||_old||' إلى '||_new||' بواسطة '||uinfo.uname,
        'general'
      FROM unnest(admins) u;
    END IF;

    -- Alert 2: selling below cost
    SELECT cost_price INTO cur_cost FROM public.products WHERE id = _eid;
    IF cur_cost IS NOT NULL AND _new < cur_cost THEN
      INSERT INTO public.notifications(user_id, title, body, type)
      SELECT u, '🔴 سعر البيع أقل من التكلفة',
        'المنتج: '||COALESCE(_ename,'')||' — سعر البيع: '||_new||' — التكلفة: '||cur_cost,
        'general'
      FROM unnest(admins) u;
    END IF;

    -- Alert 3: outside working hours
    IF hr < 8 OR hr >= 22 THEN
      INSERT INTO public.notifications(user_id, title, body, type)
      SELECT u, '⚠️ تعديل سعر خارج أوقات العمل',
        'المنتج: '||COALESCE(_ename,'')||' بواسطة '||uinfo.uname||' الساعة '||hr||':00',
        'general'
      FROM unnest(admins) u;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- Trigger 1: products
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_log_product_price_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reason text := COALESCE(current_setting('app.price_change_reason', true), NULL);
  src text := COALESCE(current_setting('app.price_change_source', true), 'manual');
BEGIN
  IF NEW.selling_price IS DISTINCT FROM OLD.selling_price THEN
    PERFORM public._audit_write(NEW.tenant_id,'product',NEW.id,NEW.name,'selling_price',
      OLD.selling_price, NEW.selling_price, NEW.branch_id, reason, src);
  END IF;
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    PERFORM public._audit_write(NEW.tenant_id,'product',NEW.id,NEW.name,'cost_price',
      OLD.cost_price, NEW.cost_price, NEW.branch_id, reason, src);
  END IF;
  IF NEW.market_price IS DISTINCT FROM OLD.market_price THEN
    PERFORM public._audit_write(NEW.tenant_id,'product',NEW.id,NEW.name,'market_price',
      OLD.market_price, NEW.market_price, NEW.branch_id, reason, src);
  END IF;
  IF NEW.min_stock_level IS DISTINCT FROM OLD.min_stock_level THEN
    -- not a price, skip
    NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_product_price_change ON public.products;
CREATE TRIGGER trg_log_product_price_change
AFTER UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.trg_log_product_price_change();

-- products INSERT (first-time set)
CREATE OR REPLACE FUNCTION public.trg_log_product_price_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  src text := COALESCE(current_setting('app.price_change_source', true), 'manual');
BEGIN
  IF NEW.selling_price IS NOT NULL THEN
    PERFORM public._audit_write(NEW.tenant_id,'product',NEW.id,NEW.name,'selling_price',
      NULL, NEW.selling_price, NEW.branch_id, 'أول تسجيل', src);
  END IF;
  IF NEW.cost_price IS NOT NULL THEN
    PERFORM public._audit_write(NEW.tenant_id,'product',NEW.id,NEW.name,'cost_price',
      NULL, NEW.cost_price, NEW.branch_id, 'أول تسجيل', src);
  END IF;
  IF NEW.market_price IS NOT NULL THEN
    PERFORM public._audit_write(NEW.tenant_id,'product',NEW.id,NEW.name,'market_price',
      NULL, NEW.market_price, NEW.branch_id, 'أول تسجيل', src);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_product_price_insert ON public.products;
CREATE TRIGGER trg_log_product_price_insert
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.trg_log_product_price_insert();

-- ============================================================
-- Trigger 2: shipment_items
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_log_shipment_price_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reason text;
BEGIN
  reason := 'شحنة رقم '||COALESCE(NEW.shipment_id::text,'');
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit_write(NEW.tenant_id,'shipment',NEW.shipment_id,NEW.product_name,'cost_price',
      NULL, NEW.cost_price, NULL, reason, 'shipment');
  ELSIF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    PERFORM public._audit_write(NEW.tenant_id,'shipment',NEW.shipment_id,NEW.product_name,'cost_price',
      OLD.cost_price, NEW.cost_price, NULL, reason, 'shipment');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_shipment_price_change ON public.shipment_items;
CREATE TRIGGER trg_log_shipment_price_change
AFTER INSERT OR UPDATE ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.trg_log_shipment_price_change();

-- ============================================================
-- Trigger 3: product_batches
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_log_batch_cost_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pname text;
BEGIN
  SELECT name INTO pname FROM public.products WHERE id = NEW.product_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.cost_price IS NOT NULL THEN
      PERFORM public._audit_write(NEW.tenant_id,'product_batch',NEW.product_id,pname,'cost_price',
        NULL, NEW.cost_price, NEW.branch_id,
        'دفعة شحنة '||COALESCE(NEW.shipment_id::text,''), 'shipment');
    END IF;
  ELSIF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    PERFORM public._audit_write(NEW.tenant_id,'product_batch',NEW.product_id,pname,'cost_price',
      OLD.cost_price, NEW.cost_price, NEW.branch_id,
      'تعديل دفعة', 'shipment');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_batch_cost_change ON public.product_batches;
CREATE TRIGGER trg_log_batch_cost_change
AFTER INSERT OR UPDATE ON public.product_batches
FOR EACH ROW EXECUTE FUNCTION public.trg_log_batch_cost_change();

-- ============================================================
-- Trigger 4: settings (discount_policy)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_log_settings_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_v numeric; new_v numeric;
BEGIN
  IF NEW.key = 'discount_policy' THEN
    old_v := NULLIF((OLD.value->>'max_discount_percent'),'')::numeric;
    new_v := NULLIF((NEW.value->>'max_discount_percent'),'')::numeric;
    IF new_v IS DISTINCT FROM old_v THEN
      PERFORM public._audit_write(NEW.tenant_id,'branch_settings',NULL,'سياسة الخصم','discount_limit',
        old_v, new_v, NULL, 'تعديل سياسة الخصم', 'manual');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_settings_change ON public.settings;
CREATE TRIGGER trg_log_settings_change
AFTER UPDATE ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.trg_log_settings_change();

-- ============================================================
-- Trigger 5: price_list_items (market price)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_log_price_list_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.display_price IS NOT NULL THEN
      PERFORM public._audit_write(NEW.tenant_id,'price_list',NEW.id,NEW.product_name,'market_price',
        NULL, NEW.display_price, NULL, 'استيراد قائمة أسعار', 'price_list_import');
    END IF;
  ELSIF NEW.display_price IS DISTINCT FROM OLD.display_price THEN
    PERFORM public._audit_write(NEW.tenant_id,'price_list',NEW.id,NEW.product_name,'market_price',
      OLD.display_price, NEW.display_price, NULL, 'تحديث قائمة أسعار', 'price_list_import');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_price_list_change ON public.price_list_items;
CREATE TRIGGER trg_log_price_list_change
AFTER INSERT OR UPDATE ON public.price_list_items
FOR EACH ROW EXECUTE FUNCTION public.trg_log_price_list_change();

-- ============================================================
-- RPC: manual price update with required reason
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_product_price_with_reason(
  _product_id uuid,
  _selling_price numeric DEFAULT NULL,
  _cost_price numeric DEFAULT NULL,
  _market_price numeric DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) < 10 THEN
    RAISE EXCEPTION 'يجب إدخال سبب التعديل (10 أحرف على الأقل)';
  END IF;
  PERFORM set_config('app.price_change_reason', _reason, true);
  PERFORM set_config('app.price_change_source', 'manual', true);

  UPDATE public.products
     SET selling_price = COALESCE(_selling_price, selling_price),
         cost_price    = COALESCE(_cost_price, cost_price),
         market_price  = COALESCE(_market_price, market_price)
   WHERE id = _product_id;
END $$;

GRANT EXECUTE ON FUNCTION public.update_product_price_with_reason(uuid,numeric,numeric,numeric,text) TO authenticated;
