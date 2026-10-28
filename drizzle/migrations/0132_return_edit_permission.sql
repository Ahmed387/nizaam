-- 0132: «تعديل المرتجع» for everyone, closed from the permissions (owner 2026-10-28 «الزرار للكل ولو عاوز الغيه من
-- الاعدادات الغيه من الصلاحيات»)
--
-- 0131 let only the owner edit a return. Now the key `returns.update` («تعديل المرتجعات (بيع وشراء)», settings →
-- الموظفين / القوالب) decides: on by default for every role except «مراقب» (read only); the owner closes it for one
-- employee, a branch or a whole role. The company owner always has it; a «عرض فقط» branch never does (write key).
-- Example: the cashier of سكة تلة opens SR00076 → «تعديل المرتجع» → saves; the owner switches the key off for him →
-- the button is gone and the server answers «ليس لديك صلاحية».
-- The edit still calls cancel_sale_return / cancel_purchase_return, which stay OWNER ONLY when called alone (the
-- «إلغاء المرتجع» button): they skip their owner check only for the return being edited (`app.return_edit_id`,
-- set by edit_* after their own permission check, in the same transaction). The same flag lets the new return take
-- the OLD return's date (enforce_invoice_date_edit_permission lets only owner / admin change a date): only for the
-- new row that replaces that very return.

-- 1) default: every role but the viewer
DO $mig$
DECLARE d text := pg_get_functiondef('public.role_permission_default(text,text)'::regprocedure);
  o text := $o$  SELECT CASE p_role$o$;
  n text := $n$  SELECT (p_key = 'returns.update' AND p_role <> 'viewer') OR CASE p_role$n$;
BEGIN
  IF position('returns.update' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0132: role_permission_default not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

-- 2) the edit RPCs ask for the permission instead of the owner
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.edit_sale_return(uuid,text,text,text,text,text,text,jsonb)'::regprocedure);
  IF position($o$FROM public.returns gr WHERE gr.id = _return_id), NULL);$o$ IN d) = 0
     OR position($o$  IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN RAISE EXCEPTION 'تعديل المرتجع مسموح للمالك بس'; END IF;
$o$ IN d) = 0 THEN RAISE EXCEPTION '0132: edit_sale_return not the expected version'; END IF;
  d := replace(d, $o$FROM public.returns gr WHERE gr.id = _return_id), NULL);$o$,
                  $n$FROM public.returns gr WHERE gr.id = _return_id), 'returns.update');$n$);
  d := replace(d, $o$  IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN RAISE EXCEPTION 'تعديل المرتجع مسموح للمالك بس'; END IF;
$o$, '');
  -- keep the flag until the new return has the old date (cleared after the UPDATE)
  d := replace(d, $o$  v_new_id := (v_new->>'id')::uuid;
  PERFORM set_config('app.return_edit_id', v_prev, true);
$o$, $n$  v_new_id := (v_new->>'id')::uuid;
$n$);
  d := replace(d, $o$         recipient_name = COALESCE(recipient_name, r.recipient_name)
   WHERE id = v_new_id;
$o$, $n$         recipient_name = COALESCE(recipient_name, r.recipient_name)
   WHERE id = v_new_id;
  PERFORM set_config('app.return_edit_id', v_prev, true);
$n$);
  EXECUTE d;

  d := pg_get_functiondef('public.edit_purchase_return(uuid,text,jsonb,jsonb)'::regprocedure);
  IF position($o$FROM public.purchase_returns pr WHERE pr.id = _return_id), NULL);$o$ IN d) = 0
     OR position($o$  IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN RAISE EXCEPTION 'تعديل المرتجع مسموح للمالك بس'; END IF;
$o$ IN d) = 0
     OR position($o$  v_prev := COALESCE(current_setting('app.return_edit_id', true), '');
  PERFORM set_config('app.return_edit_id', _return_id::text, true);
  v_new := public.create_purchase_return(v_header, p_items);$o$ IN d) = 0
     OR position($o$  PERFORM public.cancel_purchase_return(_return_id, 'تعديل المرتجع: ' || btrim(_edit_reason));$o$ IN d) = 0
  THEN RAISE EXCEPTION '0132: edit_purchase_return not the expected version'; END IF;
  d := replace(d, $o$FROM public.purchase_returns pr WHERE pr.id = _return_id), NULL);$o$,
                  $n$FROM public.purchase_returns pr WHERE pr.id = _return_id), 'returns.update');$n$);
  d := replace(d, $o$  IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN RAISE EXCEPTION 'تعديل المرتجع مسموح للمالك بس'; END IF;
$o$, '');
  -- the flag is set BEFORE the cancel now (its owner check reads it) and cleared after the new return
  d := replace(d, $o$  PERFORM public.cancel_purchase_return(_return_id, 'تعديل المرتجع: ' || btrim(_edit_reason));$o$,
                  $n$  v_prev := COALESCE(current_setting('app.return_edit_id', true), '');
  PERFORM set_config('app.return_edit_id', _return_id::text, true);
  PERFORM public.cancel_purchase_return(_return_id, 'تعديل المرتجع: ' || btrim(_edit_reason));$n$);
  d := replace(d, $o$  v_prev := COALESCE(current_setting('app.return_edit_id', true), '');
  PERFORM set_config('app.return_edit_id', _return_id::text, true);
  v_new := public.create_purchase_return(v_header, p_items);$o$,
                  $n$  v_new := public.create_purchase_return(v_header, p_items);$n$);
  d := replace(d, $o$  v_new_id := (v_new->>'id')::uuid;
  PERFORM set_config('app.return_edit_id', v_prev, true);
$o$, $n$  v_new_id := (v_new->>'id')::uuid;
$n$);
  d := replace(d, $o$         invoice_date = COALESCE(r.invoice_date, r.created_at)
   WHERE id = v_new_id;
$o$, $n$         invoice_date = COALESCE(r.invoice_date, r.created_at)
   WHERE id = v_new_id;
  PERFORM set_config('app.return_edit_id', v_prev, true);
$n$);
  EXECUTE d;
