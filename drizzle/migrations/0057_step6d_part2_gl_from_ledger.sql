-- Step 6D part 2: General ledger from the unified ledger with the 1910 inter-branch current account.
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.post_journal(uuid,date,text,text,uuid,jsonb)'::regprocedure);
  v_new := replace(v_def, $a$LPAD(v_seq::TEXT,4,'0')$a$, $b$LPAD(v_seq::TEXT,GREATEST(4,length(v_seq::TEXT)),'0')$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: post_journal numbering not found'; END IF;
  EXECUTE v_new;
END
$patch$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.reverse_journal_for_source(uuid,text,uuid,text)'::regprocedure);
  v_new := replace(v_def,
$a$    IF v_new_id IS NOT NULL THEN$a$,
$b$    IF v_new_id IS NOT NULL THEN
      UPDATE public.journal_entries SET branch_id = v_orig.branch_id WHERE id = v_new_id AND branch_id IS NULL;$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: reverse_journal_for_source body not found'; END IF;
  EXECUTE v_new;
END
$patch$;

UPDATE public.journal_entries r SET branch_id = o.branch_id
  FROM public.journal_entries o
 WHERE o.reversed_by = r.id AND r.branch_id IS NULL AND o.branch_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.fiscal_periods fp WHERE fp.tenant_id = r.tenant_id AND fp.status = 'closed'
                     AND r.entry_date BETWEEN fp.period_start AND fp.period_end);

CREATE TABLE IF NOT EXISTS public.ledger_gl_links (
  id                   bigserial PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id),
  ref_type             text NOT NULL CHECK (ref_type IN ('movement', 'allocation', 'walkin_refund', 'retired')),
  ref_id               uuid NOT NULL,
  part                 text NOT NULL DEFAULT 'main' CHECK (part IN ('main', 'money_branch', 'debt_branch')),
  journal_id           uuid NOT NULL REFERENCES public.journal_entries(id),
  status               text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversal_journal_id  uuid REFERENCES public.journal_entries(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  reversed_at          timestamptz
);
COMMENT ON TABLE public.ledger_gl_links IS
  'Step 6D: which journal entry posts which ledger movement / allocation, and which old entry was retired (reversed) because the ledger now posts that money. Never deleted.';
CREATE UNIQUE INDEX IF NOT EXISTS ledger_gl_links_live_uidx ON public.ledger_gl_links (ref_type, ref_id, part) WHERE status = 'posted';
CREATE INDEX IF NOT EXISTS ledger_gl_links_tenant_idx ON public.ledger_gl_links (tenant_id, ref_type);
CREATE INDEX IF NOT EXISTS pa_superseded_contact_idx ON public.payment_allocations (contact_id) WHERE status = 'superseded';
CREATE INDEX IF NOT EXISTS mm_cancelled_contact_idx ON public.money_movements (contact_id) WHERE status = 'cancelled';

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ledger_desired_movements(uuid)'::regprocedure);
  v_new := replace(v_def,
$a$   WHERE i.contact_id = c.id AND i.status = 'cancelled' AND i.refund_method = 'cash' AND COALESCE(i.refund_amount, 0) > 0$a$,
$b$   WHERE i.contact_id = c.id AND i.status = 'cancelled' AND i.refund_method = 'cash' AND COALESCE(i.refund_amount, 0) > 0
     AND public.ledger_day(i.invoice_date) >= v_cut$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: capture rule (E) not found'; END IF;
  EXECUTE v_new;
END
$patch$;
GRANT ALL ON public.ledger_gl_links TO service_role;
ALTER TABLE public.ledger_gl_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ledger_gl_links FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.ledger_gl_links;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.ledger_gl_links FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

CREATE TABLE IF NOT EXISTS public.ledger_gl_skipped (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  ref_type   text NOT NULL,
  ref_id     uuid NOT NULL,
  entry_date date NOT NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ref_type, ref_id, reason)
);
GRANT ALL ON public.ledger_gl_skipped TO service_role;
ALTER TABLE public.ledger_gl_skipped ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ledger_gl_skipped FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ledger_period_closed(p_tenant uuid, p_day date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM fiscal_periods fp WHERE fp.tenant_id = p_tenant AND fp.status = 'closed'
                   AND p_day BETWEEN fp.period_start AND fp.period_end)
$$;

CREATE OR REPLACE FUNCTION public.ledger_cash_account(p_method text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(COALESCE(p_method, 'cash')) = 'cash' THEN '1100' ELSE '1110' END
$$;

CREATE OR REPLACE FUNCTION public.ledger_gl_post(p_tenant uuid, p_branch uuid, p_day date, p_desc text,
                                                 p_source_type text, p_source_id uuid, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v uuid;
BEGIN
  v := public.post_journal(p_tenant, p_day, p_desc, p_source_type, p_source_id, p_lines);
  IF v IS NOT NULL THEN
    UPDATE journal_entries SET branch_id = p_branch WHERE id = v AND branch_id IS DISTINCT FROM p_branch;
  END IF;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_gl_reverse(p_journal uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE e record; v_lines jsonb; v_day date; v uuid;
BEGIN
  SELECT * INTO e FROM journal_entries WHERE id = p_journal;
  IF NOT FOUND OR e.reversed_by IS NOT NULL OR e.status <> 'posted' THEN RETURN NULL; END IF;
  SELECT jsonb_agg(jsonb_build_object('account_code', a.code, 'debit', l.credit, 'credit', l.debit,
                                      'description', 'عكس: ' || COALESCE(l.description, '')) ORDER BY l.line_order, l.id)
    INTO v_lines
    FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id WHERE l.entry_id = e.id;
  v_day := CASE WHEN public.ledger_period_closed(e.tenant_id, e.entry_date) THEN public.cairo_today() ELSE e.entry_date END;
  v := public.ledger_gl_post(e.tenant_id, e.branch_id, v_day, COALESCE(p_reason, 'عكس قيد') || ' — ' || e.entry_number,
                             'ledger_gl_reversal', e.id, v_lines);
  IF v IS NOT NULL AND NOT public.ledger_period_closed(e.tenant_id, e.entry_date) THEN
    UPDATE journal_entries SET reversed_by = v WHERE id = e.id;
  END IF;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_voucher_is_contact_money(p_voucher uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM vouchers v
      LEFT JOIN treasury t ON t.id = v.treasury_id
     WHERE v.id = p_voucher
       AND (
            (v.party_type::text IN ('customer', 'supplier') AND v.party_id IS NOT NULL)
         OR v.source_type = 'credit_deposit'
         OR t.category IN ('contact_settlement', 'contact_settlement_surplus')
         OR (t.category IN ('customer_payment', 'supplier_payment')
             AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = t.reference_id))
         OR EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.treasury_id = t.id AND pt.contact_id IS NOT NULL
                      AND public.ledger_day(COALESCE((SELECT o.created_at FROM payment_transactions o WHERE o.id = pt.reverses_tx_id), pt.created_at)) >= public.ledger_cutoff())
         OR (t.category = 'sales_refund'
             AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = t.reference_id AND i.status = 'cancelled'
                           AND i.refund_method = 'cash' AND COALESCE(i.refund_amount, 0) > 0
                           AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()))
       )
  )
$$;

CREATE OR REPLACE FUNCTION public.ledger_old_entry_is_contact_money(p_journal uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM journal_entries e
     WHERE e.id = p_journal
       AND ((e.source_type = 'invoice_payment' AND EXISTS (
               SELECT 1 FROM invoice_payments ip WHERE ip.id = e.source_id AND public.ledger_day(ip.created_at) >= public.ledger_cutoff()))
         OR (e.source_type = 'supplier_payment' AND EXISTS (
               SELECT 1 FROM supplier_payments sp WHERE sp.id = e.source_id
                 AND public.ledger_day(COALESCE(sp.paid_at, sp.created_at)) >= public.ledger_cutoff()))
         OR (e.source_type = 'voucher' AND EXISTS (
               SELECT 1 FROM vouchers v WHERE v.id = e.source_id AND v.voucher_date >= public.ledger_cutoff())
             AND public.ledger_voucher_is_contact_money(e.source_id))))
$$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.trg_invoice_payment_journal()'::regprocedure);
  v_new := replace(v_def,
$a$  IF TG_OP = 'INSERT' AND NEW.voided_at IS NULL AND COALESCE(NEW.amount,0) > 0 THEN$a$,
$b$  IF TG_OP = 'INSERT' AND public.ledger_day(NEW.created_at) >= public.ledger_cutoff() THEN
    RETURN NEW;   -- Step 6D: posted from the unified ledger (money_movements / payment_allocations)
  END IF;
  IF TG_OP = 'INSERT' AND NEW.voided_at IS NULL AND COALESCE(NEW.amount,0) > 0 THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: trg_invoice_payment_journal body not found'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.trg_supplier_payment_journal()'::regprocedure);
  v_new := replace(v_def,
$a$  IF TG_OP = 'INSERT' AND COALESCE(NEW.amount,0) > 0 THEN$a$,
$b$  IF TG_OP = 'INSERT' AND public.ledger_day(COALESCE(NEW.paid_at, NEW.created_at)) >= public.ledger_cutoff() THEN
    RETURN NEW;   -- Step 6D: posted from the unified ledger
  END IF;
  IF TG_OP = 'INSERT' AND COALESCE(NEW.amount,0) > 0 THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: trg_supplier_payment_journal body not found'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.post_voucher_journal(uuid)'::regprocedure);
  v_new := replace(v_def,
$a$  IF NOT FOUND OR v.status <> 'active' OR COALESCE(v.amount,0) <= 0 THEN RETURN; END IF;$a$,
$b$  IF NOT FOUND OR v.status <> 'active' OR COALESCE(v.amount,0) <= 0 THEN RETURN; END IF;
  -- Step 6D: customer / supplier money is posted from the unified ledger
  IF v.voucher_date >= public.ledger_cutoff()
     AND (COALESCE(current_setting('app.contact_money', true), '') = '1'
          OR public.ledger_voucher_is_contact_money(v.id)) THEN
    RETURN;
  END IF;$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: post_voucher_journal body not found'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.record_payment_transaction(uuid,uuid,numeric,text,text,text,text,numeric,text,boolean,text,text,date)'::regprocedure);
  v_new := replace(v_def,
$a$  INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_number, transfer_to_account, transfer_from_account, created_by, tenant_id, transaction_date, created_at)$a$,
$b$  PERFORM set_config('app.contact_money', CASE WHEN v_contact_id IS NOT NULL THEN '1' ELSE '' END, true);
  INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_number, transfer_to_account, transfer_from_account, created_by, tenant_id, transaction_date, created_at)$b$);
  v_new := replace(v_new,
$a$  RETURNING id INTO v_treasury_id;
$a$,
$b$  RETURNING id INTO v_treasury_id;
  PERFORM set_config('app.contact_money', '', true);
$b$);
  IF v_new = v_def OR position('app.contact_money'', '''', true' IN v_new) = 0 THEN
    RAISE EXCEPTION 'Step 6D: record_payment_transaction body not found';
  END IF;
  EXECUTE v_new;
END
$patch$;

CREATE OR REPLACE FUNCTION public.ledger_gl_sync(p_tenant uuid, p_contact uuid, p_invoice uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET client_min_messages TO warning
AS $fn$
DECLARE
  k record; m record; a record; i record;
  v_pool text; v_debt text; v_cash text; v_lines jsonb; v_j uuid; v_j2 uuid; v_desc text;
  v_rev int := 0; v_mv int := 0; v_al int := 0; v_skip int := 0; v_wr int := 0;
BEGIN
  IF p_contact IS NULL AND p_invoice IS NULL THEN RETURN jsonb_build_object('skipped', true); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger_gl:' || COALESCE(p_contact::text, 'inv:' || p_invoice::text), 0));

  FOR k IN
    SELECT l.* FROM money_movements mm
      JOIN ledger_gl_links l ON l.ref_type = 'movement' AND l.ref_id = mm.id AND l.status = 'posted'
     WHERE mm.status <> 'active'
       AND ((p_contact IS NOT NULL AND mm.contact_id = p_contact)
            OR (p_contact IS NULL AND mm.contact_id IS NULL AND mm.target_doc_type = 'invoice' AND mm.target_doc_id = p_invoice))
    UNION ALL
    SELECT l.* FROM payment_allocations pa
      JOIN ledger_gl_links l ON l.ref_type = 'allocation' AND l.ref_id = pa.id AND l.status = 'posted'
     WHERE pa.status <> 'active'
       AND ((p_contact IS NOT NULL AND pa.contact_id = p_contact)
            OR (p_contact IS NULL AND pa.contact_id IS NULL AND pa.debt_type = 'invoice' AND pa.debt_id = p_invoice))
    UNION ALL
    SELECT l.* FROM ledger_gl_links l
     WHERE p_contact IS NULL AND l.ref_type = 'walkin_refund' AND l.ref_id = p_invoice AND l.status = 'posted'
       AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.id = p_invoice AND x.contact_id IS NULL AND x.status = 'cancelled'
                         AND x.refund_method = 'cash' AND COALESCE(x.refund_amount, 0) > 0)
     ORDER BY 1
  LOOP
    v_j := public.ledger_gl_reverse(k.journal_id, 'عكس قيد الدفتر الموحد');
    UPDATE ledger_gl_links SET status = 'reversed', reversal_journal_id = v_j, reversed_at = now() WHERE id = k.id;
    v_rev := v_rev + 1;
  END LOOP;

  FOR m IN
    SELECT mm.* FROM money_movements mm
     WHERE mm.tenant_id = p_tenant AND mm.status = 'active' AND mm.kind <> 'opening'
       AND (mm.contact_id = p_contact OR (p_contact IS NULL AND mm.contact_id IS NULL AND mm.target_doc_id = p_invoice))
       AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'movement' AND l.ref_id = mm.id AND l.status = 'posted')
     ORDER BY mm.movement_date, mm.created_at, mm.id
  LOOP
    IF public.ledger_period_closed(p_tenant, m.movement_date) THEN
      INSERT INTO ledger_gl_skipped (tenant_id, ref_type, ref_id, entry_date, reason)
      VALUES (p_tenant, 'movement', m.id, m.movement_date, 'closed_period') ON CONFLICT DO NOTHING;
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;
    v_cash := public.ledger_cash_account(m.method);
    v_desc := public.ledger_kind_label(m.side, m.kind, m.effect) || ' — ' || COALESCE(public.ledger_movement_ref(m.source_table, m.source_id), '');
    v_lines := CASE
      WHEN m.side = 'customer' AND m.kind IN ('payment', 'deposit') THEN jsonb_build_array(
             jsonb_build_object('account_code', v_cash, 'debit', m.amount, 'credit', 0, 'description', v_desc),
             jsonb_build_object('account_code', '2150', 'debit', 0, 'credit', m.amount, 'description', 'فلوس العميل لحين خصمها من فواتيره'))
      WHEN m.side = 'customer' AND m.kind = 'refund' THEN jsonb_build_array(
             jsonb_build_object('account_code', '1200', 'debit', m.amount, 'credit', 0, 'description', v_desc),
             jsonb_build_object('account_code', v_cash, 'debit', 0, 'credit', m.amount, 'description', v_desc))
      WHEN m.side = 'customer' AND m.kind = 'return_credit' THEN jsonb_build_array(
             jsonb_build_object('account_code', '1200', 'debit', m.amount, 'credit', 0, 'description', v_desc),
             jsonb_build_object('account_code', '2150', 'debit', 0, 'credit', m.amount, 'description', 'رصيد مرتجع لحين خصمه'))
      WHEN m.side = 'supplier' AND m.kind IN ('payment', 'deposit') THEN jsonb_build_array(
             jsonb_build_object('account_code', '1460', 'debit', m.amount, 'credit', 0, 'description', 'فلوس للمورد لحين خصمها من فواتيره'),
             jsonb_build_object('account_code', v_cash, 'debit', 0, 'credit', m.amount, 'description', v_desc))
      WHEN m.side = 'supplier' AND m.kind = 'refund' THEN jsonb_build_array(
             jsonb_build_object('account_code', v_cash, 'debit', m.amount, 'credit', 0, 'description', v_desc),
             jsonb_build_object('account_code', '2100', 'debit', 0, 'credit', m.amount, 'description', v_desc))
      WHEN m.side = 'supplier' AND m.kind = 'return_credit' THEN jsonb_build_array(
             jsonb_build_object('account_code', '1460', 'debit', m.amount, 'credit', 0, 'description', 'رصيد مرتجع لحين خصمه'),
             jsonb_build_object('account_code', '2100', 'debit', 0, 'credit', m.amount, 'description', v_desc))
    END;
    v_j := public.ledger_gl_post(p_tenant, m.branch_id, m.movement_date, 'الدفتر الموحد — ' || v_desc,
                                 'ledger_movement', m.id, v_lines);
    INSERT INTO ledger_gl_links (tenant_id, ref_type, ref_id, part, journal_id) VALUES (p_tenant, 'movement', m.id, 'main', v_j);
    v_mv := v_mv + 1;
  END LOOP;

  FOR a IN
    SELECT pa.* FROM payment_allocations pa
     WHERE pa.tenant_id = p_tenant AND pa.status = 'active'
       AND (pa.contact_id = p_contact OR (p_contact IS NULL AND pa.contact_id IS NULL AND pa.debt_id = p_invoice))
       AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'allocation' AND l.ref_id = pa.id AND l.status = 'posted')
     ORDER BY pa.effective_date, pa.created_at, pa.id
  LOOP
    IF public.ledger_period_closed(p_tenant, a.effective_date) THEN
      INSERT INTO ledger_gl_skipped (tenant_id, ref_type, ref_id, entry_date, reason)
      VALUES (p_tenant, 'allocation', a.id, a.effective_date, 'closed_period') ON CONFLICT DO NOTHING;
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;
    v_pool := CASE WHEN a.side = 'customer' THEN '2150' ELSE '1460' END;
    v_debt := CASE WHEN a.side = 'customer' THEN '1200' ELSE '2100' END;
    v_desc := CASE WHEN a.side = 'customer' THEN 'خصم فلوس العميل من مديونيته' ELSE 'خصم فلوسنا عند المورد من مستحقاته' END
              || CASE a.debt_type WHEN 'invoice' THEN ' — ' || COALESCE((SELECT invoice_number FROM invoices WHERE id = a.debt_id), '')
                                  WHEN 'shipment' THEN ' — ' || COALESCE((SELECT shipment_number FROM shipments WHERE id = a.debt_id), '')
                                  ELSE '' END;
    IF NOT a.is_cross_branch THEN
      v_lines := CASE WHEN a.side = 'customer' THEN jsonb_build_array(
                   jsonb_build_object('account_code', v_pool, 'debit', a.amount, 'credit', 0, 'description', v_desc),
                   jsonb_build_object('account_code', v_debt, 'debit', 0, 'credit', a.amount, 'description', v_desc))
                 ELSE jsonb_build_array(
                   jsonb_build_object('account_code', v_debt, 'debit', a.amount, 'credit', 0, 'description', v_desc),
                   jsonb_build_object('account_code', v_pool, 'debit', 0, 'credit', a.amount, 'description', v_desc)) END;
      v_j := public.ledger_gl_post(p_tenant, a.debt_branch_id, a.effective_date, 'الدفتر الموحد — ' || v_desc,
                                   'ledger_allocation', a.id, v_lines);
      INSERT INTO ledger_gl_links (tenant_id, ref_type, ref_id, part, journal_id) VALUES (p_tenant, 'allocation', a.id, 'main', v_j);
    ELSE
      v_lines := CASE WHEN a.side = 'customer' THEN jsonb_build_array(
                   jsonb_build_object('account_code', v_pool, 'debit', a.amount, 'credit', 0, 'description', v_desc),
                   jsonb_build_object('account_code', '1910', 'debit', 0, 'credit', a.amount, 'description', 'مستحق لفرع المستند'))
                 ELSE jsonb_build_array(
                   jsonb_build_object('account_code', '1910', 'debit', a.amount, 'credit', 0, 'description', 'مستحق من فرع المستند'),
                   jsonb_build_object('account_code', v_pool, 'debit', 0, 'credit', a.amount, 'description', v_desc)) END;
      v_j := public.ledger_gl_post(p_tenant, a.movement_branch_id, a.effective_date, 'الدفتر الموحد (حساب جاري الفروع) — ' || v_desc,
                                   'ledger_allocation', a.id, v_lines);
      v_lines := CASE WHEN a.side = 'customer' THEN jsonb_build_array(
                   jsonb_build_object('account_code', '1910', 'debit', a.amount, 'credit', 0, 'description', 'مستحق من الفرع اللي استلم الفلوس'),
                   jsonb_build_object('account_code', v_debt, 'debit', 0, 'credit', a.amount, 'description', v_desc))
                 ELSE jsonb_build_array(
                   jsonb_build_object('account_code', v_debt, 'debit', a.amount, 'credit', 0, 'description', v_desc),
                   jsonb_build_object('account_code', '1910', 'debit', 0, 'credit', a.amount, 'description', 'مستحق للفرع اللي دفع الفلوس')) END;
      v_j2 := public.ledger_gl_post(p_tenant, a.debt_branch_id, a.effective_date, 'الدفتر الموحد (حساب جاري الفروع) — ' || v_desc,
                                    'ledger_allocation', a.id, v_lines);
      INSERT INTO ledger_gl_links (tenant_id, ref_type, ref_id, part, journal_id) VALUES (p_tenant, 'allocation', a.id, 'money_branch', v_j);
      INSERT INTO ledger_gl_links (tenant_id, ref_type, ref_id, part, journal_id) VALUES (p_tenant, 'allocation', a.id, 'debt_branch', v_j2);
      UPDATE payment_allocations SET clearing_journal_id = v_j2 WHERE id = a.id AND clearing_journal_id IS DISTINCT FROM v_j2;
    END IF;
    v_al := v_al + 1;
  END LOOP;

  IF p_contact IS NULL THEN
    SELECT x.* INTO i FROM invoices x
     WHERE x.id = p_invoice AND x.contact_id IS NULL AND x.status = 'cancelled'
       AND x.refund_method = 'cash' AND COALESCE(x.refund_amount, 0) > 0
       AND public.ledger_day(x.invoice_date) >= public.ledger_cutoff()
       AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'walkin_refund' AND l.ref_id = x.id AND l.status = 'posted');
    IF FOUND THEN
      IF public.ledger_period_closed(p_tenant, public.ledger_day(COALESCE(i.cancelled_at, i.invoice_date))) THEN
        INSERT INTO ledger_gl_skipped (tenant_id, ref_type, ref_id, entry_date, reason)
        VALUES (p_tenant, 'walkin_refund', i.id, public.ledger_day(COALESCE(i.cancelled_at, i.invoice_date)), 'closed_period')
        ON CONFLICT DO NOTHING;
      ELSE
        v_j := public.ledger_gl_post(p_tenant, i.branch_id, public.ledger_day(COALESCE(i.cancelled_at, i.invoice_date)),
                 'الدفتر الموحد — رد فلوس فاتورة ملغاة ' || i.invoice_number, 'ledger_walkin_refund', i.id,
                 jsonb_build_array(
                   jsonb_build_object('account_code', '2150', 'debit', i.refund_amount, 'credit', 0, 'description', 'رد فلوس فاتورة ملغاة ' || i.invoice_number),
                   jsonb_build_object('account_code', '1100', 'debit', 0, 'credit', i.refund_amount, 'description', 'رد فلوس فاتورة ملغاة ' || i.invoice_number)));
        INSERT INTO ledger_gl_links (tenant_id, ref_type, ref_id, part, journal_id) VALUES (p_tenant, 'walkin_refund', i.id, 'main', v_j);
        v_wr := 1;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('reversed', v_rev, 'movements', v_mv, 'allocations', v_al, 'walkin_refunds', v_wr, 'skipped_closed', v_skip);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_gl_retire_old(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET client_min_messages TO warning
AS $fn$
DECLARE e record; v_j uuid; v_n int := 0; v_closed int := 0;
BEGIN
  FOR e IN
    SELECT je.* FROM journal_entries je
     WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND je.reversed_by IS NULL
       AND je.entry_date >= public.ledger_cutoff() - 1
       AND je.source_type IN ('invoice_payment', 'supplier_payment', 'voucher')
       AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'retired' AND l.ref_id = je.id)
       AND public.ledger_old_entry_is_contact_money(je.id)
     ORDER BY je.entry_date, je.created_at, je.id
  LOOP
    IF public.ledger_period_closed(p_tenant, e.entry_date) THEN
      INSERT INTO ledger_gl_skipped (tenant_id, ref_type, ref_id, entry_date, reason)
      VALUES (p_tenant, 'retired', e.id, e.entry_date, 'closed_period') ON CONFLICT DO NOTHING;
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;
    v_j := public.ledger_gl_reverse(e.id, 'قيد قديم لفلوس عميل/مورد — بقى بيتسجل من الدفتر الموحد');
    IF v_j IS NOT NULL THEN
      INSERT INTO ledger_gl_links (tenant_id, ref_type, ref_id, part, journal_id, status, reversal_journal_id, reversed_at)
      VALUES (p_tenant, 'retired', e.id, 'main', e.id, 'reversed', v_j, now());
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('retired', v_n, 'skipped_closed', v_closed);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_sync_safe(p_contact uuid, p_invoice uuid, p_context text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_key text := COALESCE(p_contact::text, 'inv:' || p_invoice::text); v_tenant uuid;
BEGIN
  IF v_key IS NULL THEN RETURN; END IF;
  IF position('|' || v_key || '|' IN COALESCE(current_setting('ledger.done', true), '')) > 0 THEN RETURN; END IF;
  PERFORM set_config('ledger.done', COALESCE(current_setting('ledger.done', true), '') || '|' || v_key || '|', true);
  v_tenant := COALESCE((SELECT tenant_id FROM contacts WHERE id = p_contact), (SELECT tenant_id FROM invoices WHERE id = p_invoice));
  BEGIN
    IF p_contact IS NOT NULL THEN
      PERFORM public.ledger_sync_contact(p_contact);
    ELSE
      PERFORM public.ledger_sync_walkin(p_invoice);
    END IF;
    SET CONSTRAINTS public.trg_check_allocation_limits, public.trg_check_cancelled_movement_allocations IMMEDIATE;
    SET CONSTRAINTS public.trg_check_allocation_limits, public.trg_check_cancelled_movement_allocations DEFERRED;
  EXCEPTION WHEN OTHERS OR query_canceled THEN
    INSERT INTO ledger_sync_errors (tenant_id, contact_id, invoice_id, context, error)
    VALUES (v_tenant, p_contact, p_invoice, p_context, SQLERRM);
    RETURN;
  END;
  BEGIN
    PERFORM public.ledger_gl_sync(v_tenant, p_contact, p_invoice);
  EXCEPTION WHEN OTHERS OR query_canceled THEN
    INSERT INTO ledger_sync_errors (tenant_id, contact_id, invoice_id, context, error)
    VALUES (v_tenant, p_contact, p_invoice, 'gl:' || p_context, SQLERRM);
  END;
  IF p_contact IS NOT NULL THEN
    BEGIN
      PERFORM public.ledger_mirror_credit_balance(p_contact);
    EXCEPTION WHEN OTHERS OR query_canceled THEN
      INSERT INTO ledger_sync_errors (tenant_id, contact_id, context, error)
      VALUES (v_tenant, p_contact, 'mirror:' || p_context, SQLERRM);
    END;
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_gl_backfill(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET client_min_messages TO warning
AS $fn$
DECLARE t record; r record; v_out jsonb := '[]'::jsonb; v_ret jsonb; v_c int; v_w int; v_err int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'للمشرف العام فقط' USING ERRCODE = '42501';
  END IF;
  FOR t IN SELECT id FROM tenants WHERE p_tenant IS NULL OR id = p_tenant ORDER BY id LOOP
    v_c := 0; v_w := 0; v_err := 0;
    v_ret := public.ledger_gl_retire_old(t.id);
    FOR r IN SELECT DISTINCT mm.contact_id FROM money_movements mm WHERE mm.tenant_id = t.id AND mm.contact_id IS NOT NULL LOOP
      BEGIN
        PERFORM public.ledger_gl_sync(t.id, r.contact_id, NULL);
        PERFORM public.ledger_mirror_credit_balance(r.contact_id);
        v_c := v_c + 1;
      EXCEPTION WHEN OTHERS THEN
        v_err := v_err + 1;
        INSERT INTO ledger_sync_errors (tenant_id, contact_id, context, error) VALUES (t.id, r.contact_id, 'gl_backfill', SQLERRM);
      END;
    END LOOP;
    FOR r IN SELECT DISTINCT x.inv FROM (
               SELECT mm.target_doc_id AS inv FROM money_movements mm
                WHERE mm.tenant_id = t.id AND mm.contact_id IS NULL AND mm.target_doc_type = 'invoice'
               UNION
               SELECT i.id FROM invoices i
                WHERE i.tenant_id = t.id AND i.contact_id IS NULL AND i.status = 'cancelled' AND i.refund_method = 'cash'
                  AND COALESCE(i.refund_amount, 0) > 0 AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()) x LOOP
      BEGIN
        PERFORM public.ledger_gl_sync(t.id, NULL, r.inv);
        v_w := v_w + 1;
      EXCEPTION WHEN OTHERS THEN
        v_err := v_err + 1;
        INSERT INTO ledger_sync_errors (tenant_id, invoice_id, context, error) VALUES (t.id, r.inv, 'gl_backfill', SQLERRM);
      END;
    END LOOP;
    PERFORM public.ledger_mirror_credit_balance(c.id) FROM contacts c
     WHERE c.tenant_id = t.id AND c.credit_balance IS NOT NULL AND c.credit_balance <> 0
       AND NOT EXISTS (SELECT 1 FROM money_movements mm WHERE mm.contact_id = c.id);
    v_out := v_out || jsonb_build_object('tenant', t.id, 'retire', v_ret, 'contacts', v_c, 'walkin_invoices', v_w, 'errors', v_err);
  END LOOP;
  RETURN v_out;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_gl_reconciliation(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_t uuid; v jsonb; v_cut date := public.ledger_cutoff();
BEGIN
  IF auth.uid() IS NULL THEN
    v_t := p_tenant;
  ELSE
    v_t := public.assert_company_access(NULL);
    IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
      RAISE EXCEPTION 'مطابقة القيود للإدارة فقط' USING ERRCODE = '42501';
    END IF;
    IF p_tenant IS NOT NULL AND public.is_super_admin(auth.uid()) THEN v_t := p_tenant; END IF;
  END IF;
  WITH gl AS (
    SELECT a.code, e.branch_id, sum(l.debit - l.credit) AS bal
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date >= v_cut
       AND a.code IN ('1100', '1110', '1200', '1460', '1910', '2100', '2150')
     GROUP BY 1, 2
  ),
  till AS (
    SELECT tr.branch_id, sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS bal
      FROM treasury tr
     WHERE tr.tenant_id = v_t AND (COALESCE(tr.transaction_date, public.ledger_day(tr.created_at)) >= v_cut OR tr.category = 'رصيد افتتاحي')
     GROUP BY 1
  ),
  adv AS (
    SELECT cr.side, sum(cr.unallocated) AS u FROM public.ledger_credit_rows(v_t, NULL) cr GROUP BY 1
  ),
  walkin AS (
    SELECT sum(m.amount - COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa WHERE pa.status = 'active' AND pa.movement_id = m.id), 0)) AS u
      FROM money_movements m WHERE m.tenant_id = v_t AND m.contact_id IS NULL AND m.status = 'active' AND m.effect = 'settle'
  ),
  branches_cmp AS (
    SELECT b.id, b.name, round(COALESCE(t.bal, 0), 2) AS till,
           round(COALESCE((SELECT sum(g.bal) FROM gl g WHERE g.branch_id = b.id AND g.code IN ('1100', '1110')), 0), 2) AS gl_cash,
           round(COALESCE((SELECT sum(g.bal) FROM gl g WHERE g.branch_id = b.id AND g.code = '1910'), 0), 2) AS gl_1910
      FROM branches b LEFT JOIN till t ON t.branch_id = b.id
     WHERE b.tenant_id = v_t
  )
  SELECT jsonb_build_object(
    'from', v_cut,
    'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id', id, 'branch', name, 'till', till, 'gl_cash', gl_cash,
                                     'difference', round(till - gl_cash, 2), 'inter_branch_1910', gl_1910) ORDER BY name)
                            FROM branches_cmp WHERE till <> 0 OR gl_cash <> 0 OR gl_1910 <> 0), '[]'::jsonb),
    'inter_branch_1910_total', round(COALESCE((SELECT sum(bal) FROM gl WHERE code = '1910'), 0), 2),
    'customer_advances', jsonb_build_object(
        'ledger', round(COALESCE((SELECT u FROM adv WHERE side = 'customer'), 0) + COALESCE((SELECT u FROM walkin), 0), 2),
        'gl_2150', round(-COALESCE((SELECT sum(bal) FROM gl WHERE code = '2150'), 0), 2)),
    'supplier_advances', jsonb_build_object(
        'ledger', round(COALESCE((SELECT u FROM adv WHERE side = 'supplier'), 0), 2),
        'gl_1460', round(COALESCE((SELECT sum(bal) FROM gl WHERE code = '1460'), 0), 2)),
    'not_posted', jsonb_build_object(
        'movements', (SELECT count(*) FROM money_movements mm WHERE mm.tenant_id = v_t AND mm.status = 'active' AND mm.kind <> 'opening'
                        AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'movement' AND l.ref_id = mm.id AND l.status = 'posted')
                        AND NOT public.ledger_period_closed(v_t, mm.movement_date)),
        'allocations', (SELECT count(*) FROM payment_allocations pa WHERE pa.tenant_id = v_t AND pa.status = 'active'
                        AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'allocation' AND l.ref_id = pa.id AND l.status = 'posted')
                        AND NOT public.ledger_period_closed(v_t, pa.effective_date)),
        'closed_period_skipped', (SELECT count(*) FROM ledger_gl_skipped s WHERE s.tenant_id = v_t)),
    'old_entries_still_standing', (SELECT count(*) FROM journal_entries je
        WHERE je.tenant_id = v_t AND je.status = 'posted' AND je.reversed_by IS NULL AND je.entry_date >= v_cut - 1
          AND je.source_type IN ('invoice_payment', 'supplier_payment', 'voucher')
          AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'retired' AND l.ref_id = je.id)
          AND NOT public.ledger_period_closed(v_t, je.entry_date)
          AND public.ledger_old_entry_is_contact_money(je.id)),
    'retired_old_entries', (SELECT count(*) FROM ledger_gl_links l WHERE l.tenant_id = v_t AND l.ref_type = 'retired'),
    'opening', jsonb_build_object(
        'ledger', jsonb_build_object(
            '1200', round(COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.tenant_id = v_t AND m.kind = 'opening' AND m.status = 'active' AND m.side = 'customer' AND m.effect = 'charge'), 0), 2),
            '2150', round(COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.tenant_id = v_t AND m.kind = 'opening' AND m.status = 'active' AND m.side = 'customer' AND m.effect = 'settle'), 0), 2),
            '2100', round(COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.tenant_id = v_t AND m.kind = 'opening' AND m.status = 'active' AND m.side = 'supplier' AND m.effect = 'charge'), 0), 2),
            '1460', round(COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.tenant_id = v_t AND m.kind = 'opening' AND m.status = 'active' AND m.side = 'supplier' AND m.effect = 'settle'), 0), 2)),
        'journal', (SELECT jsonb_build_object(
            '1200', round(COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.code = '1200'), 0), 2),
            '2150', round(COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.code = '2150'), 0), 2),
            '2100', round(COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.code = '2100'), 0), 2),
            '1460', round(COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.code = '1460'), 0), 2))
          FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
         WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.source_type IN ('opening_balance', 'opening_balance_reversal', 'ledger_gl_reversal')
           AND (e.source_type <> 'ledger_gl_reversal' OR EXISTS (SELECT 1 FROM journal_entries o WHERE o.id = e.source_id AND o.source_type = 'opening_balance'))))
  ) INTO v;
  RETURN v;
END
$fn$;