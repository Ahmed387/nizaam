-- 0228 — «صحة النظام» S1 / S3 / L3 (owner 2026-11-15: «الفحص يجمع السجل كله … نفذ», «نوزع رصيد كل صنف من الـ54 على أحدث دفعاته
-- … نفذ», «نقفل البيعات المستنية بضاعة اللي البضاعة بتاعتها وصلت … نفذ», «الكمية والتكلفة والفلوس مش هتتحرك … نفذ»,
-- «الفحص يقارن جوه الفرع الواحد بس … نفذ»).
--
-- S3 «سجل حركة الصنف مختلف عن رصيده» read the LAST row of stock_movements by created_at; the «سهل» import wrote many movements of
--    one item in the same second, so it picked any of them (594 items, 2026-11-15). Σ(balance_after − balance_before) of the
--    whole log equals the quantity for all 594 → the check now compares that sum (the 0183 rule).
-- L3 «دفعة محتمل تكون متسجلة مرتين» paired the same amount / day / contact across TWO branches too; since 0206 every branch has its
--    own account, so two branches paying «المخزن الرئيسي» 40,000 on the same day is normal (38 of 40 pairs). It now pairs two
--    different sources inside ONE branch only (left: نور جار المعرض 24/6, محمد عبدالكريم 18/8 — both checked, real).
-- S1 «كمية الصنف مختلفة عن مجموع دفعاته» (54 items): for every such item whose quantity is ≥ 0 (45):
--    * its open «sold ahead of stock» rows (stock_shortages, 70 pieces in all) are closed — the goods arrived and the sales were
--      re-costed at the moving average after the import, so ONLY the status moves (no invoice line, no cost, no entry);
--    * its batches hold the quantity again, newest purchases first (the 0187 rule): each keeps min(purchased, still unplaced).
--    Items with a NEGATIVE quantity (9) are left alone — they are the negative-stock decision still with the owner (S2 shows them).
-- Nothing else moves: products.quantity, avg_cost, stock_movements, journal, tills.

-- 1) the checks
DO $m$
DECLARE d text; d0 text;
BEGIN
  d := pg_get_functiondef('public.system_integrity_audit(uuid)'::regprocedure);
  d0 := d;
  d := regexp_replace(d,
    'SELECT sm\.balance_after AS bal FROM stock_movements sm WHERE sm\.product_id = p\.id\s+ORDER BY sm\.created_at DESC, sm\.id DESC LIMIT 1',
    'SELECT sum(sm.balance_after - sm.balance_before) AS bal FROM stock_movements sm WHERE sm.product_id = p.id');
  d := replace(d, '''آخر رصيد في السجل ''', '''مجموع السجل ''');
  d := regexp_replace(d,
    'AND \(m2\.source_table <> m1\.source_table OR m2\.branch_id <> m1\.branch_id\)',
    'AND m2.branch_id = m1.branch_id AND m2.source_table <> m1.source_table');
  IF d = d0 OR position('sum(sm.balance_after - sm.balance_before)' IN d) = 0 OR position('m2.branch_id = m1.branch_id AND m2.source_table <> m1.source_table' IN d) = 0 THEN
    RAISE EXCEPTION '0228: system_integrity_audit text not found — nothing changed';
  END IF;
  EXECUTE d;
END
$m$;

-- 2) S1 items with quantity ≥ 0: close their open shortages, put their quantity back on their newest batches
DO $m$
DECLARE p record; b record; left_q numeric; n_items int := 0; n_short int := 0; n_batches int := 0;
BEGIN
  FOR p IN
    SELECT pr.id, pr.quantity
      FROM products pr
      JOIN LATERAL (SELECT coalesce(sum(pb.quantity_remaining), 0) - public.open_shortage_qty(pr.id) AS rem, count(*) AS n
                      FROM product_batches pb WHERE pb.product_id = pr.id) x ON x.n > 0
     WHERE pr.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'  -- A & N (the owner's 54 items)
       AND pr.archived_at IS NULL AND abs(pr.quantity - x.rem) > 0.005 AND pr.quantity >= 0
  LOOP
    n_items := n_items + 1;
    UPDATE stock_shortages SET qty_settled = qty, status = 'settled', settled_at = now()
     WHERE product_id = p.id AND status = 'open';
    GET DIAGNOSTICS left_q = ROW_COUNT; n_short := n_short + left_q;
    left_q := p.quantity;
    FOR b IN SELECT id, quantity_purchased, quantity_remaining FROM product_batches WHERE product_id = p.id
              ORDER BY coalesce(effective_at, created_at) DESC, created_at DESC, id DESC LOOP
      IF b.quantity_remaining IS DISTINCT FROM least(greatest(b.quantity_purchased, 0), left_q) THEN
        UPDATE product_batches SET quantity_remaining = least(greatest(b.quantity_purchased, 0), left_q) WHERE id = b.id;
        n_batches := n_batches + 1;
      END IF;
      left_q := left_q - least(greatest(b.quantity_purchased, 0), left_q);
    END LOOP;
  END LOOP;
  RAISE NOTICE '0228: % items, % shortage rows closed, % batches changed', n_items, n_short, n_batches;
END
$m$;
