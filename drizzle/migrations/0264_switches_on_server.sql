-- 0264 (owner 2026-11-18 «كل زرار يشتغل فعلًا في الشاشة والسيرفر مع بعض … كمل»): every remaining action reads its switch
-- in settings, per person and branch (perm_resolve: owner always; a manager can be closed; «عرض فقط» never writes):
--   cancel_voucher              the role check after assert_access(…'.delete') is gone (a cashier with «يلغي» was refused)
--   process_sale_full           «المبيعات ← يضيف» (sales.create) — it checked only the branch
--   record_shipment_with_credit «المشتريات ← يضيف» in THAT branch (it read the switch for no branch)
--   create_product_with_opening_stock «المخزون ← يضيف» (inventory.create) — it checked the role
--   set_product_pack            «المخزون ← يعدل» in the product's branch — it checked the role
--   transfer_stock_multi_atomic «نقل المخزون ← يضيف» in the sending branch — it checked only the branch
--   create_pre_order / complete_pre_order_sale / cancel_pre_order  «طلبات الحجز ← يضيف / يعدل / يلغي»
--   disburse_employee_advance / disburse_pending_advance  «السلف ← يضيف»
--   employees (table)           write policies by «الموظفين ← يضيف / يعدل / يلغي» (was owner / admin / branch manager)
--   attendance (table)          write policies by «الحضور ← يضيف / يعدل» AND the old who-may-mark-whom rule
-- Read access of employees / attendance is kept exactly (the old write policies also let their rows be read).
-- Check: drizzle/tests/0264_checks.sql (rollback-only).

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

