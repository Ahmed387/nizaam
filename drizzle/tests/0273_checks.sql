-- 0273 checks (rollback-only, ends with RAISE): the platform owner sets up a company's Telegram from its page.
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  SUPER uuid := '6739ed29-f36f-4bec-8f72-0fba66b01232';
  OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  out text := ''; fails int := 0; r jsonb; o jsonb; err text; c record;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', SUPER, 'role', 'authenticated')::text, true);

  -- 1) owner link: ?start= + 6 digits, the company waits for «owner»
  BEGIN
    r := public.super_tg_invite(T, 'owner');
    o := public.super_tenant_ops_get(T);
    IF r->>'url' ~ '\?start=[0-9]{6}$' AND r->>'code' ~ '^[0-9]{6}$' AND o->>'waiting' = 'owner' AND (o->>'bot_ready')::boolean
    THEN out := out || E'\nPASS 1 لينك صاحب الشركة: ?start= وكود 6 أرقام، والشركة مستنية «owner»';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 1 owner link: %s waiting=%s', r, o->>'waiting'); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 1 owner link: ' || SQLERRM; END;

  -- 2) the bot gets «/start <code>» from a private chat → linked, nothing waiting any more
  BEGIN
    SELECT * INTO c FROM tenant_owner_contact WHERE tenant_id = T;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM public.tg_link_finish(c.tg_link_code, 990000001, 'qa_owner', 'private', NULL);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', SUPER, 'role', 'authenticated')::text, true);
    o := public.super_tenant_ops_get(T);
    IF (o->>'tg_linked')::boolean AND o->>'tg_username' = 'qa_owner' AND o->>'waiting' IS NULL
    THEN out := out || E'\nPASS 2 Start من موبايل صاحب الشركة: الكارت يقول «اتربط @qa_owner»';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 2 finish: linked=%s user=%s waiting=%s', o->>'tg_linked', o->>'tg_username', o->>'waiting'); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 2 finish: ' || SQLERRM; END;

  -- 3) group link: ?startgroup=
  BEGIN
    r := public.super_tg_invite(T, 'group');
    o := public.super_tenant_ops_get(T);
    IF r->>'url' ~ '\?startgroup=[0-9]{6}$' AND o->>'waiting' = 'group'
    THEN out := out || E'\nPASS 3 لينك الجروب: ?startgroup= والشركة مستنية «group»';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 3 group link: %s', r); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 3 group link: ' || SQLERRM; END;

  -- 4) a wrong kind is refused
  BEGIN
    PERFORM public.super_tg_invite(T, 'customers');
    fails := fails + 1; out := out || E'\nFAIL 4 wrong kind accepted';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 4 نوع غلط اترفض: ' || SQLERRM; END;

  -- 5) documents switch off / on
  BEGIN
    o := public.super_tg_docs_set(T, false);
    IF NOT (o->>'docs_enabled')::boolean THEN
      o := public.super_tg_docs_set(T, true);
      IF (o->>'docs_enabled')::boolean THEN out := out || E'\nPASS 5 «ابعت كل المستندات على الجروب»: اتقفل واتفتح';
      ELSE fails := fails + 1; out := out || E'\nFAIL 5 docs on'; END IF;
    ELSE fails := fails + 1; out := out || E'\nFAIL 5 docs off'; END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 5 docs: ' || SQLERRM; END;

  -- 6) daily report switch off / on, retention untouched
  BEGIN
    o := public.super_tg_daily_set(T, false);
    IF NOT (o->>'daily_report_enabled')::boolean THEN
      o := public.super_tg_daily_set(T, true);
      IF (o->>'daily_report_enabled')::boolean AND (o->>'audit_retention_days')::int >= 1 THEN out := out || E'\nPASS 6 «التقرير اليومي»: اتقفل واتفتح، ومدة الاحتفاظ زي ما هي';
      ELSE fails := fails + 1; out := out || E'\nFAIL 6 daily on'; END IF;
    ELSE fails := fails + 1; out := out || E'\nFAIL 6 daily off'; END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 6 daily: ' || SQLERRM; END;

  -- 7) the card's other facts are there
  o := public.super_tenant_ops_get(T);
  IF o ? 'plan_daily_report' AND o ? 'plan_telegram' AND o ? 'docs_sent_today' AND o ? 'docs_failed' AND o ? 'bot_username'
  THEN out := out || format(E'\nPASS 7 الكارت بيقرا: الباقة (تقرير=%s، تليجرام=%s)، المستندات النهارده=%s', o->>'plan_daily_report', o->>'plan_telegram', o->>'docs_sent_today');
  ELSE fails := fails + 1; out := out || E'\nFAIL 7 keys missing'; END IF;

  -- 8) nobody but the platform owner — the company owner is refused on all three
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.super_tg_invite(T, 'owner'); fails := fails + 1; out := out || E'\nFAIL 8a owner allowed';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 8a صاحب الشركة اترفض في لينك المنصة: ' || SQLERRM; END;
  BEGIN PERFORM public.super_tg_docs_set(T, false); fails := fails + 1; out := out || E'\nFAIL 8b owner allowed';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 8b اترفض في زرار المستندات'; END;
  BEGIN PERFORM public.super_tg_daily_set(T, false); fails := fails + 1; out := out || E'\nFAIL 8c owner allowed';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 8c اترفض في زرار التقرير'; END;

  -- 9) no definer function open to the browser by mistake
  IF (SELECT count(*) FROM public.security_exposed_definer_functions()) = 0 THEN out := out || E'\nPASS 9 مفيش دالة مكشوفة';
  ELSE fails := fails + 1; out := out || E'\nFAIL 9 exposed definer functions'; END IF;

  RAISE EXCEPTION E'CHECKS 0273 fails=% %', fails, out;
END $t$;
