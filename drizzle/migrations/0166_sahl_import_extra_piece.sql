-- 0166: «سهل» let a few returns take back more pieces than their invoice sold (6 in شلبى, all with the branch accounts:
-- return 979 on 10/6 took 3 × «1249» back on invoice 7433, which sold 5 and had 3 back already by return 771). The engine
-- puts such an extra piece on the latest EARLIER invoice of the same account with that item (0157). Return 979 has none
-- (the only other one is 7920 of 14/6), so the real run stopped there (2026-11-05 16:36 → 20:14 UTC, every step rolled
-- back, nothing half-written). Now, when no earlier invoice can take it, the extra piece is recorded on the NEXT invoice
-- of that account with that item, on that invoice's day, with the old return and day in the notes — the same rule as a
-- return dated before its own invoice (0162). Its money (if «سهل» paid any back) moves with it.
DO $mig$
BEGIN
  PERFORM sahl_import._patch('sahl_import.do_op(sahl_import.ops)'::regprocedure,
    $p$      IF v_inv IS NULL THEN RAISE EXCEPTION 'return %: % pieces of % have no invoice to go on', o.no, l->>'qty', l->>'sku'; END IF;$p$,
    $p$      IF v_inv IS NULL THEN
        -- 0166: no earlier invoice can take it → the next invoice of this account with this item, on its own day
        DECLARE v_nx record; v_mv numeric;
        BEGIN
          SELECT s.no, s.day, s.tm INTO v_nx FROM sahl_import.ops s CROSS JOIN LATERAL jsonb_array_elements(s.payload->'lines') x
           WHERE s.branch = o.branch AND s.kind = 'sale' AND s.mirror_of IS NULL AND s.status = 'todo' AND s.day >= o.day
             AND s.payload->>'contact' = p->>'contact' AND x->>'sku' = l->>'sku' AND (x->>'qty')::int >= (l->>'qty')::int
           ORDER BY s.day, s.tm NULLS FIRST, s.id LIMIT 1;
          IF FOUND THEN
            v_mv := CASE WHEN v_m IS NOT NULL THEN least(v_paid, (l->>'net')::numeric) ELSE 0 END;
            INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload)
            VALUES (o.branch, v_nx.day, coalesce(v_nx.tm, time '12:00') + interval '1 second', 3, 'sale_return', o.src_kind, o.no,
                    jsonb_build_object('contact', p->>'contact', 'inv_no', v_nx.no, 'lines', jsonb_build_array(l), 'total', (l->>'net')::numeric,
                      'pays', CASE WHEN v_mv > 0 THEN jsonb_build_array(jsonb_build_object('method', v_m, 'amount', v_mv)) ELSE '[]'::jsonb END,
                      'notes', (p->>'notes') || ' — ' || (l->>'qty') || ' قطعة زيادة عن فاتورة ' || (p->>'inv_no') || ' في سهل بتاريخ '
                               || to_char(o.day, 'DD/MM') || '، اتسجلت على فاتورة ' || v_nx.no || ' يوم ' || to_char(v_nx.day, 'DD/MM')));
            v_paid := v_paid - v_mv;
            CONTINUE;
          END IF;
        END;
        RAISE EXCEPTION 'return %: % pieces of % have no invoice to go on', o.no, l->>'qty', l->>'sku';
      END IF;$p$);
END
$mig$;
