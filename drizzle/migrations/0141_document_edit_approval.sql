-- 0141: editing a document = the owner directly, everybody else through «طلب موافقة» (owner «نفذ», 2026-10-30)
--
-- Sale, purchase, sale return, purchase return, voucher and the date of an invoice: the OWNER edits directly; anybody
-- else who has the edit permission sends a request that shows «قبل ← بعد»; the owner approves it and the edit runs
-- under his name (the same server functions). Notes / recipient stay a plain text edit (no money moves).
--   Example: the cashier of سكة changes IN04970 from 2 fridges to 1 → request «تعديل فاتورة IN04970: الكمية 2 ← 1»
--   → the owner approves → edit_invoice runs → stock +1, the invoice and its books change.
-- A sale / purchase invoice that has active returns asks the owner first (here or on the request):
--   «الغي المرتجع وكمّل» (return_action 'cancel': the returns are cancelled first, on their own day),
--   «سيب المرتجع وكمّل» (return_action 'keep': the invoice changes, the return stays; negative stock is accepted),
--   «عدّل المرتجع» (the screen opens the return's edit) or «رجوع».
--   Example: 5 fridges, 2 returned, edited to 1 with the return kept → the return gives back 1 more than was sold.
-- If the new total is below what was paid: «يفضل على حسابه» (the surplus stays as his advance — the ledger does it)
-- or «يرجعله دلوقتي» (a refund voucher to the customer from the vessel he paid with, on today, with its fee).

CREATE OR REPLACE FUNCTION public.doc_edit_is_direct()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT auth.uid() IS NOT NULL AND (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid()));
$function$;
REVOKE ALL ON FUNCTION public.doc_edit_is_direct() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_edit_is_direct() TO authenticated;

-- the gate at the top of every edit function
DO $mig$
DECLARE f text; d text; i int;
  gate text := E'\nBEGIN\n  -- 0141: only the owner edits directly; everybody else sends «طلب موافقة»\n'
            || E'  IF NOT public.doc_edit_is_direct() THEN\n'
            || E'    RAISE EXCEPTION ''التعديل محتاج موافقة المالك — ابعت طلب تعديل'' USING ERRCODE = ''42501'';\n'
            || E'  END IF;\n';
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.edit_invoice(uuid,uuid,jsonb,numeric,numeric)',
    'public.edit_shipment(uuid,jsonb,jsonb)',
    'public.edit_sale_return(uuid,text,text,text,text,text,text,jsonb)',
    'public.edit_purchase_return(uuid,text,jsonb,jsonb)',
    'public.edit_voucher(uuid,uuid,numeric,text,date,voucher_party_type,uuid,text,text,text,text,text,numeric,text)',
    'public.update_invoice_date_sovereign(uuid,timestamptz,text)',
    'public.update_shipment_date(uuid,timestamptz,text)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    CONTINUE WHEN position('0141: only the owner edits directly' IN d) > 0;
    i := position(E'\nBEGIN\n' IN d);
    IF i = 0 THEN RAISE EXCEPTION '0141: % has no BEGIN line', f; END IF;
    d := overlay(d placing gate from i for length(E'\nBEGIN\n'));
    EXECUTE d;
  END LOOP;
END
$mig$;

