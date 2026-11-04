-- 0148: «تسوية رصيد بدون فلوس» on «أرباح السنين اللي فاتت» (owner «ج … موافق نفذه» and «رقم 12 … موافق على اقتراحك
-- نفذ», 2026-11-04). For the import of the discounts till of شلبى (rows 6 / 9 / 10 / 11 / 13: companies' discounts paid to
-- suppliers with no money; row 12: zeroing «معرض تقسيم شلبي (حساب خاص)») and any later case like them.
--
-- `settle_contact_without_money(branch, contact, side, direction, amount, date, reason)` — owner only, a 2026 date:
--   direction 'we_owe_less' («قلّل اللي علينا ليه»): a payment voucher TO him (supplier payment / customer refund) from the
--     book vessel «خصومات / عروض الشركات» + a receipt voucher INTO that vessel from «تسوية من أرباح السنين اللي فاتت»
--     (3800). Books: Dr 2100 / 2150 (through 1460 / 2150) / Cr 3800.
--   direction 'he_owes_less' («قلّل اللي عليه», customer side only — a receipt from a supplier is not allowed): a receipt
--     voucher FROM the customer into the vessel + a payment voucher out of it to «تسوية على أرباح السنين اللي فاتت» (3800).
--     Books: Dr 3800 / Cr 1200 (through 2150).
--   The real tills never move, the vessel nets 0, 2026 profit is unchanged.
--   Example (row 12): «معرض تقسيم شلبي (حساب خاص)», 41,949.03 on 10/5, 'we_owe_less' on the side where we owe him →
--   his account 0, the till of 10/5 the same, «أرباح السنين اللي فاتت» +41,949.03.
-- Both vouchers are «internal» (flow_class) so the voucher cards do not read them as income / expense. Kept in
-- `contact_settlements` (TS#####, read only, no hard delete); `cancel_contact_settlement(id, reason)` cancels both
-- vouchers on their own day (cancel_voucher).

INSERT INTO public.voucher_categories (tenant_id, name, type, is_system, system_key, is_active, is_deductible_from_profit, gl_account_code, is_added_to_profit)
SELECT t.id, 'تسوية من أرباح السنين اللي فاتت', 'receipt', true, 'prior_years_settle_in', true, false, '3800', false FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.voucher_categories c WHERE c.tenant_id = t.id AND c.system_key = 'prior_years_settle_in');
INSERT INTO public.voucher_categories (tenant_id, name, type, is_system, system_key, is_active, is_deductible_from_profit, gl_account_code, is_added_to_profit)
SELECT t.id, 'تسوية على أرباح السنين اللي فاتت', 'payment', true, 'prior_years_settle_out', true, false, '3800', false FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.voucher_categories c WHERE c.tenant_id = t.id AND c.system_key = 'prior_years_settle_out');

CREATE SEQUENCE IF NOT EXISTS public.contact_settlement_seq;
CREATE TABLE IF NOT EXISTS public.contact_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  side text NOT NULL CHECK (side IN ('customer', 'supplier')),
  direction text NOT NULL DEFAULT 'we_owe_less' CHECK (direction IN ('we_owe_less', 'he_owes_less')),
  settlement_number text NOT NULL,
  settlement_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  contact_voucher_id uuid REFERENCES public.vouchers(id),
  offset_voucher_id uuid REFERENCES public.vouchers(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason text, cancelled_at timestamptz, cancelled_by uuid,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_settlements_contact_idx ON public.contact_settlements (contact_id, settlement_date);
ALTER TABLE public.contact_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_settlements FROM anon, authenticated;
GRANT SELECT ON public.contact_settlements TO authenticated;
DROP POLICY IF EXISTS cs_read ON public.contact_settlements;
CREATE POLICY cs_read ON public.contact_settlements FOR SELECT USING (
  (SELECT public.is_super_admin((SELECT auth.uid())))
  OR (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid())))
      OR (SELECT public.has_role((SELECT auth.uid()), 'viewer'::app_role)) OR branch_id = ANY ((SELECT public.my_branch_ids())::uuid[]))));
DROP POLICY IF EXISTS suspended_block_write ON public.contact_settlements;
CREATE POLICY suspended_block_write ON public.contact_settlements AS RESTRICTIVE FOR ALL
  USING ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()))
  WITH CHECK ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()));
DROP POLICY IF EXISTS branch_paused_read ON public.contact_settlements;
CREATE POLICY branch_paused_read ON public.contact_settlements AS RESTRICTIVE FOR SELECT USING (
  (branch_id IS NULL) OR NOT (branch_id = ANY ((SELECT public.paused_branch_ids())::uuid[]))
  OR (SELECT public.is_super_admin((SELECT auth.uid()))) OR (SELECT (public.is_admin((SELECT auth.uid())) OR public.is_owner((SELECT auth.uid())))));
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.contact_settlements;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.contact_settlements FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

