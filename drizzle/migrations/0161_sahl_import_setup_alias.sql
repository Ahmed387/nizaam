-- 0161: `sahl_import.run_setup()` — the opening-stock query used the alias `r` for the staged records while `r` is also
-- the function's loop variable («column reference "r.branch" is ambiguous», dry-run 2026-11-05 15:56 UTC). Alias → `rs`.
DO $mig$
BEGIN
  PERFORM sahl_import._patch('sahl_import.run_setup()'::regprocedure,
$p$  SELECT jsonb_agg(jsonb_build_object('product_id', sahl_import.pid(r.branch, m.sku),
           'quantity', round(sahl_import.n(r.rec, 'الكمية') * CASE WHEN p.unit3 THEN 3 ELSE 1 END),
           'cost_price', round(sahl_import.n(r.rec, 'سعر الشراء') / CASE WHEN p.unit3 THEN 3 ELSE 1 END, 4)))
    INTO v_inv
    FROM sahl_import.records r JOIN sahl_import.code_map m ON m.branch = r.branch AND m.code = r.rec->>'رقم الصنف'
    JOIN sahl_import.prod p ON p.sku = m.sku
   WHERE r.kind = 'تقرير بضاعة مخزن' AND sahl_import.n(r.rec, 'الكمية') > 0;$p$,
$p$  SELECT jsonb_agg(jsonb_build_object('product_id', sahl_import.pid(rs.branch, m.sku),  -- 0161: alias rs (r is the loop variable)
           'quantity', round(sahl_import.n(rs.rec, 'الكمية') * CASE WHEN p.unit3 THEN 3 ELSE 1 END),
           'cost_price', round(sahl_import.n(rs.rec, 'سعر الشراء') / CASE WHEN p.unit3 THEN 3 ELSE 1 END, 4)))
    INTO v_inv
    FROM sahl_import.records rs JOIN sahl_import.code_map m ON m.branch = rs.branch AND m.code = rs.rec->>'رقم الصنف'
    JOIN sahl_import.prod p ON p.sku = m.sku
   WHERE rs.kind = 'تقرير بضاعة مخزن' AND sahl_import.n(rs.rec, 'الكمية') > 0;$p$);
END
$mig$;