-- edit_invoice: the owner may keep the returns of the invoice (app.edit_keep_returns, set by apply_document_edit)
DO $mig$
DECLARE d text := pg_get_functiondef('public.edit_invoice(uuid,uuid,jsonb,numeric,numeric)'::regprocedure);
  o1 text := $o$  IF v_returned > 0 THEN
    RAISE EXCEPTION 'مش ممكن تعديل فاتورة عليها مرتجع. ألغي المرتجع الأول أو اعمل مرتجع جديد بدل التعديل.';
  END IF;$o$;
  n1 text := $n$  IF v_returned > 0 AND coalesce(current_setting('app.edit_keep_returns', true), '') <> '1' THEN
    RAISE EXCEPTION 'الفاتورة عليها مرتجع — اختار: تلغي المرتجع، ولا تسيبه، ولا تعدّله';
  END IF;$n$;
  o2 text := $o$  -- 0085: the till is not touched here (payments change only through edit / void of the payment)
  PERFORM public.repost_invoice_journal(_invoice_id);$o$;
  n2 text := $n$  -- 0085: the till is not touched here (payments change only through edit / void of the payment)
  PERFORM public.repost_invoice_journal(_invoice_id);

  -- 0141: the kept returns stay on the invoice — what came back is written on the new lines again (one line per
  -- product takes it, never above its quantity) and the returns' books follow the new costs
  IF v_returned > 0 THEN
    UPDATE public.invoice_items ii SET returned_quantity = LEAST(ii.quantity, q.qty)
      FROM (SELECT DISTINCT ON (x.product_id) x.id, r.qty
              FROM public.invoice_items x
              JOIN (SELECT ri.product_id, sum(ri.quantity) AS qty FROM public.return_items ri JOIN public.returns rt ON rt.id = ri.return_id
                     WHERE rt.invoice_id = _invoice_id AND coalesce(rt.status, 'active') = 'active' GROUP BY 1) r ON r.product_id = x.product_id
             WHERE x.invoice_id = _invoice_id ORDER BY x.product_id, x.quantity DESC, x.id) q
     WHERE ii.id = q.id;
    PERFORM public.sync_sale_return_journal(rt.id) FROM public.returns rt
     WHERE rt.invoice_id = _invoice_id AND coalesce(rt.status, 'active') = 'active';
  END IF;$n$;
BEGIN
  IF position('app.edit_keep_returns' IN d) > 0 THEN RETURN; END IF;
  IF position(o1 IN d) = 0 OR position(o2 IN d) = 0 THEN RAISE EXCEPTION '0141: edit_invoice not the expected version'; END IF;
  d := replace(d, o1, n1);
  d := replace(d, o2, n2);
  EXECUTE d;
END
$mig$;

