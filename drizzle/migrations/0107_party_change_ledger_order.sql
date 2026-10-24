-- 0107 — Changing the customer / supplier of a paid document moves its money to the new party
--
-- Why (2026-10-24): ledger_capture_trg synced the NEW party first, then the OLD one. When syncing the new
-- party, the payment still had an active movement on the old party, so nothing was inserted
-- (mm_source_active_uidx / NOT EXISTS); then the old sync cancelled that movement → the money was on nobody.
-- A walk-in invoice that later got a customer kept its money on the walk-in (ledger_sync_walkin skipped
-- invoices that have a customer). Seen: IN05108 (3,150 cash, مايكل جمال shows it unpaid) and IN04936
-- (8,500 vodafone stayed on the walk-in). All branches were checked: only these two.
--
-- Fix: the OLD side is released first (old contact, or the walk-in money of the invoice), then the new
-- party is synced. Sales and purchases. No business row is written by this migration; the two documents
-- above are NOT repaired here (owner decision: fix the cause only).

CREATE OR REPLACE FUNCTION public.ledger_sync_walkin(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET client_min_messages TO 'warning'
AS $function$
DECLARE i record; v_cancel int; v_ins int;
BEGIN
  SELECT id, tenant_id, contact_id INTO i FROM invoices WHERE id = p_invoice;
  IF i.id IS NULL THEN RETURN jsonb_build_object('skipped', true); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:inv:' || p_invoice::text, 0));

  -- The invoice now has a customer: its walk-in money leaves the walk-in (the customer's sync adds it to him).
  IF i.contact_id IS NOT NULL THEN
    UPDATE money_movements mm SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'الفاتورة اتحط عليها عميل (مزامنة الدفتر)'
     WHERE mm.contact_id IS NULL AND mm.target_doc_type = 'invoice' AND mm.target_doc_id = p_invoice AND mm.status = 'active';
    GET DIAGNOSTICS v_cancel = ROW_COUNT;
    IF v_cancel = 0 THEN RETURN jsonb_build_object('skipped', true); END IF;
    RETURN jsonb_build_object('cancelled', v_cancel, 'inserted', 0,
                              'allocation', public.ledger_allocate(i.tenant_id, NULL, 'customer', p_invoice));
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _lw_want (source_id uuid, branch_id uuid, method text, amount numeric, movement_date date) ON COMMIT DROP;
  TRUNCATE _lw_want;
  INSERT INTO _lw_want
  SELECT ip.id, ip.branch_id, ip.payment_method, round(ip.amount, 2), public.ledger_day(ip.created_at)
    FROM invoice_payments ip
   WHERE ip.invoice_id = p_invoice AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
     AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
     AND public.ledger_day(ip.created_at) >= public.ledger_cutoff();

  UPDATE money_movements mm SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'المصدر اتغير أو اتلغى (مزامنة الدفتر)'
   WHERE mm.contact_id IS NULL AND mm.target_doc_type = 'invoice' AND mm.target_doc_id = p_invoice AND mm.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM _lw_want w WHERE mm.source_table = 'invoice_payments' AND w.source_id = mm.source_id
                       AND w.branch_id = mm.branch_id AND w.method IS NOT DISTINCT FROM mm.method
                       AND w.amount = mm.amount AND w.movement_date = mm.movement_date);
  GET DIAGNOSTICS v_cancel = ROW_COUNT;

  INSERT INTO money_movements (tenant_id, branch_id, contact_id, side, kind, effect, method, amount, movement_date,
                               target_doc_type, target_doc_id, source_table, source_id)
  SELECT i.tenant_id, w.branch_id, NULL, 'customer', 'payment', 'settle', w.method, w.amount, w.movement_date,
         'invoice', p_invoice, 'invoice_payments', w.source_id
    FROM _lw_want w
   WHERE NOT EXISTS (SELECT 1 FROM money_movements mm WHERE mm.status = 'active' AND mm.source_table = 'invoice_payments'
                       AND mm.source_id = w.source_id AND mm.kind = 'payment' AND mm.side = 'customer');
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  RETURN jsonb_build_object('cancelled', v_cancel, 'inserted', v_ins,
                            'allocation', public.ledger_allocate(i.tenant_id, NULL, 'customer', p_invoice));
END
$function$;

CREATE OR REPLACE FUNCTION public.ledger_capture_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_c uuid; v_old uuid; v_inv uuid; v_old_inv uuid;
BEGIN
  IF COALESCE(current_setting('app.ledger_capture', true), '') = 'off' THEN RETURN NULL; END IF;
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  CASE TG_TABLE_NAME
    WHEN 'invoice_payments' THEN
      SELECT contact_id INTO v_c FROM invoices WHERE id = r.invoice_id;
      IF v_c IS NULL THEN v_inv := r.invoice_id; END IF;
    WHEN 'payment_transactions' THEN v_c := r.contact_id;
    WHEN 'vouchers' THEN v_c := r.party_id;
    WHEN 'customer_credit_log' THEN v_c := r.contact_id;
    WHEN 'supplier_payments' THEN v_c := r.contact_id;
    WHEN 'returns' THEN
      SELECT contact_id INTO v_c FROM invoices WHERE id = r.invoice_id;
      IF v_c IS NULL THEN v_inv := r.invoice_id; END IF;
    WHEN 'purchase_returns' THEN v_c := r.contact_id;
    WHEN 'invoices' THEN
      v_c := r.contact_id;
      IF v_c IS NULL THEN v_inv := r.id; END IF;
      IF TG_OP = 'UPDATE' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN
        v_old := OLD.contact_id;
        IF OLD.contact_id IS NULL THEN v_old_inv := r.id; END IF;   -- walk-in → customer
      END IF;
    WHEN 'shipments' THEN
      v_c := r.contact_id;
      IF TG_OP = 'UPDATE' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN v_old := OLD.contact_id; END IF;
    WHEN 'contacts' THEN v_c := r.id;
    ELSE NULL;
  END CASE;
  -- 0107: release the OLD side first, so the new party's sync can take the money over.
  IF v_old IS NOT NULL THEN PERFORM public.ledger_sync_safe(v_old, NULL, TG_TABLE_NAME); END IF;
  IF v_old_inv IS NOT NULL THEN PERFORM public.ledger_sync_safe(NULL, v_old_inv, TG_TABLE_NAME); END IF;
  IF v_c IS NOT NULL THEN
    PERFORM public.ledger_sync_safe(v_c, NULL, TG_TABLE_NAME);
  ELSIF v_inv IS NOT NULL AND v_inv IS DISTINCT FROM v_old_inv THEN
    PERFORM public.ledger_sync_safe(NULL, v_inv, TG_TABLE_NAME);
  END IF;
  RETURN NULL;
END
$function$;