CREATE OR REPLACE FUNCTION public.settle_contact_without_money(p_branch uuid, p_contact uuid, p_side text, p_direction text,
  p_amount numeric, p_date date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); c public.contacts%ROWTYPE; v_amt numeric := round(p_amount, 2);
  v_vessel text; v_cat_contact uuid; v_cat_offset uuid; v_cv uuid; v_ov uuid; v_id uuid; v_num text; v_desc text;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'التسوية بدون فلوس للمالك بس' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_access(p_branch, NULL);
  SELECT * INTO c FROM public.contacts WHERE id = p_contact AND tenant_id = v_t;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب غير موجود'; END IF;
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'اختار: حساب العميل ولا حساب المورد'; END IF;
  IF p_direction NOT IN ('we_owe_less', 'he_owes_less') THEN RAISE EXCEPTION 'اختار: نقلل اللي علينا ليه ولا اللي عليه'; END IF;
  IF p_side = 'supplier' AND p_direction = 'he_owes_less' THEN
    RAISE EXCEPTION 'تقليل اللي على المورد بيبقى «مرتجع شراء» — مفيش سند قبض من مورد';
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF p_date IS NULL OR p_date < DATE '2026-01-01' OR p_date > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ لازم يكون في 2026 ومش في المستقبل'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب التسوية'; END IF;
  SELECT payment_method INTO v_vessel FROM public.transfer_fees WHERE tenant_id = v_t AND kind = 'virtual' AND coalesce(is_enabled, true)
   ORDER BY created_at LIMIT 1;
  IF v_vessel IS NULL THEN RAISE EXCEPTION 'مفيش وعاء دفتري («خصومات / عروض الشركات») — شغّله من الإعدادات ← طرق الدفع'; END IF;
  -- a refund to a customer uses «مرتجعات للعملاء» when it is switched on, else «نثريات» (the named customer makes it a refund, 0078)
  SELECT id INTO v_cat_contact FROM public.voucher_categories WHERE tenant_id = v_t AND coalesce(is_active, true)
     AND system_key = ANY (CASE WHEN p_side = 'supplier' THEN ARRAY['supplier_payment']
                                WHEN p_direction = 'we_owe_less' THEN ARRAY['customer_return', 'other_payment'] ELSE ARRAY['installment'] END)
   ORDER BY (system_key = 'customer_return') DESC, is_system DESC LIMIT 1;
  SELECT id INTO v_cat_offset FROM public.voucher_categories WHERE tenant_id = v_t
     AND system_key = CASE WHEN p_direction = 'we_owe_less' THEN 'prior_years_settle_in' ELSE 'prior_years_settle_out' END LIMIT 1;
  IF v_cat_contact IS NULL OR v_cat_offset IS NULL THEN RAISE EXCEPTION 'تصنيفات التسوية مش موجودة'; END IF;

  v_num := 'TS' || lpad(nextval('public.contact_settlement_seq')::text, 5, '0');
  v_desc := 'تسوية بدون فلوس ' || v_num || ' على أرباح السنين اللي فاتت — ' || btrim(p_reason);
  IF p_direction = 'we_owe_less' THEN
    v_cv := public.create_manual_voucher(p_branch, 'payment', v_cat_contact, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
              p_side::voucher_party_type, c.id, c.name, v_desc, p_date, 'تسوية دفترية');
    v_ov := public.create_manual_voucher(p_branch, 'receipt', v_cat_offset, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
              'other', NULL, 'أرباح السنين اللي فاتت', v_desc, p_date, 'تسوية دفترية');
  ELSE
    v_cv := public.create_manual_voucher(p_branch, 'receipt', v_cat_contact, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
              'customer', c.id, c.name, v_desc, p_date, 'تسوية دفترية');
    v_ov := public.create_manual_voucher(p_branch, 'payment', v_cat_offset, v_amt, v_vessel, v_num, 'تسوية دفترية', 0,
              'other', NULL, 'أرباح السنين اللي فاتت', v_desc, p_date, 'تسوية دفترية');
  END IF;
  -- neither is income / expense of 2026 on the voucher cards
  UPDATE public.vouchers SET flow_class = 'internal' WHERE id IN (v_cv, v_ov);

  INSERT INTO public.contact_settlements (tenant_id, branch_id, contact_id, side, direction, settlement_number, settlement_date, amount, reason,
                                          contact_voucher_id, offset_voucher_id, created_by)
  VALUES (v_t, p_branch, c.id, p_side, p_direction, v_num, p_date, v_amt, btrim(p_reason), v_cv, v_ov, auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.ledger_refresh_contact(c.id);
  PERFORM public.ledger_gl_sync(v_t, c.id, NULL);
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), v_t, p_branch, 'CREATE', 'contact_settlement', v_id::text,
          jsonb_build_object('number', v_num, 'contact', c.name, 'side', p_side, 'direction', p_direction, 'amount', v_amt, 'date', p_date, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('id', v_id, 'settlement_number', v_num, 'contact_voucher_id', v_cv, 'offset_voucher_id', v_ov);
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_contact_settlement(p_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s public.contact_settlements%ROWTYPE;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'إلغاء التسوية للمالك بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  SELECT * INTO s FROM public.contact_settlements WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' THEN RAISE EXCEPTION 'التسوية غير موجودة أو ملغية'; END IF;
  PERFORM public.cancel_voucher(s.contact_voucher_id, 'إلغاء التسوية ' || s.settlement_number || ' — ' || btrim(p_reason));
  PERFORM public.cancel_voucher(s.offset_voucher_id, 'إلغاء التسوية ' || s.settlement_number || ' — ' || btrim(p_reason));
  UPDATE public.contact_settlements SET status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid() WHERE id = s.id;
  PERFORM public.ledger_refresh_contact(s.contact_id);
  PERFORM public.ledger_gl_sync(s.tenant_id, s.contact_id, NULL);
  RETURN jsonb_build_object('settlement_number', s.settlement_number, 'cancelled', true);
END $function$;

REVOKE ALL ON FUNCTION public.settle_contact_without_money(uuid, uuid, text, text, numeric, date, text), public.cancel_contact_settlement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_contact_without_money(uuid, uuid, text, text, numeric, date, text), public.cancel_contact_settlement(uuid, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('settle_contact_without_money', '0148', 'owner: settle a customer / supplier balance with no money, against prior years profit (3800)'),
  ('cancel_contact_settlement', '0148', 'owner: cancel that settlement (both vouchers on their own day)')
ON CONFLICT DO NOTHING;
