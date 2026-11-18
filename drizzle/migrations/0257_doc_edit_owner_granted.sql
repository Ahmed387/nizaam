-- 0257 (owner 2026-11-18 «مقفولة لكل الموظفين في الأول مفيش استثناء وصاحب الشركة هوا اللي بيدي السماحية دي نفذ»،
--       «السندات (قبض وصرف) وتغيير تاريخ الفاتورة، يمشوا بنفس القاعدة نفذ»):
-- Who may ASK to edit a document (every edit still goes to the owner for approval, 0141 / 0256):
--   doc_edit_sales.update      sale invoices: lines, date, restore from «الملغاة»
--   doc_edit_purchases.update  purchase invoices: lines, date, restore
--   doc_edit_returns.update    sale and purchase returns: edit, restore
--   doc_edit_vouchers.update   receipt and payment vouchers: edit, restore
-- These keys are OWNER-GRANTED ONLY: `perm_resolve` gives them to the owner / super admin, otherwise ONLY a per-employee rule
-- (that branch, then every branch) counts — no manager «كله مفتوح», no role, template, company role or default, and a «عرض فقط»
-- branch never has them. Nobody has one today. Only the company owner can write them: `save_user_permissions` /
-- `copy_user_permissions` called by anyone else keep the employee's existing doc_edit rules untouched.
-- `request_document_edit` checks these keys instead of sales.update / shipments.update / returns.update / *_vouchers.create.

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

-- 1) the resolver
DO $m$
DECLARE d text := pg_get_functiondef('public.perm_resolve(uuid,text,uuid)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$    RETURN true;
  END IF;
  IF _branch IS NOT NULL THEN$a$, $b$    RETURN true;
  END IF;
  -- 0257: owner-granted keys — only the employee's own rule counts
  IF _key ~ '^doc_edit_[a-z]+\.update$' THEN
    IF _branch IS NOT NULL THEN
      SELECT coalesce(bu.access_level, 'manage') INTO v_level FROM public.branch_users bu WHERE bu.user_id = _uid AND bu.branch_id = _branch;
      IF v_level = 'read' THEN RETURN false; END IF;
      SELECT up.allowed INTO v FROM public.user_permissions up
       WHERE up.user_id = _uid AND up.tenant_id = v_tenant AND up.permission_key = _key AND up.branch_id = _branch LIMIT 1;
      IF v IS NOT NULL THEN RETURN v; END IF;
    END IF;
    SELECT up.allowed INTO v FROM public.user_permissions up
     WHERE up.user_id = _uid AND up.tenant_id = v_tenant AND up.permission_key = _key AND up.branch_id IS NULL LIMIT 1;
    RETURN coalesce(v, false);
  END IF;
  -- 0257: while an owner-approved request of THIS employee runs (0256), the old edit keys the edit functions check are his
  IF _key IN ('sales.update', 'shipments.update', 'returns.update')
     AND EXISTS (SELECT 1 FROM public.approval_requests ar
                  WHERE ar.id::text = nullif(current_setting('app.approved_edit', true), '')
                    AND ar.requested_by = _uid AND ar.status = 'pending' AND ar.tenant_id = v_tenant) THEN
    RETURN true;
  END IF;
  IF _branch IS NOT NULL THEN$b$);
  EXECUTE d;
END $m$;

-- 2) only the owner writes them
DO $m$
DECLARE d text := pg_get_functiondef('public.save_user_permissions(uuid,jsonb)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$  DELETE FROM public.user_permissions WHERE user_id = p_user AND tenant_id = v_tenant;
  INSERT INTO public.user_permissions (tenant_id, user_id, permission_key, allowed, branch_id)
  SELECT DISTINCT ON (r->>'key', nullif(r->>'branch', '')) v_tenant, p_user, r->>'key', (r->>'allowed')::boolean, nullif(r->>'branch', '')::uuid
    FROM jsonb_array_elements(p_rows) r;$a$,
  $b$  -- 0257: doc_edit_* are written by the company owner only; anybody else's save keeps them as they are
  DELETE FROM public.user_permissions WHERE user_id = p_user AND tenant_id = v_tenant
     AND (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid()) OR permission_key !~ '^doc_edit_');
  INSERT INTO public.user_permissions (tenant_id, user_id, permission_key, allowed, branch_id)
  SELECT DISTINCT ON (r->>'key', nullif(r->>'branch', '')) v_tenant, p_user, r->>'key', (r->>'allowed')::boolean, nullif(r->>'branch', '')::uuid
    FROM jsonb_array_elements(p_rows) r
   WHERE public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid()) OR (r->>'key') !~ '^doc_edit_';$b$);
  EXECUTE d;
