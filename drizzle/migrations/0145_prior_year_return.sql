-- 0145: «مرتجع فاتورة قبل 2026» — a special return the owner enters by hand (owner «نفذ», 2026-10-30)
--
-- After the wipe the system holds 2026 only, so a customer who brings back something bought in 2025 has no invoice to
-- return against. The owner types everything: the customer, the item, the price he gives back, the cost the piece goes
-- back into stock at, and whether the money is paid back now or stays on his account.
-- It is a 2025 adjustment: it does NOT touch 2026 sales or profit.
--   Example: a fan sold in 12/2025 for 1,500 comes back on 5/11/2026; the owner says cost 1,200, pay back cash.
--   → stock +1 at 1,200 (it moves the average like any incoming piece), the till −1,500 that day, and the books:
--     Dr inventory 1,200 + Dr «الأرباح المحتجزة» 300 / Cr cash 1,500. Sales of November: unchanged.
--   «على حسابه» instead: the same, then a receipt from him of 1,500 the same day (till +1,500) → his advance 1,500
--   (Dr cash / Cr customer advances, through the ledger like any receipt).
-- Owner only. One row per return in `prior_year_returns` (lines in `items`), written only by this function, never
-- deleted. The incoming pieces are product_batches of type 'prior_year_return', read by product_cost_ledger.

CREATE SEQUENCE IF NOT EXISTS public.prior_year_return_seq;

CREATE TABLE IF NOT EXISTS public.prior_year_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  contact_id uuid REFERENCES public.contacts(id),
  return_number text NOT NULL,
  return_date date NOT NULL,
  items jsonb NOT NULL,
  total_price numeric(14,2) NOT NULL,
  total_cost numeric(14,2) NOT NULL,
  money_mode text NOT NULL CHECK (money_mode IN ('refund', 'account')),
  payment_method text NOT NULL DEFAULT 'cash',
  treasury_id uuid REFERENCES public.treasury(id),
  deposit_voucher_id uuid REFERENCES public.vouchers(id),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prior_year_returns_branch_idx ON public.prior_year_returns (branch_id, return_date);
ALTER TABLE public.prior_year_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prior_year_returns FROM anon, authenticated;
GRANT SELECT ON public.prior_year_returns TO authenticated;
DROP POLICY IF EXISTS pyr_read ON public.prior_year_returns;
CREATE POLICY pyr_read ON public.prior_year_returns FOR SELECT USING (
  (SELECT public.is_super_admin((SELECT auth.uid())))
  OR (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid())))
      OR (SELECT public.has_role((SELECT auth.uid()), 'viewer'::app_role)) OR branch_id = ANY ((SELECT public.my_branch_ids())::uuid[]))));
DROP POLICY IF EXISTS suspended_block_write ON public.prior_year_returns;
CREATE POLICY suspended_block_write ON public.prior_year_returns AS RESTRICTIVE FOR ALL
  USING ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()))
  WITH CHECK ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()));
DROP POLICY IF EXISTS branch_paused_read ON public.prior_year_returns;
CREATE POLICY branch_paused_read ON public.prior_year_returns AS RESTRICTIVE FOR SELECT USING (
  (branch_id IS NULL) OR NOT (branch_id = ANY ((SELECT public.paused_branch_ids())::uuid[]))
  OR (SELECT public.is_super_admin((SELECT auth.uid()))) OR (SELECT (public.is_admin((SELECT auth.uid())) OR public.is_owner((SELECT auth.uid())))));
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.prior_year_returns;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.prior_year_returns FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- the pieces that come back enter the moving average at the cost the owner typed
DO $mig$
DECLARE d text := pg_get_functiondef('public.product_cost_ledger(uuid,timestamptz,uuid)'::regprocedure);
  o text := $o$FROM product_batches b WHERE b.product_id = p_product AND b.batch_type = 'opening_stock'$o$;
  n text := $n$FROM product_batches b WHERE b.product_id = p_product AND b.batch_type IN ('opening_stock', 'prior_year_return')$n$;
