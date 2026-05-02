
-- =========================================================
-- Universal audit trigger function
-- =========================================================
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_user_name text;
  v_tenant uuid;
  v_branch uuid;
  v_entity_id text;
  v_action text;
  v_details jsonb;
BEGIN
  v_action := TG_OP;

  IF v_user IS NOT NULL THEN
    SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user;
  END IF;
  v_user_name := COALESCE(v_user_name, 'system');

  IF TG_OP = 'DELETE' THEN
    v_entity_id := COALESCE(OLD.id::text, '');
    v_tenant := CASE WHEN to_jsonb(OLD) ? 'tenant_id' THEN (to_jsonb(OLD)->>'tenant_id')::uuid ELSE NULL END;
    v_branch := CASE WHEN to_jsonb(OLD) ? 'branch_id' THEN (to_jsonb(OLD)->>'branch_id')::uuid ELSE NULL END;
    v_details := jsonb_build_object('old', to_jsonb(OLD));
  ELSE
    v_entity_id := COALESCE(NEW.id::text, '');
    v_tenant := CASE WHEN to_jsonb(NEW) ? 'tenant_id' THEN (to_jsonb(NEW)->>'tenant_id')::uuid ELSE NULL END;
    v_branch := CASE WHEN to_jsonb(NEW) ? 'branch_id' THEN (to_jsonb(NEW)->>'branch_id')::uuid ELSE NULL END;
    IF TG_OP = 'UPDATE' THEN
      v_details := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
    ELSE
      v_details := jsonb_build_object('new', to_jsonb(NEW));
    END IF;
  END IF;

  -- Strip sensitive fields
  v_details := v_details #- '{old,login_password}' #- '{new,login_password}';

  INSERT INTO public.audit_log(
    user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details
  ) VALUES (
    v_user, v_user_name, v_tenant, v_branch,
    CASE TG_OP WHEN 'INSERT' THEN 'CREATE' ELSE TG_OP END,
    TG_TABLE_NAME, v_entity_id, v_details
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Helper to attach UPDATE+DELETE audit trigger to a table
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'products','invoices','employees','advances','advance_requests',
    'shipments','stock_transfers','treasury','treasury_transfers',
    'suppliers','supplier_payments','price_list','branches',
    'user_roles','salaries','expenses','returns','customers','categories'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()',
      t, t
    );
  END LOOP;
END $$;
