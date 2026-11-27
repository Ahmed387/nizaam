-- 0295b: partner_cards (and partners_overview, which calls it) return archived_at / archive_reason, so the partners screens
-- show «مؤرشف» apart from «موقوف» (owner 2026-11-27 «احذفها / ارشفها»). Read-only change, patched from pg_get_functiondef.
DO $$
DECLARE d text; s1 text := '''initial_capital'', p.initial_capital)';
BEGIN
  d := pg_get_functiondef('public.partner_cards(uuid)'::regprocedure);
  IF position(s1 in d) = 0 THEN RAISE EXCEPTION '0295b: partner_cards text not found'; END IF;
  IF position('archived_at' in d) > 0 THEN RETURN; END IF;
  d := replace(d, s1, '''initial_capital'', p.initial_capital, ''archived_at'', p.archived_at, ''archive_reason'', p.archive_reason)');
  EXECUTE d;
END $$;
