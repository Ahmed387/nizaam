-- =============================================================================================
-- Nizam ERP — PERMANENT delete (TEST database uzqiwxxmzjdgkfbskmzg only — never production)
-- Owner's decision (2026-10-11): under the till category «مقبوضات من موردين» remove, with no trace:
--   * every receipt that has NO party (45 vouchers, 220,262 — «ماي موب», توكتوك, …)
--   * the receipt on the supplier «مصطفي خفاجه» (RV-1713, 8,000)
--   * every till row of that category that has no voucher at all (16 rows, 433,479 — «احمد ناصر CUP»,
--     «لشركه قنوات», …). These were already cancelled by the manager (3–8 Oct); each one's reversal row
--     («إلغاء سند», same amount) is removed with it, so this pair moves no till.
-- Their till rows, ledger rows and journal entries go with them; tills go DOWN by the deleted vouchers.
-- The customer receipts under that category (557 vouchers, 6,532,599.99) stay — they paid sales invoices.
-- One transaction; it refuses to commit if any branch till stops matching its cash account.
-- =============================================================================================
CREATE OR REPLACE FUNCTION pg_temp.nizam_purge_supplier_receipts() RETURNS jsonb LANGUAGE plpgsql AS $p$
DECLARE r jsonb := '{}'::jsonb; i int; c record;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _d (tbl text, id uuid, primary key (tbl, id)) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _c (id uuid primary key) ON COMMIT DROP;
  TRUNCATE _d, _c;

  INSERT INTO _d SELECT 'vouchers', v.id FROM vouchers v JOIN treasury t ON t.id = v.treasury_id
   LEFT JOIN contacts ct ON ct.id = v.party_id
   WHERE t.category = 'مقبوضات من موردين' AND v.status = 'active' AND (v.party_id IS NULL OR ct.type = 'supplier');
  INSERT INTO _d SELECT 'treasury', t.id FROM treasury t
   WHERE t.category = 'مقبوضات من موردين' AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.treasury_id = t.id)
  ON CONFLICT DO NOTHING;
  -- their reversal rows: the manager had already cancelled each of them («حذف بواسطة المدير», 3–8 Oct);
  -- pair one-to-one by branch + amount (opposite direction), so the pair leaves together and the till does not move
  INSERT INTO _d SELECT 'treasury', r.id FROM (
      SELECT t.id, t.branch_id, t.amount, row_number() OVER (PARTITION BY t.branch_id, t.amount ORDER BY t.transaction_date, t.id) n
        FROM treasury t WHERE t.category = 'مقبوضات من موردين' AND t.type::text = 'income'
         AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.treasury_id = t.id)) o
    JOIN (
      SELECT t.id, t.branch_id, t.amount, row_number() OVER (PARTITION BY t.branch_id, t.amount ORDER BY t.transaction_date, t.id) n
        FROM treasury t WHERE t.category = 'إلغاء سند' AND t.type::text = 'expense'
         AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.treasury_id = t.id)) r
      ON r.branch_id = o.branch_id AND r.amount = o.amount AND r.n = o.n
  ON CONFLICT DO NOTHING;

  -- till rows (and fee rows), and any voucher written by those till rows
  FOR i IN 1..2 LOOP
    INSERT INTO _d SELECT 'treasury', treasury_id FROM vouchers WHERE id IN (SELECT id FROM _d WHERE tbl='vouchers') AND treasury_id IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO _d SELECT 'treasury', t.id FROM treasury t WHERE t.reference_id IN (SELECT id FROM _d WHERE tbl IN ('vouchers','customer_credit_log')) ON CONFLICT DO NOTHING;
    INSERT INTO _d SELECT 'treasury', m.treasury_id FROM money_movements m WHERE m.source_id IN (SELECT id FROM _d WHERE tbl='customer_credit_log') AND m.treasury_id IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO _d SELECT 'vouchers', v.id FROM vouchers v WHERE v.treasury_id IN (SELECT id FROM _d WHERE tbl='treasury') ON CONFLICT DO NOTHING;
  END LOOP;
  IF EXISTS (SELECT 1 FROM payment_transactions WHERE treasury_id IN (SELECT id FROM _d WHERE tbl='treasury') OR fee_treasury_id IN (SELECT id FROM _d WHERE tbl='treasury'))
     OR EXISTS (SELECT 1 FROM supplier_payments WHERE treasury_id IN (SELECT id FROM _d WHERE tbl='treasury')) THEN
    RAISE EXCEPTION 'blocked: a plan instalment / supplier payment uses one of these till rows';
  END IF;

  INSERT INTO _d SELECT 'money_movements', id FROM money_movements
   WHERE source_id IN (SELECT id FROM _d) OR treasury_id IN (SELECT id FROM _d WHERE tbl='treasury') ON CONFLICT DO NOTHING;
  INSERT INTO _d SELECT 'payment_allocations', id FROM payment_allocations WHERE movement_id IN (SELECT id FROM _d WHERE tbl='money_movements') ON CONFLICT DO NOTHING;
  INSERT INTO _d SELECT 'journal_entries', id FROM journal_entries WHERE source_id IN (SELECT id FROM _d) ON CONFLICT DO NOTHING;
  INSERT INTO _d SELECT 'journal_entries', journal_id FROM ledger_gl_links WHERE ref_id IN (SELECT id FROM _d WHERE tbl IN ('money_movements','payment_allocations')) ON CONFLICT DO NOTHING;
  INSERT INTO _d SELECT 'journal_entries', reversal_journal_id FROM ledger_gl_links WHERE ref_id IN (SELECT id FROM _d WHERE tbl IN ('money_movements','payment_allocations')) AND reversal_journal_id IS NOT NULL ON CONFLICT DO NOTHING;
  FOR i IN 1..3 LOOP
    INSERT INTO _d SELECT 'journal_entries', l.reversal_journal_id FROM ledger_gl_links l WHERE l.ref_id IN (SELECT id FROM _d WHERE tbl='journal_entries') AND l.reversal_journal_id IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO _d SELECT 'journal_entries', e.reversed_by FROM journal_entries e WHERE e.id IN (SELECT id FROM _d WHERE tbl='journal_entries') AND e.reversed_by IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO _d SELECT 'journal_entries', e.id FROM journal_entries e WHERE e.source_id IN (SELECT id FROM _d WHERE tbl='journal_entries') ON CONFLICT DO NOTHING;
  END LOOP;
  IF EXISTS (SELECT 1 FROM partner_transactions WHERE related_voucher_id IN (SELECT id FROM _d) OR related_treasury_id IN (SELECT id FROM _d))
     OR EXISTS (SELECT 1 FROM profit_distributions WHERE journal_entry_id IN (SELECT id FROM _d))
     OR EXISTS (SELECT 1 FROM fiscal_periods WHERE closing_entry_id IN (SELECT id FROM _d)) THEN
    RAISE EXCEPTION 'blocked: partner / profit / closing rows depend on these documents';
  END IF;

  r := jsonb_build_object(
    'deleted', (SELECT jsonb_object_agg(tbl, cnt) FROM (SELECT tbl, count(*) cnt FROM _d GROUP BY 1) x),
    'vouchers', (SELECT jsonb_build_object('n', count(*), 'amount', round(sum(amount),2)) FROM vouchers WHERE id IN (SELECT id FROM _d WHERE tbl='vouchers')),
    'till_rows', (SELECT jsonb_build_object('n', count(*), 'amount', round(sum(amount),2)) FROM treasury WHERE id IN (SELECT id FROM _d WHERE tbl='treasury')),
    'till_change_by_branch', (SELECT jsonb_object_agg(coalesce(b.name,'-'), -x.s) FROM (SELECT branch_id, round(sum(CASE WHEN type::text='income' THEN amount ELSE -amount END),2) s FROM treasury WHERE id IN (SELECT id FROM _d WHERE tbl='treasury') GROUP BY 1) x LEFT JOIN branches b ON b.id = x.branch_id));

  INSERT INTO _c SELECT contact_id FROM money_movements WHERE id IN (SELECT id FROM _d) AND contact_id IS NOT NULL ON CONFLICT DO NOTHING;
  INSERT INTO _c SELECT party_id FROM vouchers WHERE id IN (SELECT id FROM _d) AND party_id IN (SELECT id FROM contacts) ON CONFLICT DO NOTHING;

  SET LOCAL session_replication_role = replica;
  UPDATE journal_entries SET reversed_by = NULL WHERE reversed_by IN (SELECT id FROM _d WHERE tbl='journal_entries') AND id NOT IN (SELECT id FROM _d);
  UPDATE payment_allocations SET clearing_journal_id = NULL WHERE clearing_journal_id IN (SELECT id FROM _d) AND id NOT IN (SELECT id FROM _d);
  DELETE FROM ledger_gl_links WHERE ref_id IN (SELECT id FROM _d) OR journal_id IN (SELECT id FROM _d) OR reversal_journal_id IN (SELECT id FROM _d);
  DELETE FROM ledger_gl_skipped WHERE ref_id IN (SELECT id FROM _d);
  DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM _d WHERE tbl='journal_entries');
  DELETE FROM journal_entries WHERE id IN (SELECT id FROM _d WHERE tbl='journal_entries');
  DELETE FROM payment_allocations WHERE id IN (SELECT id FROM _d);
  DELETE FROM money_movements WHERE id IN (SELECT id FROM _d);
  DELETE FROM customer_credit_log WHERE id IN (SELECT id FROM _d);
  DELETE FROM voucher_attachments WHERE voucher_id IN (SELECT id FROM _d);
  DELETE FROM vouchers WHERE id IN (SELECT id FROM _d);
  DELETE FROM treasury WHERE id IN (SELECT id FROM _d);
  DELETE FROM audit_log WHERE entity_id IN (SELECT id::text FROM _d);
  DELETE FROM notifications WHERE related_entity_id IN (SELECT id FROM _d);
  DELETE FROM attachments WHERE record_id IN (SELECT id FROM _d);
  SET LOCAL session_replication_role = origin;

  FOR c IN SELECT id FROM _c WHERE id IN (SELECT id FROM contacts) LOOP
    PERFORM public.ledger_sync_contact(c.id);
    PERFORM public.ledger_gl_sync((SELECT tenant_id FROM contacts WHERE id = c.id), c.id, NULL);
    PERFORM public.ledger_mirror_credit_balance(c.id);
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.ledger_gl_reconciliation('5316fbfe-b862-4c91-b48b-1d81c8aa5a71')->'branches') b
              WHERE abs((b->>'difference')::numeric) > 0.009) THEN
    RAISE EXCEPTION 'till vs cash account no longer match — nothing committed: %',
      public.ledger_gl_reconciliation('5316fbfe-b862-4c91-b48b-1d81c8aa5a71')->'branches';
  END IF;
  RETURN r || jsonb_build_object('contacts_resynced', (SELECT count(*) FROM _c));
END
$p$;
select pg_temp.nizam_purge_supplier_receipts() as result;