-- a refusal in plain Arabic, naming the switch
CREATE OR REPLACE FUNCTION public.require_switch(p_key text, p_branch uuid, p_label text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.perm_resolve(auth.uid(), p_key, p_branch) THEN
    RAISE EXCEPTION 'مش مسموحلك — الصلاحية «%» مقفولة عليك في الفرع ده (بتتفتح من الإعدادات ← الموظفين)', p_label USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.require_switch(text, uuid, text) FROM PUBLIC, anon, authenticated;

DO $m$
DECLARE d text;
BEGIN
  -- vouchers: cancel
  d := pg_get_functiondef('public.cancel_voucher(uuid,text)'::regprocedure);
  d := pg_temp.rep(d, $a$    IF NOT (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), v.branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))) THEN
      RAISE EXCEPTION 'ليس لديك صلاحية لإلغاء السند';
    END IF;$a$, $b$    -- 0264: «سندات القبض / الصرف ← يلغي» is checked by assert_access above (no role check)$b$);
  EXECUTE d;

  -- sales: add
  d := pg_get_functiondef('public.process_sale_full'::regproc);
  d := pg_temp.rep(d, $a$  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_payments IS NULL$a$, $b$  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  -- 0264: «المبيعات ← يضيف» in this branch
  PERFORM public.assert_access(p_branch_id, NULL);
  PERFORM public.require_switch('sales.create', p_branch_id, 'المبيعات ← يضيف');
  IF p_payments IS NULL$b$);
  EXECUTE d;

  -- purchases: add, in that branch
  d := pg_get_functiondef('public.record_shipment_with_credit(jsonb,jsonb,jsonb)'::regprocedure);
  d := pg_temp.rep(d, $a$  IF NOT (public.is_super_admin(v_uid) OR public.is_admin(v_uid)
          OR (public.user_in_branch(v_uid, v_branch) AND public.has_permission(v_uid, 'shipments.create'))) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تسجيل فاتورة شراء في هذا الفرع';
  END IF;$a$, $b$  -- 0264: «المشتريات ← يضيف» in this branch
  PERFORM public.assert_access(v_branch, NULL);
  PERFORM public.require_switch('shipments.create', v_branch, 'المشتريات ← يضيف');$b$);
  EXECUTE d;

  -- inventory: new product
  d := pg_get_functiondef('public.create_product_with_opening_stock'::regproc);
  d := pg_temp.rep(d, $a$  IF NOT (
    public.is_super_admin(v_user)
    OR public.has_role(v_user, 'owner'::public.app_role)
    OR public.has_role(v_user, 'admin'::public.app_role)
    OR public.user_can_write_branch(v_user, v_branch)
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لإدارة مخزون هذا الفرع';
  END IF;$a$, $b$  -- 0264: «المخزون ← يضيف» in this branch
  PERFORM public.assert_access(v_branch, NULL);
  PERFORM public.require_switch('inventory.create', v_branch, 'المخزون ← يضيف');$b$);
  EXECUTE d;

  -- inventory: pack unit = edit
  d := pg_get_functiondef('public.set_product_pack(uuid,integer,text,numeric)'::regprocedure);
  d := pg_temp.rep(d, $a$  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'branch_manager'::app_role)) THEN
    RAISE EXCEPTION 'تحديد وحدة الصنف للمدير أو المالك' USING ERRCODE = '42501';
  END IF;$a$, '');
  d := pg_temp.rep(d, $a$  IF p.id IS NULL THEN RAISE EXCEPTION 'الصنف مش موجود'; END IF;$a$, $b$  IF p.id IS NULL THEN RAISE EXCEPTION 'الصنف مش موجود'; END IF;
  -- 0264: «المخزون ← يعدل» in the product's branch
  PERFORM public.require_switch('inventory.update', p.branch_id, 'المخزون ← يعدل');$b$);
  EXECUTE d;

  -- stock transfer: add, in the sending branch
  d := pg_get_functiondef('public.transfer_stock_multi_atomic(uuid,uuid,jsonb,text,date)'::regprocedure);
  d := pg_temp.rep(d, $a$  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;$a$, $b$  -- 0264: «نقل المخزون ← يضيف» in the sending branch
  PERFORM public.assert_access(p_from_branch, NULL);
  PERFORM public.require_switch('transfers.create', p_from_branch, 'نقل المخزون ← يضيف');$b$);
  EXECUTE d;

  -- pre-orders
  d := pg_get_functiondef('public.create_pre_order'::regproc);
  d := pg_temp.rep(d, $a$  IF NOT user_in_branch(v_user, p_branch_id) THEN RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع'; END IF;$a$,
    $b$  -- 0264: «طلبات الحجز ← يضيف»
  PERFORM public.assert_access(p_branch_id, NULL);
  PERFORM public.require_switch('preorders.create', p_branch_id, 'طلبات الحجز ← يضيف');$b$);
  EXECUTE d;
  d := pg_get_functiondef('public.complete_pre_order_sale(uuid,text)'::regprocedure);
  d := pg_temp.rep(d, $a$  IF NOT public.user_in_branch(v_user, v_po.branch_id) THEN RAISE EXCEPTION 'لا تملك صلاحية'; END IF;$a$,
    $b$  -- 0264: «طلبات الحجز ← يعدل» (completing turns it into a sale)
  PERFORM public.assert_access(v_po.branch_id, NULL);
  PERFORM public.require_switch('preorders.update', v_po.branch_id, 'طلبات الحجز ← يعدل');$b$);
  EXECUTE d;
  d := pg_get_functiondef('public.cancel_pre_order(uuid,boolean)'::regprocedure);
  d := pg_temp.rep(d, $a$  IF NOT (is_admin(v_user) OR (has_role(v_user,'branch_manager') AND user_in_branch(v_user, v_po.branch_id))) THEN
    RAISE EXCEPTION 'صلاحية المدير أو مدير الفرع فقط';
  END IF;$a$, $b$  -- 0264: «طلبات الحجز ← يلغي»
  PERFORM public.require_switch('preorders.delete', v_po.branch_id, 'طلبات الحجز ← يلغي');$b$);
  EXECUTE d;

  -- advances
  d := pg_get_functiondef('public.disburse_employee_advance'::regproc);
  d := pg_temp.rep(d, $a$  IF NOT (is_admin(v_uid) OR user_can_write_branch(v_uid, v_emp.branch_id)) THEN RAISE EXCEPTION 'لا تملك صلاحية الصرف من خزينة هذا الفرع'; END IF;$a$,
    $b$  -- 0264: «السلف ← يضيف» in the employee's branch
  PERFORM public.require_switch('advances.create', v_emp.branch_id, 'السلف ← يضيف');$b$);
  EXECUTE d;
  d := pg_get_functiondef('public.disburse_pending_advance(uuid)'::regprocedure);
  d := pg_temp.rep(d, $a$  IF NOT (public.is_admin(v_user) OR (public.has_role(v_user,'branch_manager') AND public.user_in_branch(v_user, v_req.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;$a$, $b$  -- 0264: «السلف ← يضيف»
  PERFORM public.require_switch('advances.create', v_req.branch_id, 'السلف ← يضيف');$b$);
  EXECUTE d;
END $m$;

-- the signed-in user's switch, for RLS write policies (perm_resolve itself has no browser grant)
CREATE OR REPLACE FUNCTION public.my_switch(p_key text, p_branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.perm_resolve(auth.uid(), p_key, p_branch)
$$;
REVOKE ALL ON FUNCTION public.my_switch(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_switch(text, uuid) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('my_switch', '0264', 'RLS write policies: the signed-in user''s switch in a branch') ON CONFLICT DO NOTHING;

-- employees: write by the switch; read access kept as it was (the old ALL policy also let these rows be read)
CREATE POLICY emp_manage_read ON public.employees FOR SELECT TO authenticated
  USING (( SELECT is_super_admin(( SELECT auth.uid())) ) OR ((tenant_id = ( SELECT current_tenant_id())) AND (( SELECT is_admin(( SELECT auth.uid())) )
     OR ((COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = ANY (( SELECT my_branch_ids())::uuid[]))
         AND ( SELECT has_role(( SELECT auth.uid()), 'branch_manager'::app_role) )))));
-- the old «owner / admin / branch manager» write policy is switched off (kept, never matches)
ALTER POLICY emp_write ON public.employees USING (false) WITH CHECK (false);
CREATE POLICY emp_insert ON public.employees FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid())) ) OR (tenant_id = ( SELECT current_tenant_id()) AND public.my_switch('employees.create', branch_id)));
CREATE POLICY emp_update ON public.employees FOR UPDATE TO authenticated
  USING (( SELECT is_super_admin(( SELECT auth.uid())) ) OR (tenant_id = ( SELECT current_tenant_id()) AND public.my_switch('employees.update', branch_id)))
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid())) ) OR (tenant_id = ( SELECT current_tenant_id()) AND public.my_switch('employees.update', branch_id)));
CREATE POLICY emp_delete ON public.employees FOR DELETE TO authenticated
  USING (( SELECT is_super_admin(( SELECT auth.uid())) ) OR (tenant_id = ( SELECT current_tenant_id()) AND public.my_switch('employees.delete', branch_id)));