BEGIN
  IF position('prior_year_return' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0145: product_cost_ledger not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

CREATE OR REPLACE FUNCTION public.record_prior_year_return(p_branch uuid, p_contact uuid, p_date date, p_items jsonb,
  p_money_mode text, p_method text DEFAULT 'cash', p_notes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v_id uuid := gen_random_uuid(); v_no text; it jsonb; v_pid uuid; v_qty numeric; v_price numeric; v_cost numeric;
  v_total numeric := 0; v_cost_total numeric := 0; v_lines jsonb := '[]'::jsonb; v_tr uuid; v_dep uuid; v_cat uuid;
  v_at timestamptz; v_cname text; v_pm text := coalesce(nullif(p_method, ''), 'cash');
BEGIN
  IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'مرتجع فاتورة قبل 2026 للمالك بس' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_access(p_branch, NULL);
  SELECT tenant_id INTO v_t FROM public.branches WHERE id = p_branch;
  IF p_money_mode NOT IN ('refund', 'account') THEN RAISE EXCEPTION 'اختار: الفلوس ترجع دلوقتي ولا تفضل على حسابه'; END IF;
  IF p_money_mode = 'account' AND p_contact IS NULL THEN RAISE EXCEPTION '«على حسابه» محتاج اسم العميل'; END IF;
  IF p_contact IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact AND tenant_id = v_t) THEN
    RAISE EXCEPTION 'العميل غير موجود';
  END IF;
  IF p_date IS NULL OR p_date > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ غلط'; END IF;
  IF p_date < public.ledger_cutoff() THEN RAISE EXCEPTION 'المرتجع نفسه بيتسجل بتاريخ 2026 أو بعده (الفاتورة هي اللي قبل 2026)'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'ضيف صنف واحد على الأقل'; END IF;
  IF NOT public.vessel_is_known(v_t, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;
  SELECT name INTO v_cname FROM public.contacts WHERE id = p_contact;

  v_no := 'RY' || lpad(nextval('public.prior_year_return_seq')::text, 5, '0');
  v_at := (p_date + time '12:00') AT TIME ZONE 'Africa/Cairo';

  -- the pieces back into stock at the owner's cost
  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_pid := nullif(it->>'product_id', '')::uuid;
    v_qty := coalesce((it->>'quantity')::numeric, 0);
    v_price := coalesce((it->>'price')::numeric, 0);
    v_cost := coalesce((it->>'cost')::numeric, 0);
    IF v_pid IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_pid AND branch_id = p_branch) THEN
      RAISE EXCEPTION 'الصنف مش في الفرع ده';
    END IF;
    IF v_qty <= 0 OR v_price < 0 OR v_cost < 0 THEN RAISE EXCEPTION 'الكمية والسعر والتكلفة لازم تكون أرقام صح'; END IF;
    INSERT INTO public.product_batches (tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
                                        cost_price, base_purchase_price, true_unit_cost, batch_type, effective_at)
    VALUES (v_t, p_branch, v_pid, v_qty, v_qty, v_cost, v_cost, v_cost, 'prior_year_return', v_at);
    PERFORM public.stock_mv_ctx('return_in', 'prior_year_return', v_id, v_pid, v_at);
    UPDATE public.products SET quantity = quantity + v_qty WHERE id = v_pid;
    v_total := v_total + round(v_qty * v_price, 2);
    v_cost_total := v_cost_total + round(v_qty * v_cost, 2);
    v_lines := v_lines || jsonb_build_object('product_id', v_pid, 'name', (SELECT name FROM public.products WHERE id = v_pid),
                                             'quantity', v_qty, 'price', v_price, 'cost', v_cost);
  END LOOP;

  -- the money given back (no customer link: it is compensation for goods, not money on his account)
  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                               payment_method, transaction_date, created_at)
  VALUES (p_branch, v_t, 'expense', 'prior_year_return', v_total,
          'مرتجع فاتورة قبل 2026 ' || v_no || coalesce(' — ' || v_cname, ''), v_id, auth.uid(), v_pm, p_date, v_at)
  RETURNING id INTO v_tr;
  PERFORM set_config('app.skip_treasury_voucher', '0', true);

  -- the books: inventory at the owner's cost, the rest against last years' profit — not 2026 sales
  PERFORM public.post_journal(v_t, p_date, 'مرتجع فاتورة قبل 2026 ' || v_no, 'treasury_row', v_tr,
    jsonb_build_array(
      jsonb_build_object('account_code', '1300', 'debit', v_cost_total, 'credit', 0, 'description', 'بضاعة رجعت (فاتورة قبل 2026)'),
      jsonb_build_object('account_code', '3800', 'debit', greatest(v_total - v_cost_total, 0), 'credit', greatest(v_cost_total - v_total, 0),
                         'description', 'تسوية أرباح سنوات سابقة'),
      jsonb_build_object('account_code', '1100', 'debit', 0, 'credit', v_total, 'description', 'رد قيمة المرتجع')));

  -- «على حسابه»: he hands the money straight back as money on his account (an ordinary receipt)
  IF p_money_mode = 'account' AND v_total > 0 THEN
    SELECT id INTO v_cat FROM public.voucher_categories WHERE tenant_id = v_t AND type = 'receipt' AND system_key = 'installment' LIMIT 1;
    v_dep := public.create_manual_voucher(p_branch, 'receipt', v_cat, v_total, v_pm, NULL, NULL, 0, 'customer', p_contact, v_cname,
      'قيمة مرتجع فاتورة قبل 2026 ' || v_no || ' — اتحطت تحت حسابه', p_date, NULL);
  END IF;

  INSERT INTO public.prior_year_returns (id, tenant_id, branch_id, contact_id, return_number, return_date, items, total_price,
                                         total_cost, money_mode, payment_method, treasury_id, deposit_voucher_id, notes, created_by)
  VALUES (v_id, v_t, p_branch, p_contact, v_no, p_date, v_lines, v_total, v_cost_total, p_money_mode, v_pm, v_tr, v_dep,
          nullif(p_notes, ''), auth.uid());

  PERFORM public.refresh_product_avg_cost(x) FROM (SELECT DISTINCT (e->>'product_id')::uuid x FROM jsonb_array_elements(v_lines) e) z;
  IF p_contact IS NOT NULL THEN PERFORM public.ledger_refresh_contact(p_contact); END IF;

  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), v_t, p_branch, 'CREATE',
          'prior_year_return', v_id::text, jsonb_build_object('number', v_no, 'total', v_total, 'cost', v_cost_total, 'mode', p_money_mode));
  RETURN jsonb_build_object('id', v_id, 'return_number', v_no, 'total', v_total, 'cost', v_cost_total,
                            'treasury_id', v_tr, 'deposit_voucher_id', v_dep);
END $function$;
REVOKE ALL ON FUNCTION public.record_prior_year_return(uuid, uuid, date, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_prior_year_return(uuid, uuid, date, jsonb, text, text, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('record_prior_year_return', '0145', 'owner: a return of an invoice from before 2026 (a 2025 adjustment, not 2026 sales)')
ON CONFLICT DO NOTHING;