-- one place that runs an edit: the owner directly, or the approval of a request
CREATE OR REPLACE FUNCTION public.apply_document_edit(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a jsonb := coalesce(p->'args', '{}'::jsonb); v_rpc text := p->>'rpc'; v_res jsonb; r text; v_ra text := coalesce(p->>'return_action', '');
  v_ex jsonb := p->'excess'; v_cat uuid; v_inv record; v_voucher uuid;
BEGIN
  IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'التعديل محتاج موافقة المالك — ابعت طلب تعديل' USING ERRCODE = '42501'; END IF;

  -- the owner's answer about the returns of the invoice
  IF v_ra = 'cancel' THEN
    FOR r IN SELECT jsonb_array_elements_text(coalesce(p->'return_ids', '[]'::jsonb)) LOOP
      IF v_rpc = 'edit_shipment' THEN PERFORM public.cancel_purchase_return(r::uuid, 'تعديل فاتورة الشراء: إلغاء المرتجع');
      ELSE PERFORM public.cancel_sale_return(r::uuid, 'تعديل الفاتورة: إلغاء المرتجع'); END IF;
    END LOOP;
  ELSIF v_ra = 'keep' THEN
    PERFORM set_config('app.edit_keep_returns', '1', true);
  END IF;

  CASE v_rpc
    WHEN 'edit_invoice' THEN
      PERFORM public.edit_invoice((a->>'_invoice_id')::uuid, nullif(a->>'_customer_id', '')::uuid, a->'_items',
                                  nullif(a->>'_vat_rate', '')::numeric, nullif(a->>'_discount_amount', '')::numeric);
      v_res := jsonb_build_object('ok', true);
    WHEN 'edit_shipment' THEN
      v_res := public.edit_shipment((a->>'p_shipment_id')::uuid, a->'p_header', a->'p_items');
    WHEN 'edit_sale_return' THEN
      v_res := to_jsonb(public.edit_sale_return((a->>'_return_id')::uuid, a->>'_edit_reason', a->>'_reason', a->>'_notes',
                 a->>'_refund_method', a->>'_refund_reference', a->>'_refund_account', a->'_items'));
    WHEN 'edit_purchase_return' THEN
      v_res := to_jsonb(public.edit_purchase_return((a->>'_return_id')::uuid, a->>'_edit_reason', a->'p_header', a->'p_items'));
    WHEN 'edit_voucher' THEN
      v_res := to_jsonb(public.edit_voucher((a->>'p_voucher_id')::uuid, nullif(a->>'p_category_id', '')::uuid, (a->>'p_amount')::numeric,
                 a->>'p_payment_method', (a->>'p_voucher_date')::date, nullif(a->>'p_party_type', '')::voucher_party_type,
                 nullif(a->>'p_party_id', '')::uuid, a->>'p_party_name', a->>'p_description', a->>'p_reference_number',
                 a->>'p_transferred_to', a->>'p_transferred_from', nullif(a->>'p_fee_amount', '')::numeric, a->>'p_edit_reason'));
    WHEN 'update_invoice_date_sovereign' THEN
      v_res := to_jsonb(public.update_invoice_date_sovereign((a->>'p_invoice_id')::uuid, (a->>'p_new_date')::timestamptz, a->>'p_reason'));
    WHEN 'update_shipment_date' THEN
      v_res := to_jsonb(public.update_shipment_date((a->>'p_shipment_id')::uuid, (a->>'p_new_date')::timestamptz, a->>'p_reason'));
    ELSE
      RAISE EXCEPTION 'نوع التعديل غير معروف: %', coalesce(v_rpc, '—');
  END CASE;
  PERFORM set_config('app.edit_keep_returns', '', true);

  -- the money paid above the new total: refund now (else it stays on his account by itself)
  IF v_rpc = 'edit_invoice' AND coalesce(v_ex->>'action', '') = 'refund' AND coalesce((v_ex->>'amount')::numeric, 0) > 0 THEN
    SELECT i.id, i.branch_id, i.contact_id, i.invoice_number, c.name AS cname INTO v_inv
      FROM public.invoices i LEFT JOIN public.contacts c ON c.id = i.contact_id WHERE i.id = (a->>'_invoice_id')::uuid;
    IF v_inv.contact_id IS NULL THEN RAISE EXCEPTION 'رد الفرق محتاج عميل على الفاتورة'; END IF;
    -- a payment to the customer is his refund whatever the category (0078); «مرتجعات للعملاء» if it is on
    SELECT id INTO v_cat FROM public.voucher_categories
     WHERE tenant_id = public.current_tenant_id() AND type = 'payment' AND coalesce(is_active, true)
       AND system_key IN ('customer_return', 'other_payment')
     ORDER BY (system_key = 'customer_return') DESC LIMIT 1;
    v_voucher := public.create_manual_voucher(v_inv.branch_id, 'payment', v_cat, (v_ex->>'amount')::numeric,
      coalesce(v_ex->>'method', 'cash'), nullif(v_ex->>'reference', ''), NULL, public.calculate_payment_fee(coalesce(v_ex->>'method', 'cash'), (v_ex->>'amount')::numeric),
      'customer', v_inv.contact_id, v_inv.cname, 'رد فرق تعديل الفاتورة ' || coalesce(v_inv.invoice_number, ''), public.cairo_today(), NULL);
    v_res := coalesce(v_res, '{}'::jsonb) || jsonb_build_object('refund_voucher', v_voucher);
  END IF;
  RETURN coalesce(v_res, '{}'::jsonb) || jsonb_build_object('rpc', v_rpc);
END $function$;
REVOKE ALL ON FUNCTION public.apply_document_edit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_document_edit(jsonb) TO authenticated;

-- the approval runs the same edit (owner only for documents)
DO $mig$
DECLARE d text := pg_get_functiondef('public.process_approval_request()'::regprocedure);
  o text := $o$    ELSIF NEW.action = 'update' AND NEW.payload IS NOT NULL THEN
      IF NEW.entity_type = 'contact' THEN$o$;
  n text := $n$    ELSIF NEW.action = 'update' AND NEW.payload IS NOT NULL
          AND NEW.entity_type IN ('invoice', 'shipment', 'sale_return', 'purchase_return', 'voucher') THEN
      -- 0141: a document edit runs under the owner's name, with his answers (returns / money above the total)
      IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'الموافقة على تعديل المستندات للمالك بس'; END IF;
      PERFORM public.apply_document_edit(NEW.payload);
    ELSIF NEW.action = 'update' AND NEW.payload IS NOT NULL THEN
      IF NEW.entity_type = 'contact' THEN$n$;
BEGIN
  IF position('0141' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0141: process_approval_request not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('apply_document_edit', '0141', 'owner: run a document edit (direct or from an approved request)'),
  ('doc_edit_is_direct', '0141', 'owner: can this user edit documents directly (owner) or must he send a request')
ON CONFLICT DO NOTHING;