-- attendance: the switch AND the old who-may-mark-whom rule; read kept as it was
CREATE OR REPLACE FUNCTION public.attendance_switch(p_employee uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.perm_resolve(auth.uid(), p_key, (SELECT e.branch_id FROM public.employees e WHERE e.id = p_employee))
$$;
REVOKE ALL ON FUNCTION public.attendance_switch(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_switch(uuid, text) TO authenticated;
CREATE POLICY att_manage_read ON public.attendance FOR SELECT TO authenticated USING (public.can_manage_attendance_for(employee_id));
ALTER POLICY att_write ON public.attendance USING (false) WITH CHECK (false);
CREATE POLICY att_insert ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_attendance_for(employee_id) AND public.attendance_switch(employee_id, 'attendance.create'));
CREATE POLICY att_update ON public.attendance FOR UPDATE TO authenticated
  USING (public.can_manage_attendance_for(employee_id) AND public.attendance_switch(employee_id, 'attendance.update'))
  WITH CHECK (public.can_manage_attendance_for(employee_id) AND public.attendance_switch(employee_id, 'attendance.update'));
CREATE POLICY att_delete ON public.attendance FOR DELETE TO authenticated
  USING (public.can_manage_attendance_for(employee_id) AND public.attendance_switch(employee_id, 'attendance.update'));
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('attendance_switch', '0264', 'attendance write policies: the switch in the employee''s branch') ON CONFLICT DO NOTHING;
