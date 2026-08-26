CREATE OR REPLACE FUNCTION public.cancel_inventory_session(p_session_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sess record; v_is_owner boolean; m record; a record;
  v_block text; v_total numeric := 0; v_qty numeric := 0;
  v_entry record; v_new_id uuid; v_num text;
  v_uname text;
BEGIN
  SELECT s.*, t.owner_user_id INTO v_sess
    FROM public.inventory_sessions s
    LEFT JOIN public.tenants t ON t.id = s.tenant_id
   WHERE s.id = p_session_id FOR UPDATE;
  IF v_sess IS NULL THEN RAISE EXCEPTION 'الجرد غير موجود'; END IF;

  v_is_owner := (auth.uid() IS NOT NULL AND auth.uid() = v_sess.owner_user_id)
                OR public.has_role(auth.uid(),'owner');
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'إلغاء الجرد مسموح لصاحب الشركة (Owner) بس';
  END IF;
  IF v_sess.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح';
  END IF;
  IF v_sess.status <> 'closed' OR v_sess.approved_at IS NULL THEN
    RAISE EXCEPTION 'الجرد ده مش معتمد أصلاً';
  END IF;

  SELECT string_agg(x.txt, E'\n') INTO v_block FROM (
    SELECT 'فاتورة بيع ' || i.invoice_number || ' بتاريخ ' || to_char(i.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || ii.product_name AS txt
      FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE i.branch_id = v_sess.branch_id AND i.created_at > v_sess.approved_at
       AND ii.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'مرتجع بيع ' || COALESCE(rt.return_number,'') || ' بتاريخ ' || to_char(rt.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || ri.product_name
      FROM public.return_items ri JOIN public.returns rt ON rt.id = ri.return_id
     WHERE rt.branch_id = v_sess.branch_id AND rt.created_at > v_sess.approved_at
       AND ri.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'شحنة شراء بتاريخ ' || to_char(sh.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || COALESCE(si.product_name,'')
      FROM public.shipment_items si JOIN public.shipments sh ON sh.id = si.shipment_id
     WHERE sh.branch_id = v_sess.branch_id AND sh.created_at > v_sess.approved_at
       AND si.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'مرتجع شراء ' || COALESCE(pr.return_number,'') || ' بتاريخ ' || to_char(pr.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || pri.product_name
      FROM public.purchase_return_items pri JOIN public.purchase_returns pr ON pr.id = pri.purchase_return_id
     WHERE pr.branch_id = v_sess.branch_id AND pr.created_at > v_sess.approved_at
       AND pri.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'تحويل مخزون بتاريخ ' || to_char(st.created_at,'YYYY-MM-DD HH24:MI')
      FROM public.stock_transfers st
     WHERE (st.from_branch_id = v_sess.branch_id OR st.to_branch_id = v_sess.branch_id)
       AND st.created_at > v_sess.approved_at
       AND st.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'تسوية مخزون ' || sa.adjustment_number || ' بتاريخ ' || to_char(sa.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || sai.product_name
      FROM public.stock_adjustment_items sai JOIN public.stock_adjustments sa ON sa.id = sai.adjustment_id
     WHERE sa.branch_id = v_sess.branch_id AND sa.created_at > v_sess.approved_at
       AND sai.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    LIMIT 10
  ) x;

  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'مينفعش تلغي الجرد — حصلت حركة على نفس المنتجات بعد الاعتماد:%', E'\n' || v_block;
  END IF;

  FOR a IN SELECT product_id, adjustment_amount FROM public.inventory_adjustments WHERE session_id = p_session_id LOOP
    UPDATE public.products SET quantity = GREATEST(COALESCE(quantity,0) - a.adjustment_amount, 0)
     WHERE id = a.product_id;
    v_qty := v_qty + ABS(a.adjustment_amount);
  END LOOP;

  FOR m IN SELECT * FROM public.inventory_count_batch_moves WHERE session_id = p_session_id ORDER BY created_at DESC LOOP
    IF m.created_batch THEN
      DELETE FROM public.product_batches WHERE id = m.batch_id;
    ELSE
      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining - m.delta
       WHERE id = m.batch_id;
    END IF;
  END LOOP;
  DELETE FROM public.inventory_count_batch_moves WHERE session_id = p_session_id;

  FOR v_entry IN SELECT * FROM public.journal_entries
                  WHERE tenant_id = v_sess.tenant_id AND source_type = 'inventory_session'
                    AND source_id = p_session_id AND status = 'posted' AND reversed_by IS NULL LOOP
    v_num := 'JRDX-' || to_char(now(),'YYYYMMDDHH24MISS');
    INSERT INTO public.journal_entries(tenant_id, branch_id, entry_number, entry_date, description,
      source_type, source_id, status, total_debit, total_credit)
    VALUES (v_sess.tenant_id, v_entry.branch_id, v_num, CURRENT_DATE,
      'عكس قيد فروقات جرد — ' || v_entry.entry_number, 'inventory_session_reversal', p_session_id,
      'posted', v_entry.total_debit, v_entry.total_credit)
    RETURNING id INTO v_new_id;

    INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description, line_order)
    SELECT v_sess.tenant_id, v_new_id, l.account_id, l.credit, l.debit,
           'عكس: ' || COALESCE(l.description,''), l.line_order
      FROM public.journal_entry_lines l WHERE l.entry_id = v_entry.id;

    v_total := v_total + COALESCE(v_entry.total_debit,0);
    UPDATE public.journal_entries SET status='reversed', reversed_by = v_new_id WHERE id = v_entry.id;
  END LOOP;

  UPDATE public.inventory_sessions
     SET status = 'cancelled',
         notes = COALESCE(notes,'') || E'\n[ألغي بعد الاعتماد] ' || COALESCE(p_reason,'')
   WHERE id = p_session_id;

  SELECT COALESCE(name, username, 'مستخدم') INTO v_uname FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (auth.uid(), COALESCE(v_uname,'مستخدم'), v_sess.branch_id, 'cancel', 'inventory_session',
          p_session_id::text,
          jsonb_build_object('reason', p_reason, 'reverted_qty', v_qty, 'reverted_value', v_total,
                             'approved_at', v_sess.approved_at),
          v_sess.tenant_id);

  RETURN jsonb_build_object('reverted_qty', v_qty, 'reverted_value', v_total);
END $function$;