END
$mig$;

-- 3) the cancels stay owner only, except inside the edit of that very return
DO $mig$
DECLARE d text; o text := 'IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN';
  n text := 'IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) AND COALESCE(current_setting(''app.return_edit_id'', true), '''') <> _return_id::text THEN';
BEGIN
  d := pg_get_functiondef('public.cancel_sale_return(uuid,text)'::regprocedure);
  IF position(n IN d) = 0 THEN
    IF position(o IN d) = 0 THEN RAISE EXCEPTION '0132: cancel_sale_return not the expected version'; END IF;
    EXECUTE replace(d, o, n);
  END IF;
  d := pg_get_functiondef('public.cancel_purchase_return(uuid,text)'::regprocedure);
  IF position(n IN d) = 0 THEN
    IF position(o IN d) = 0 THEN RAISE EXCEPTION '0132: cancel_purchase_return not the expected version'; END IF;
    EXECUTE replace(d, o, n);
  END IF;
END
$mig$;

-- 4) the new return of an edit takes the old return's date, whoever edits
DO $mig$
DECLARE d text := pg_get_functiondef('public.enforce_invoice_date_edit_permission()'::regprocedure);
  o text := $o$  IF NEW.invoice_date IS DISTINCT FROM OLD.invoice_date THEN$o$;
  n text := $n$  -- 0132: an edited return's replacement gets the old return's date from edit_sale_return / edit_purchase_return
  IF TG_TABLE_NAME IN ('returns', 'purchase_returns')
     AND NULLIF(current_setting('app.return_edit_id', true), '') IS NOT NULL
     AND (to_jsonb(NEW) ->> 'replaces_return_id') = current_setting('app.return_edit_id', true) THEN
    RETURN NEW;
  END IF;
  IF NEW.invoice_date IS DISTINCT FROM OLD.invoice_date THEN$n$;
BEGIN
  IF position('app.return_edit_id' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0132: enforce_invoice_date_edit_permission not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;