END $m$;

DO $m$
DECLARE d text := pg_get_functiondef('public.copy_user_permissions(uuid,uuid,boolean,boolean)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$  DELETE FROM public.user_permissions WHERE user_id = p_to AND tenant_id = v_tenant;
  INSERT INTO public.user_permissions (tenant_id, user_id, permission_key, allowed, branch_id)
  SELECT v_tenant, p_to, permission_key, allowed, branch_id FROM public.user_permissions
   WHERE user_id = p_from AND tenant_id = v_tenant;$a$,
  $b$  -- 0257: doc_edit_* are copied / replaced only when the company owner does it
  DELETE FROM public.user_permissions WHERE user_id = p_to AND tenant_id = v_tenant
     AND (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid()) OR permission_key !~ '^doc_edit_');
  INSERT INTO public.user_permissions (tenant_id, user_id, permission_key, allowed, branch_id)
  SELECT v_tenant, p_to, permission_key, allowed, branch_id FROM public.user_permissions
   WHERE user_id = p_from AND tenant_id = v_tenant
     AND (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid()) OR permission_key !~ '^doc_edit_');$b$);
  EXECUTE d;
END $m$;

-- 3) the request door checks the new keys
DO $m$
DECLARE d text := pg_get_functiondef('public.request_document_edit(text,uuid,text,jsonb,text)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$v_perm := 'sales.update';$a$, $b$v_perm := 'doc_edit_sales.update';$b$);
  d := pg_temp.rep(d, $a$v_perm := 'shipments.update';$a$, $b$v_perm := 'doc_edit_purchases.update';$b$);
  d := pg_temp.rep(d, $a$      SELECT branch_id, tenant_id INTO v_branch, v_tenant FROM public.returns WHERE id = p_entity_id;
      v_perm := 'returns.update';$a$, $b$      SELECT branch_id, tenant_id INTO v_branch, v_tenant FROM public.returns WHERE id = p_entity_id;
      v_perm := 'doc_edit_returns.update';$b$);
  d := pg_temp.rep(d, $a$      SELECT branch_id, tenant_id INTO v_branch, v_tenant FROM public.purchase_returns WHERE id = p_entity_id;
      v_perm := 'returns.update';$a$, $b$      SELECT branch_id, tenant_id INTO v_branch, v_tenant FROM public.purchase_returns WHERE id = p_entity_id;
      v_perm := 'doc_edit_returns.update';$b$);
  d := pg_temp.rep(d, $a$CASE WHEN type = 'receipt' THEN 'receipt_vouchers.create' ELSE 'payment_vouchers.create' END$a$,
    $b$'doc_edit_vouchers.update'$b$);
  EXECUTE d;
END $m$;

-- 4) a return's date changed directly (bulk «تعديل الكل» / ReturnEditDialog) was open to any admin with no approval:
--    now the owner only (anybody else edits the return through «تعديل المرتجع» → owner's approval)
DO $m$
DECLARE d text := pg_get_functiondef('public.update_return_sovereign(text,uuid,date,text)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'owner')) THEN
    RAISE EXCEPTION 'تعديل المرتجع متاح للإدارة فقط';
  END IF;$a$,
    $b$IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'تعديل تاريخ المرتجع لصاحب الشركة بس — غيرك يطلب «تعديل المرتجع» ويستنى موافقته'; END IF;$b$);
  EXECUTE d;
END $m$;
