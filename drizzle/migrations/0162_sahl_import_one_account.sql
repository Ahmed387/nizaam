-- 0162: owner 2026-11-05 «اسم العميل واحد بالثلاث فروع و داخل صفحة العميل تعاملاته فى كل فرع … كمل» — replaces «حساب لكل
-- فرع» (0157 / 0158): a name (after the system's name rule: ة / ه, ى / ي, أ / ا, spaces) is ONE account in all three
-- branches, named with the spelling that has most documents, no «(الفرع)». Its documents keep their own branch, so the
-- contact file shows them per branch; its type covers every branch (customer here + supplier there = both); its
-- opening balance is the sum of the branches' (written per branch in the contact's notes, «+ عليه، − له»).
-- Two more fixes from the Q1 dry-run (2026-11-05 16:07 UTC, 13 errors):
--   * «سهل» refunded a returned line at its price before the bill discount was spread over the lines (return 612:
--     9,850 for an item sold at 9,816.08; سكة return 5: 13,500 vs 13,300). In import mode only, the refund may be above
--     the line's value on the invoice (`guard_return_item_refund`), so the till and the balance stay as in «سهل».
--   * 6 returns are dated before their own invoice in «سهل» (شلبى 621 on 1/2 on invoice 7168 of 15/2, and its pair سكة
--     purchase return 54; شلبى 786, 808 + عبدالمنعم purchase return 435; سكة 22): recorded right after the invoice, on
--     the invoice's day, with the old date in the notes.
ALTER TABLE sahl_import.acc ADD COLUMN IF NOT EXISTS canon_branch text;

DO $mig$
BEGIN
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
$p$  UPDATE sahl_import.acc a SET canon = g.canon FROM (
    SELECT x.branch, x.name, first_value(x.name) OVER (PARTITION BY x.branch, x.k ORDER BY x.docs DESC, x.name) AS canon
      FROM (SELECT a1.branch, a1.name, a1.k, coalesce(d.docs, 0) AS docs$p$,
$p$  -- 0162 (owner «اسم العميل واحد بالثلاث فروع»): ONE account per name in all branches — the spelling with most documents
  UPDATE sahl_import.acc a SET canon = g.canon, canon_branch = g.canon_branch FROM (
    SELECT x.branch, x.name, first_value(x.name) OVER w AS canon, first_value(x.branch) OVER w AS canon_branch
      FROM (SELECT a1.branch, a1.name, a1.k, coalesce(d.docs, 0) AS docs,
                   CASE a1.branch WHEN 'shalaby' THEN 1 WHEN 'abdelmonem' THEN 2 ELSE 3 END AS bo$p$);
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
    $p$d ON d.branch = a1.branch AND d.name = a1.name) x) g$p$,
    $p$d ON d.branch = a1.branch AND d.name = a1.name) x
    WINDOW w AS (PARTITION BY x.k ORDER BY x.docs DESC, x.bo, x.name)) g$p$);
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
$p$  UPDATE sahl_import.acc a SET type = 'both' WHERE a.name = a.canon
     AND EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.branch = a.branch AND b.canon = a.name AND b.type IS DISTINCT FROM a.type);$p$,
$p$  UPDATE sahl_import.acc a SET type = 'both' WHERE a.name = a.canon AND a.branch = a.canon_branch  -- 0162: over every branch
     AND EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.k = a.k AND b.type IS DISTINCT FROM a.type);$p$);
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
$p$  -- a name also in another branch (same after the system's name rule) gets «(الفرع)»
  UPDATE sahl_import.acc a SET display = CASE
      WHEN EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.k = a.k AND b.branch <> a.branch)  -- 0160: keys, not 9M calls
      THEN a.name || ' (' || (SELECT label FROM sahl_import.cfg_branch c WHERE c.branch = a.branch) || ')' ELSE a.name END;$p$,
$p$  -- 0162: the account's name = the chosen spelling, no «(الفرع)» (one account in every branch)
  UPDATE sahl_import.acc a SET display = a.canon;$p$);
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
$p$  -- عبدالمنعم's returns on old invoices have no «ربح»: they wait for the owner's cost$p$,
$p$  -- 0162: a return dated before its own invoice in «سهل» is recorded right after the invoice, on the invoice's day
  UPDATE sahl_import.ops o SET day = s.day, tm = coalesce(s.tm, time '12:00') + interval '1 second',
         payload = jsonb_set(o.payload, '{notes}', to_jsonb((o.payload->>'notes') || ' — في سهل بتاريخ ' || to_char(o.day, 'DD/MM')
                                                           || '، قبل فاتورتها، فاتسجل يوم الفاتورة'))
    FROM sahl_import.ops s
   WHERE o.kind IN ('sale_return', 'purchase_return') AND s.branch = o.branch AND s.mirror_of IS NULL
     AND s.kind = CASE WHEN o.kind = 'sale_return' THEN 'sale' ELSE 'purchase' END AND s.no = (o.payload->>'inv_no')::int
     AND (s.day > o.day OR (s.day = o.day AND coalesce(s.tm, time '00:00') > coalesce(o.tm, time '00:00')));

  -- عبدالمنعم's returns on old invoices have no «ربح»: they wait for the owner's cost$p$);

  PERFORM sahl_import._patch('sahl_import.run_setup()'::regprocedure,
    $p$FOR r IN SELECT * FROM sahl_import.acc WHERE contact_id IS NULL AND name = coalesce(canon, name) ORDER BY branch, name LOOP  -- 0158$p$,
    $p$FOR r IN SELECT * FROM sahl_import.acc WHERE contact_id IS NULL AND name = canon AND branch = canon_branch ORDER BY branch, name LOOP  -- 0162: one per name$p$);
  PERFORM sahl_import._patch('sahl_import.run_setup()'::regprocedure,
    $p$UPDATE sahl_import.acc SET contact_id = (v_res->>'id')::uuid WHERE branch = r.branch AND coalesce(canon, name) = r.name;  -- 0158: every spelling$p$,
    $p$UPDATE sahl_import.acc SET contact_id = (v_res->>'id')::uuid WHERE k = r.k;  -- 0162: every spelling in every branch$p$);
  PERFORM sahl_import._patch('sahl_import.run_setup()'::regprocedure,
    $p$'notes', 'من سهل — ' || (SELECT label FROM sahl_import.cfg_branch c WHERE c.branch = r.branch)));$p$,
    $p$'notes', 'من سهل — ' || (SELECT string_agg(z.label || CASE WHEN abs(z.op) >= 0.005 THEN ' (رصيد 1/1: ' || to_char(z.op, 'FM999,999,990.00') || ')' ELSE '' END, '، ' ORDER BY z.label)
                                FROM (SELECT c.label, sum(x.opening) AS op FROM sahl_import.acc x JOIN sahl_import.cfg_branch c ON c.branch = x.branch
                                       WHERE x.k = r.k GROUP BY c.label) z)
              || CASE WHEN EXISTS (SELECT 1 FROM sahl_import.acc x WHERE x.k = r.k AND abs(x.opening) >= 0.005) THEN ' — الموجب عليه والسالب له' ELSE '' END));  -- 0162$p$);

  PERFORM sahl_import._patch('public.guard_return_item_refund()'::regprocedure,
    $p$IF COALESCE(NEW.refund,0) > v_max THEN$p$,
    $p$IF COALESCE(NEW.refund,0) > v_max AND NOT public.sahl_import_mode() THEN  -- 0162: «سهل» refunded the price before the bill discount$p$);
END
$mig$;
