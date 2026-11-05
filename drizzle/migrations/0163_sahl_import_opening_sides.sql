-- 0163: after 0162 one account can carry several branches. An account that ends up «both» takes one opening amount
-- whose side follows its sign (+ = customer owes us, − = we owe the supplier), so a branch where he was ONLY a
-- supplier with money paid ahead (+), or ONLY a customer with money left with us (−), would move to the other side:
-- «جوزيف عياد» (شلبى supplier +469,157.28 = advance paid to him; عبدالمنعم both +250) would become a 469,407.28 customer
-- debt. Such a branch's opening is posted on its OWN side instead, on 2026-01-01, with «تسوية رصيد بدون فلوس» (0148):
-- supplier advance = supplier side «we_owe_less», customer advance = customer side «he_owes_less»; the rest of the
-- account's opening goes through post_opening_balances as before.
ALTER TABLE sahl_import.acc ADD COLUMN IF NOT EXISTS open_side text;

DO $mig$
BEGIN
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
$p$     AND EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.k = a.k AND b.type IS DISTINCT FROM a.type);$p$,
$p$     AND EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.k = a.k AND b.type IS DISTINCT FROM a.type);
  -- 0163: an account that became «both» keeps each branch's opening on that branch's own side
  UPDATE sahl_import.acc a SET open_side = CASE WHEN a.type = 'supplier' AND a.opening >= 0.005 THEN 'supplier_adv'
                                                WHEN a.type = 'customer' AND a.opening <= -0.005 THEN 'customer_adv' END
    FROM sahl_import.acc m WHERE m.k = a.k AND m.name = m.canon AND m.branch = m.canon_branch AND m.type = 'both';
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, payload)
  SELECT a.branch, date '2026-01-01', time '00:00:01', 0, 'settle',
         jsonb_build_object('contact', a.name, 'side', CASE WHEN a.open_side = 'supplier_adv' THEN 'supplier' ELSE 'customer' END,
           'direction', CASE WHEN a.open_side = 'supplier_adv' THEN 'we_owe_less' ELSE 'he_owes_less' END, 'amount', abs(a.opening),
           'reason', 'رصيد أول المدة في ' || (SELECT c.label FROM sahl_import.cfg_branch c WHERE c.branch = a.branch) || ' — '
                     || CASE WHEN a.open_side = 'supplier_adv' THEN 'مقدم مدفوع للمورد' ELSE 'فلوس العميل اللي عندنا' END || ' (سهل)')
    FROM sahl_import.acc a WHERE a.open_side IS NOT NULL;$p$);
  PERFORM sahl_import._patch('sahl_import.run_setup()'::regprocedure,
    $p$    FROM (SELECT a.contact_id, sum(a.opening) AS amount FROM sahl_import.acc a GROUP BY a.contact_id HAVING abs(sum(a.opening)) >= 0.005) z;$p$,
    $p$    FROM (SELECT a.contact_id, sum(a.opening) FILTER (WHERE a.open_side IS NULL) AS amount FROM sahl_import.acc a GROUP BY a.contact_id
          HAVING abs(coalesce(sum(a.opening) FILTER (WHERE a.open_side IS NULL), 0)) >= 0.005) z;  -- 0163: the other side goes by settlement$p$);
END
$mig$;
