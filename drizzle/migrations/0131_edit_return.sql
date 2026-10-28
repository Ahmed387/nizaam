-- 0131: «تعديل المرتجع» — edit a sale / purchase return (owner «نفذ», 2026-10-28)
--
-- Returns stay cancel-only: an edit = cancel the old return + a new return with the new lines / refund method, in ONE
-- transaction, dated the OLD return's day, linked by `replaces_return_id`. The old one stays in the list as «ملغي»
-- (reason «تعديل المرتجع → …»); the cancel's money goes back on the return's own day (0130), so on that day the till,
-- the books and the stock show only the difference.
-- Example: SR00076 (13/8, كنكة 280 + غسالة 1,800 = 2,080 cash). Edit to كنكة only → SR00076 cancelled, new SR000xx
-- dated 13/8 with 280 cash: 13/8 till −280 instead of −2,080, the غسالة leaves stock again (it is sold to nobody).
-- Owner only (`is_return_canceller`), 2026 returns only, not in a closed period.
-- Sale: the stock check is on the NET pulled out (old − new per product): keeping the same quantity is allowed even
-- when the returned pieces were resold (SR00059), lowering it needs the pieces still on hand. cancel_sale_return
-- skips its own check only for the return being edited (`app.return_edit_id`, set by edit_sale_return in the same
-- transaction).
-- Purchase: the pieces come back with the cancel and leave again with the new return (net = the difference).

ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS replaces_return_id uuid REFERENCES public.returns(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS replaces_return_id uuid REFERENCES public.purchase_returns(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS returns_replaces_idx ON public.returns(replaces_return_id) WHERE replaces_return_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_returns_replaces_idx ON public.purchase_returns(replaces_return_id) WHERE replaces_return_id IS NOT NULL;

-- cancel_sale_return: its «pieces resold» check is skipped for the return being edited (edit_sale_return checks the net)
DO $mig$
DECLARE v_def text; v_old text := 'IF COALESCE(v_avail,0) < it.quantity THEN';
BEGIN
  v_def := pg_get_functiondef('public.cancel_sale_return(uuid, text)'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION '0131: cancel_sale_return stock check not found'; END IF;
  v_def := replace(v_def, v_old,
    'IF COALESCE(v_avail,0) < it.quantity AND COALESCE(current_setting(''app.return_edit_id'', true), '''') <> _return_id::text THEN');
  EXECUTE v_def;
END
$mig$;

-- The new return's refund split sees the world as if the old return never happened: what the old one put on his
-- account (refund_balance_amount) counts as debt again. Without it, money he paid later (FIFO) took the re-opened
-- invoice and the new return paid cash out of the till: SR00059 (800 on account, IN03834 unpaid) came back as
-- 800 cash in the dry-run.
DO $mig$
DECLARE v_def text; v_old text := 'v_bal := LEAST(v_total, v_debt);';
BEGIN
  v_def := pg_get_functiondef('public.allocate_sale_return_settlement()'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION '0131: allocate_sale_return_settlement split not found'; END IF;
  v_def := replace(v_def, v_old, $r$IF NULLIF(current_setting('app.return_edit_id', true), '') IS NOT NULL THEN
    v_debt := GREATEST(v_debt, COALESCE((SELECT o.refund_balance_amount FROM public.returns o
                WHERE o.id = current_setting('app.return_edit_id', true)::uuid AND o.invoice_id = NEW.invoice_id), 0));
  END IF;
  v_bal := LEAST(v_total, v_debt);$r$);
  EXECUTE v_def;

  v_def := pg_get_functiondef('public.allocate_purchase_return_settlement()'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION '0131: allocate_purchase_return_settlement split not found'; END IF;
  v_def := replace(v_def, v_old, $r$IF NULLIF(current_setting('app.return_edit_id', true), '') IS NOT NULL THEN
    v_debt := GREATEST(v_debt, COALESCE((SELECT o.refund_balance_amount FROM public.purchase_returns o
                WHERE o.id = current_setting('app.return_edit_id', true)::uuid AND o.shipment_id = NEW.shipment_id), 0));
  END IF;
  v_bal := LEAST(v_total, v_debt);$r$);
  EXECUTE v_def;
END
$mig$;

CREATE OR REPLACE FUNCTION public.edit_sale_return(
  _return_id uuid, _edit_reason text, _reason text, _notes text,
  _refund_method text, _refund_reference text, _refund_account text, _items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; it record; v_avail numeric; v_prev text; v_new jsonb; v_new_id uuid; n record;
BEGIN
  PERFORM public.assert_access((SELECT gr.branch_id FROM public.returns gr WHERE gr.id = _return_id), NULL);
  IF _edit_reason IS NULL OR btrim(_edit_reason) = '' THEN RAISE EXCEPTION 'لازم تكتب سبب التعديل'; END IF;

  SELECT * INTO r FROM public.returns WHERE id = _return_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'المرتجع مش موجود'; END IF;
  IF COALESCE(r.status, 'active') <> 'active' THEN RAISE EXCEPTION 'المرتجع ده متلغي — مينفعش يتعدل'; END IF;
  IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN RAISE EXCEPTION 'تعديل المرتجع مسموح للمالك بس'; END IF;
  IF r.migration_batch_id IS NOT NULL
     OR public.ledger_day(COALESCE(r.invoice_date, r.created_at)) < public.ledger_cutoff() THEN
    RAISE EXCEPTION 'مرتجع قبل 2026 (أرشيف) — مينفعش يتعدل';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'اختر منتج واحد على الأقل — لو عاوز تشيل المرتجع كله استخدم «إلغاء المرتجع»';
  END IF;

  -- net stock check: what leaves the stock (old − new) must still be on hand
  FOR it IN
    SELECT x.product_id, sum(x.q) AS pull, (SELECT p.name FROM public.products p WHERE p.id = x.product_id) AS pname
      FROM (SELECT ri.product_id, ri.quantity::numeric AS q FROM public.return_items ri
             WHERE ri.return_id = _return_id AND ri.product_id IS NOT NULL
            UNION ALL
            SELECT NULLIF(e->>'product_id', '')::uuid, -COALESCE((e->>'quantity')::numeric, 0)
              FROM jsonb_array_elements(_items) e) x
     WHERE x.product_id IS NOT NULL
     GROUP BY x.product_id HAVING sum(x.q) > 0
  LOOP
    SELECT quantity INTO v_avail FROM public.products WHERE id = it.product_id FOR UPDATE;
    IF COALESCE(v_avail, 0) < it.pull THEN
      RAISE EXCEPTION 'مينفعش تقلّل % — القطع اللي رجعت اتباعت تاني (المتاح % والمطلوب سحبه %)',
        COALESCE(it.pname, ''), COALESCE(v_avail, 0), it.pull;
    END IF;
  END LOOP;

  v_prev := COALESCE(current_setting('app.return_edit_id', true), '');
  PERFORM set_config('app.return_edit_id', _return_id::text, true);
  PERFORM public.cancel_sale_return(_return_id, 'تعديل المرتجع: ' || btrim(_edit_reason));

  -- still set: the new return's split counts what the old one put on his account (allocate_sale_return_settlement)
  v_new := public.register_sale_return_full(
    r.invoice_id, COALESCE(NULLIF(btrim(_reason), ''), r.reason), COALESCE(_notes, r.notes), 'active',
    _refund_method, _refund_reference, _refund_account, 0, 0, 0, _items);
  v_new_id := (v_new->>'id')::uuid;
  PERFORM set_config('app.return_edit_id', v_prev, true);

  -- on the old return's day (zz_return_dates_sync moves its journal, refund voucher and till row)
  UPDATE public.returns
     SET replaces_return_id = _return_id,
         invoice_date = COALESCE(r.invoice_date, r.created_at),
         recipient_name = COALESCE(recipient_name, r.recipient_name)
   WHERE id = v_new_id;

  SELECT * INTO n FROM public.returns WHERE id = v_new_id;
  PERFORM public._audit_write(r.tenant_id, 'sale_return', n.id, COALESCE(n.return_number, ''),
    'edit', COALESCE(r.total_refund, 0), COALESCE(n.total_refund, 0), r.branch_id,
    'تعديل ' || COALESCE(r.return_number, '') || ': ' || btrim(_edit_reason), 'manual',
    (SELECT COALESCE(sum(quantity), 0) FROM public.return_items WHERE return_id = n.id));

  RETURN jsonb_build_object('ok', true, 'id', n.id, 'return_number', n.return_number,
    'old_return_number', r.return_number, 'old_total', r.total_refund, 'total_refund', n.total_refund,
    'cash_refund', n.refund_cash_amount, 'transfer_refund', n.refund_transfer_amount,
    'applied_to_debt', n.refund_balance_amount, 'refund_method', n.refund_method);
END $function$;

CREATE OR REPLACE FUNCTION public.edit_purchase_return(_return_id uuid, _edit_reason text, p_header jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_new jsonb; v_new_id uuid; n record; v_header jsonb; v_prev text;
BEGIN
  PERFORM public.assert_access((SELECT pr.branch_id FROM public.purchase_returns pr WHERE pr.id = _return_id), NULL);
  IF _edit_reason IS NULL OR btrim(_edit_reason) = '' THEN RAISE EXCEPTION 'لازم تكتب سبب التعديل'; END IF;

  SELECT * INTO r FROM public.purchase_returns WHERE id = _return_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'المرتجع مش موجود'; END IF;
  IF COALESCE(r.status, 'active') <> 'active' THEN RAISE EXCEPTION 'المرتجع ده متلغي — مينفعش يتعدل'; END IF;
  IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN RAISE EXCEPTION 'تعديل المرتجع مسموح للمالك بس'; END IF;
  IF r.migration_batch_id IS NOT NULL
     OR public.ledger_day(COALESCE(r.invoice_date, r.created_at)) < public.ledger_cutoff() THEN
    RAISE EXCEPTION 'مرتجع قبل 2026 (أرشيف) — مينفعش يتعدل';
  END IF;
  IF r.shipment_id IS NULL THEN RAISE EXCEPTION 'المرتجع ده مش مربوط بفاتورة شراء — مينفعش يتعدل'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'اختر منتج واحد على الأقل — لو عاوز تشيل المرتجع كله استخدم «إلغاء المرتجع»';
  END IF;

  PERFORM public.cancel_purchase_return(_return_id, 'تعديل المرتجع: ' || btrim(_edit_reason));

  -- same invoice, dated today here and moved to the old day below (the old day may be any 2026 day)
  v_header := COALESCE(p_header, '{}'::jsonb)
    || jsonb_build_object('shipment_id', r.shipment_id, 'invoice_date', NULL,
                          'reason', COALESCE(NULLIF(btrim(p_header->>'reason'), ''), r.reason),
                          'notes', COALESCE(p_header->>'notes', r.notes),
                          'recipient_name', COALESCE(NULLIF(btrim(p_header->>'recipient_name'), ''), r.recipient_name));
  v_prev := COALESCE(current_setting('app.return_edit_id', true), '');
  PERFORM set_config('app.return_edit_id', _return_id::text, true);
  v_new := public.create_purchase_return(v_header, p_items);
  v_new_id := (v_new->>'id')::uuid;
  PERFORM set_config('app.return_edit_id', v_prev, true);

  UPDATE public.purchase_returns
     SET replaces_return_id = _return_id,
         invoice_date = COALESCE(r.invoice_date, r.created_at)
   WHERE id = v_new_id;

  SELECT * INTO n FROM public.purchase_returns WHERE id = v_new_id;
  PERFORM public._audit_write(r.tenant_id, 'purchase_return', n.id, COALESCE(n.return_number, ''),
    'edit', COALESCE(r.total_amount, 0), COALESCE(n.total_amount, 0), r.branch_id,
    'تعديل ' || COALESCE(r.return_number, '') || ': ' || btrim(_edit_reason), 'manual',
    (SELECT COALESCE(sum(quantity), 0) FROM public.purchase_return_items WHERE purchase_return_id = n.id));

  RETURN jsonb_build_object('ok', true, 'id', n.id, 'return_number', n.return_number,
    'old_return_number', r.return_number, 'old_total', r.total_amount, 'total_amount', n.total_amount,
    'refund_cash_amount', n.refund_cash_amount, 'refund_transfer_amount', n.refund_transfer_amount,
    'refund_balance_amount', n.refund_balance_amount);
END $function$;

REVOKE ALL ON FUNCTION public.edit_sale_return(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_purchase_return(uuid, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_sale_return(uuid, text, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_purchase_return(uuid, text, jsonb, jsonb) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('edit_sale_return', '0131', 'owner: edit a sale return = cancel + new return on the old day'),
  ('edit_purchase_return', '0131', 'owner: edit a purchase return = cancel + new return on the old day')
ON CONFLICT DO NOTHING;
