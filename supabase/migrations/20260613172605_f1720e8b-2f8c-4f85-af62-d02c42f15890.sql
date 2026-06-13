
-- Universal audit trigger function
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_tenant uuid;
  v_branch uuid;
  v_action text;
  v_entity text := TG_TABLE_NAME;
  v_entity_id text;
  v_details jsonb := '{}'::jsonb;
  v_status_old text;
  v_status_new text;
BEGIN
  -- Resolve user name (fallback to system)
  SELECT COALESCE(full_name, email, 'النظام') INTO v_name
  FROM public.profiles WHERE id = v_uid;
  IF v_name IS NULL THEN v_name := 'النظام'; END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'CREATE';
    v_entity_id := COALESCE((NEW.id)::text, '');
    BEGIN v_tenant := NEW.tenant_id; EXCEPTION WHEN OTHERS THEN v_tenant := NULL; END;
    BEGIN v_branch := NEW.branch_id; EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;
    v_details := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_entity_id := COALESCE((NEW.id)::text, '');
    BEGIN v_tenant := NEW.tenant_id; EXCEPTION WHEN OTHERS THEN v_tenant := NULL; END;
    BEGIN v_branch := NEW.branch_id; EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;

    -- Detect status transitions -> CANCEL
    BEGIN
      v_status_old := (to_jsonb(OLD)->>'status');
      v_status_new := (to_jsonb(NEW)->>'status');
    EXCEPTION WHEN OTHERS THEN v_status_old := NULL; v_status_new := NULL; END;

    IF v_status_old IS DISTINCT FROM v_status_new
       AND v_status_new IN ('cancelled','canceled','void','refunded') THEN
      v_action := 'CANCEL';
    ELSE
      v_action := 'UPDATE';
    END IF;
    v_details := jsonb_build_object('old_status', v_status_old, 'new_status', v_status_new);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'DELETE';
    v_entity_id := COALESCE((OLD.id)::text, '');
    BEGIN v_tenant := OLD.tenant_id; EXCEPTION WHEN OTHERS THEN v_tenant := NULL; END;
    BEGIN v_branch := OLD.branch_id; EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;
    v_details := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  -- Insert bypassing RLS via SECURITY DEFINER. user_id may be null for system ops.
  INSERT INTO public.audit_log(user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (v_uid, v_name, v_tenant, v_branch, v_action, v_entity, v_entity_id, v_details);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Allow audit_log inserts from definer function for any authenticated user (broaden policy)
DROP POLICY IF EXISTS "audit_insert" ON public.audit_log;
CREATE POLICY "audit_insert_any" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Attach to sensitive tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'invoices','returns','purchase_returns','vouchers','supplier_payments',
    'stock_adjustments','stock_transfers','treasury_transfers','payment_plans',
    'price_list_items','products'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn()', t, t
    );
  END LOOP;
END $$;
