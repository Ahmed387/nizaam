-- 0160: 0158's «(الفرع)» check called the system's name rule `normalize_ar_name` for every PAIR of accounts
-- (2,137 × 2,137 × 2 ≈ 9 million calls of a non-inlinable SQL function inside a per-row sub-plan) and the database
-- server ran out of memory and restarted (2026-11-05 15:36, 15:39, 15:42, 15:49 UTC, every time `build()` ran after
-- 0158; `build()` before 0158 ran in 7 s). Now each account's key is computed ONCE (`acc.k`) and accounts are compared
-- by that key. Same result, about 2,000 calls.
ALTER TABLE sahl_import.acc ADD COLUMN IF NOT EXISTS k text;

DO $mig$
BEGIN
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
    $p$  UPDATE sahl_import.acc a SET canon = g.canon FROM ($p$,
    $p$  UPDATE sahl_import.acc SET k = trim(public.normalize_ar_name(name));  -- 0160: the name rule once per account
  UPDATE sahl_import.acc a SET canon = g.canon FROM ($p$);
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
    $p$      FROM (SELECT a1.branch, a1.name, trim(public.normalize_ar_name(a1.name)) AS k, coalesce(d.docs, 0) AS docs$p$,
    $p$      FROM (SELECT a1.branch, a1.name, a1.k, coalesce(d.docs, 0) AS docs$p$);
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
    $p$      WHEN EXISTS (SELECT 1 FROM sahl_import.acc b WHERE trim(public.normalize_ar_name(b.name)) = trim(public.normalize_ar_name(a.name)) AND b.branch <> a.branch)$p$,
    $p$      WHEN EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.k = a.k AND b.branch <> a.branch)  -- 0160: keys, not 9M calls$p$);
  IF position('normalize_ar_name(b.name)' IN pg_get_functiondef('sahl_import.build()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '0160: build() still compares names pair by pair';
  END IF;
END
$mig$;
