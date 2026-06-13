CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  SELECT COALESCE(name, 'النظام') INTO v_name
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

  INSERT INTO public.audit_log(user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (v_uid, v_name, v_tenant, v_branch, v_action, v_entity, v_entity_id, v_details);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;