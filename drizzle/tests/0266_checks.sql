-- 0266 checks (rollback-only): the Telegram link code is 6 digits, works typed or through the link, a chat that keeps
-- guessing is stopped, the purpose (personal / group) still holds. Puts the owner's real link back by rolling back.
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  out text := ''; fails int := 0; r jsonb; code text; i int; old_chat bigint; old_group bigint;
BEGIN
  SELECT tg_chat_id, tg_group_chat_id INTO old_chat, old_group FROM tenant_owner_contact WHERE tenant_id = T;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);

  -- 1 personal code = 6 digits, the link carries it
  r := public.tg_link_start('owner'); code := r->>'code';
  IF code ~ '^[0-9]{6}$' AND r->>'url' LIKE '%?start=' || code THEN out := out || E'\nPASS 1 code ' || code;
  ELSE fails := fails + 1; out := out || E'\nFAIL 1 ' || r::text; END IF;

  -- 2 wrong code from a stranger x5 → the 6th (even the right one) is refused
  FOR i IN 1..5 LOOP r := public.tg_link_finish('000000', 777000111, 'x', 'private', NULL); END LOOP;
  r := public.tg_link_finish(code, 777000111, 'x', 'private', NULL);
  IF r->>'reason' = 'too_many' THEN out := out || E'\nPASS 2 guessing stopped';
  ELSE fails := fails + 1; out := out || E'\nFAIL 2 ' || r::text; END IF;

  -- 3 a group cannot use the personal code
  r := public.tg_link_finish(code, -100777, NULL, 'supergroup', 'g');
  IF r->>'reason' = 'need_private' THEN out := out || E'\nPASS 3 personal code refused in a group';
  ELSE fails := fails + 1; out := out || E'\nFAIL 3 ' || r::text; END IF;

  -- 4 the right chat links with the typed code
  r := public.tg_link_finish(translate(code, '0123456789', '٠١٢٣٤٥٦٧٨٩'), 777000222, 'y', 'private', NULL);  -- typed with Arabic digits
  IF (r->>'ok')::boolean AND (SELECT tg_chat_id FROM tenant_owner_contact WHERE tenant_id = T) = 777000222
  THEN out := out || E'\nPASS 4 linked'; ELSE fails := fails + 1; out := out || E'\nFAIL 4 ' || r::text; END IF;

  -- 5 a used code does not work again
  r := public.tg_link_finish(code, 777000333, 'z', 'private', NULL);
  IF r->>'reason' = 'expired' THEN out := out || E'\nPASS 5 one time'; ELSE fails := fails + 1; out := out || E'\nFAIL 5 ' || r::text; END IF;

  -- 6 group code → startgroup link, group links
  r := public.tg_link_start('group'); code := r->>'code';
  IF r->>'url' LIKE '%?startgroup=' || code AND (public.tg_link_finish(code, -100888, NULL, 'supergroup', 'فواتير')->>'ok')::boolean
  THEN out := out || E'\nPASS 6 group linked'; ELSE fails := fails + 1; out := out || E'\nFAIL 6 ' || r::text; END IF;

  -- 7 status for the page
  r := public.tg_link_status();
  IF (r->>'owner_linked')::boolean AND (r->>'group_linked')::boolean THEN out := out || E'\nPASS 7 status';
  ELSE fails := fails + 1; out := out || E'\nFAIL 7 ' || coalesce(r::text, 'null'); END IF;

  RAISE EXCEPTION 'CHECKS fails=% %', fails, out;
END $t$;
