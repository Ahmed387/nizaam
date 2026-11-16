-- 0237 — Telegram alerts to the company owner (owner 2026-11-16: «هنستخدم التليجرام … ببلاش»، «الرسائل تروح لصاحب الشركة بس»).
--
-- * ONE bot for the whole platform. The platform owner pastes its token on «إدارة المنصة» → it lives in Supabase Vault
--   (`platform_telegram.token_secret_id`), read only by the service role (`tg_bot_token`) — never returned to a browser.
--   The edge function `telegram` (mode 'setup', super admin) checks it (getMe) and sets the webhook with a random secret.
-- * Each company's owner data (name, mobile, e-mail) + its Telegram chat in `tenant_owner_contact`. Linking: the owner
--   presses «اربط تليجرام» → `tg_link_start()` makes a one-time code (15 min) → t.me/<bot>?start=<code> → the bot's
--   webhook calls `tg_link_finish(code, chat, username)` (service role). A bot can only write to a chat that pressed
--   Start, so customers / suppliers cannot be reached this way (owner only).
-- * Received e-invoices: a NEW document that is Valid (invoice I, credit note C, debit note D), or a recent one that turns
--   Valid later (a credit note waiting on the portal), gets `eta_documents.tg_state = 'pending'` while the company is
--   linked; cron «telegram-send» (every 5 min, only when something waits) calls `telegram` mode 'send', which sends the
--   summary + the ETA PDF and marks it 'sent' / 'failed' (`tg_eta_mark`; a failure also notifies the owner in the
--   system: «لم يتم توصيل رسالة تليجرام»). Documents that existed before this migration or before the link are 'skipped'.
-- No business table is written.

-- ---------------------------------------------------------------- tables
CREATE TABLE IF NOT EXISTS public.platform_telegram (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token_secret_id uuid,
  webhook_secret text,
  bot_username text,
  ok_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.platform_telegram ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_telegram FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.tenant_owner_contact (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_name text,
  owner_phone text,
  owner_email text,
  tg_chat_id bigint,
  tg_username text,
  tg_linked_at timestamptz,
  tg_link_code text,
  tg_link_expires timestamptz,
  tg_last_error text,
  tg_last_error_at timestamptz,
  tg_last_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.tenant_owner_contact ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_owner_contact FROM anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_owner_contact_code ON public.tenant_owner_contact (tg_link_code) WHERE tg_link_code IS NOT NULL;

ALTER TABLE public.eta_documents ADD COLUMN IF NOT EXISTS tg_state text;
ALTER TABLE public.eta_documents ADD COLUMN IF NOT EXISTS tg_sent_at timestamptz;
ALTER TABLE public.eta_documents ADD COLUMN IF NOT EXISTS tg_error text;
UPDATE public.eta_documents SET tg_state = 'skipped' WHERE tg_state IS NULL;
CREATE INDEX IF NOT EXISTS eta_documents_tg_pending ON public.eta_documents (tenant_id) WHERE tg_state = 'pending';

INSERT INTO public.system_cron_tokens (name, token)
SELECT 'telegram', encode(extensions.gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.system_cron_tokens WHERE name = 'telegram');

-- ---------------------------------------------------------------- platform bot (super admin)
CREATE OR REPLACE FUNCTION public.super_tg_status()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE p record;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM platform_telegram WHERE id = 1;
  RETURN jsonb_build_object('has_token', p.token_secret_id IS NOT NULL, 'bot_username', p.bot_username,
    'ok_at', p.ok_at, 'last_error', p.last_error,
    'linked_companies', (SELECT count(*) FROM tenant_owner_contact WHERE tg_chat_id IS NOT NULL));
END $$;

CREATE OR REPLACE FUNCTION public.super_tg_save_token(p_token text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $$
DECLARE v_id uuid; v_tok text := btrim(coalesce(p_token, ''));
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF v_tok !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$' THEN
    RAISE EXCEPTION 'ده مش شكل مفتاح بوت تليجرام — انسخه كامل من BotFather (أرقام ثم : ثم حروف)';
  END IF;
  INSERT INTO platform_telegram (id) VALUES (1) ON CONFLICT DO NOTHING;
  SELECT token_secret_id INTO v_id FROM platform_telegram WHERE id = 1 FOR UPDATE;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(v_tok, 'telegram_bot_token', 'Platform Telegram bot token');
  ELSE
    PERFORM vault.update_secret(v_id, v_tok);
  END IF;
  UPDATE platform_telegram SET token_secret_id = v_id, webhook_secret = encode(extensions.gen_random_bytes(24), 'hex'),
         bot_username = NULL, ok_at = NULL, last_error = NULL, updated_at = now(), updated_by = auth.uid()
   WHERE id = 1;
  RETURN public.super_tg_status();
END $$;

-- service role only: the token, the webhook secret, the setup result
CREATE OR REPLACE FUNCTION public.tg_bot_token()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $$
  SELECT jsonb_build_object('token', ds.decrypted_secret, 'webhook_secret', p.webhook_secret, 'bot_username', p.bot_username)
    FROM platform_telegram p LEFT JOIN vault.decrypted_secrets ds ON ds.id = p.token_secret_id
   WHERE p.id = 1
$$;

CREATE OR REPLACE FUNCTION public.tg_record_setup(p_ok boolean, p_username text, p_error text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE platform_telegram SET ok_at = CASE WHEN p_ok THEN now() END,
         bot_username = CASE WHEN p_ok THEN p_username ELSE bot_username END,
         last_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END, updated_at = now()
   WHERE id = 1
$$;

-- ---------------------------------------------------------------- company owner data + link (owner)
CREATE OR REPLACE FUNCTION public.owner_contact_get()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid; c record; v_bot text;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM tenant_owner_contact WHERE tenant_id = v_t;
  SELECT CASE WHEN ok_at IS NOT NULL THEN bot_username END INTO v_bot FROM platform_telegram WHERE id = 1;
  RETURN jsonb_build_object(
    'owner_name', c.owner_name, 'owner_phone', c.owner_phone, 'owner_email', c.owner_email,
    'tg_linked', c.tg_chat_id IS NOT NULL, 'tg_username', c.tg_username, 'tg_linked_at', c.tg_linked_at,
    'tg_last_error', c.tg_last_error, 'tg_last_error_at', c.tg_last_error_at, 'tg_last_sent_at', c.tg_last_sent_at,
    'bot_ready', v_bot IS NOT NULL, 'bot_username', v_bot, 'is_owner', public.is_owner(auth.uid()));
END $$;

CREATE OR REPLACE FUNCTION public.owner_contact_save(p_name text, p_phone text, p_email text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid; v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'); v_mail text := btrim(coalesce(p_email, ''));
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'بيانات صاحب الشركة للمالك بس' USING ERRCODE = '42501'; END IF;
  IF v_phone <> '' AND v_phone !~ '^\+?[0-9]{8,15}$' THEN RAISE EXCEPTION 'رقم الموبايل غلط'; END IF;
  IF v_mail <> '' AND v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'الإيميل غلط'; END IF;
  INSERT INTO tenant_owner_contact (tenant_id, owner_name, owner_phone, owner_email, updated_by)
  VALUES (v_t, NULLIF(btrim(p_name), ''), NULLIF(v_phone, ''), NULLIF(v_mail, ''), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET owner_name = EXCLUDED.owner_name, owner_phone = EXCLUDED.owner_phone,
     owner_email = EXCLUDED.owner_email, updated_at = now(), updated_by = auth.uid();
  RETURN public.owner_contact_get();
END $$;

CREATE OR REPLACE FUNCTION public.tg_link_start()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid; v_code text; v_bot text;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'ربط تليجرام للمالك بس' USING ERRCODE = '42501'; END IF;
  SELECT bot_username INTO v_bot FROM platform_telegram WHERE id = 1 AND ok_at IS NOT NULL;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'بوت التليجرام لسه مش متجهز من إدارة المنصة'; END IF;
  v_code := encode(extensions.gen_random_bytes(12), 'hex');
  INSERT INTO tenant_owner_contact (tenant_id, tg_link_code, tg_link_expires, updated_by)
  VALUES (v_t, v_code, now() + interval '15 minutes', auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET tg_link_code = v_code, tg_link_expires = now() + interval '15 minutes',
     updated_at = now(), updated_by = auth.uid();
  RETURN jsonb_build_object('url', 'https://t.me/' || v_bot || '?start=' || v_code, 'expires_in', 900);
END $$;

CREATE OR REPLACE FUNCTION public.tg_unlink()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'للمالك بس' USING ERRCODE = '42501'; END IF;
  UPDATE tenant_owner_contact SET tg_chat_id = NULL, tg_username = NULL, tg_linked_at = NULL, tg_link_code = NULL,
         tg_link_expires = NULL, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = v_t;
  UPDATE eta_documents SET tg_state = 'skipped' WHERE tenant_id = v_t AND tg_state = 'pending';
  RETURN public.owner_contact_get();
END $$;

-- service role: the bot got «/start <code>»
CREATE OR REPLACE FUNCTION public.tg_link_finish(p_code text, p_chat bigint, p_username text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; v_name text;
BEGIN
  SELECT * INTO c FROM tenant_owner_contact WHERE tg_link_code = p_code AND tg_link_expires > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  UPDATE tenant_owner_contact SET tg_chat_id = p_chat, tg_username = left(p_username, 64), tg_linked_at = now(),
         tg_link_code = NULL, tg_link_expires = NULL, tg_last_error = NULL, tg_last_error_at = NULL, updated_at = now()
   WHERE tenant_id = c.tenant_id;
  -- what was already there is not sent; only what arrives from now on
  UPDATE eta_documents SET tg_state = 'skipped' WHERE tenant_id = c.tenant_id AND tg_state IS NULL AND status = 'Valid';
  SELECT name INTO v_name FROM tenants WHERE id = c.tenant_id;
  RETURN jsonb_build_object('ok', true, 'tenant_id', c.tenant_id, 'company', v_name);
END $$;

-- service role: where to send (company → chat)
CREATE OR REPLACE FUNCTION public.tg_chat_of(p_tenant uuid)
 RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT tg_chat_id FROM tenant_owner_contact WHERE tenant_id = p_tenant $$;

-- service role: record a send result for a company (and tell the owner inside the system on failure)
CREATE OR REPLACE FUNCTION public.tg_record_send(p_tenant uuid, p_ok boolean, p_error text, p_what text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE u record;
BEGIN
  IF p_ok THEN
    UPDATE tenant_owner_contact SET tg_last_sent_at = now(), tg_last_error = NULL, tg_last_error_at = NULL WHERE tenant_id = p_tenant;
    RETURN;
  END IF;
  UPDATE tenant_owner_contact SET tg_last_error = left(p_error, 500), tg_last_error_at = now() WHERE tenant_id = p_tenant;
  FOR u IN SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.tenant_id = p_tenant AND ur.role = 'owner' LOOP
    INSERT INTO notifications (tenant_id, user_id, title, body, type, link)
    VALUES (p_tenant, u.user_id, 'لم يتم توصيل رسالة تليجرام', coalesce(p_what, '') || ' — ' || left(coalesce(p_error, ''), 200),
            'telegram_failed', '/admin/settings?tab=owner');
  END LOOP;
END $$;

-- ---------------------------------------------------------------- e-invoices → pending
CREATE OR REPLACE FUNCTION public.eta_tg_mark_pending()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.tg_state IS NOT NULL OR NEW.status IS DISTINCT FROM 'Valid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Valid' THEN RETURN NEW; END IF;
  -- a new document saved as «seen» is older than 3 days (eta_ingest) — not news
  IF TG_OP = 'INSERT' AND NEW.seen_at IS NOT NULL THEN RETURN NEW; END IF;
  IF upper(coalesce(NEW.type_name, '')) NOT IN ('I', 'C', 'D') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM tenant_owner_contact c WHERE c.tenant_id = NEW.tenant_id AND c.tg_chat_id IS NOT NULL) THEN
    NEW.tg_state := 'pending';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_eta_tg_pending ON public.eta_documents;
CREATE TRIGGER zz_eta_tg_pending BEFORE INSERT OR UPDATE OF status ON public.eta_documents
  FOR EACH ROW EXECUTE FUNCTION public.eta_tg_mark_pending();

-- service role: what waits (with what the message needs)
CREATE OR REPLACE FUNCTION public.tg_eta_pending(p_limit int DEFAULT 10)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT d.id, d.tenant_id, d.eta_uuid, d.internal_id, d.type_name, d.issuer_id, d.issuer_name, d.date_issued,
           d.total_sales, d.total_discount, d.net_amount, d.total, d.detail IS NOT NULL AS has_detail, d.detail,
           c.tg_chat_id AS chat, s.shipment_number AS matched_number, d.match_mode,
           (SELECT r.internal_id FROM eta_documents r WHERE r.tenant_id = d.tenant_id
              AND r.eta_uuid = coalesce(d.detail->'document'->'references'->>0, d.raw->'references'->>0) LIMIT 1) AS ref_internal_id
      FROM eta_documents d
      JOIN tenant_owner_contact c ON c.tenant_id = d.tenant_id AND c.tg_chat_id IS NOT NULL
      LEFT JOIN shipments s ON s.id = d.match_shipment_id
     WHERE d.tg_state = 'pending'
     ORDER BY d.date_issued NULLS LAST
     LIMIT greatest(1, least(p_limit, 30))) x
$$;

CREATE OR REPLACE FUNCTION public.tg_eta_mark(p_doc uuid, p_ok boolean, p_error text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d record;
BEGIN
  SELECT tenant_id, internal_id INTO d FROM eta_documents WHERE id = p_doc;
  UPDATE eta_documents SET tg_state = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END,
         tg_sent_at = CASE WHEN p_ok THEN now() END, tg_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END
   WHERE id = p_doc;
  PERFORM public.tg_record_send(d.tenant_id, p_ok, p_error, 'فاتورة إلكترونية ' || coalesce(d.internal_id, ''));
END $$;

-- cron: call the edge function only when something waits
CREATE OR REPLACE FUNCTION public.tg_send_tick()
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM eta_documents WHERE tg_state = 'pending') THEN RETURN 0; END IF;
  PERFORM public.nizam_cron_call('telegram', jsonb_build_object('mode', 'send'));
  RETURN 1;
END $$;

-- ---------------------------------------------------------------- privileges
REVOKE ALL ON FUNCTION public.super_tg_status(), public.super_tg_save_token(text), public.tg_bot_token(),
  public.tg_record_setup(boolean, text, text), public.owner_contact_get(), public.owner_contact_save(text, text, text),
  public.tg_link_start(), public.tg_unlink(), public.tg_link_finish(text, bigint, text), public.tg_chat_of(uuid),
  public.tg_record_send(uuid, boolean, text, text), public.eta_tg_mark_pending(), public.tg_eta_pending(int),
  public.tg_eta_mark(uuid, boolean, text), public.tg_send_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_tg_status(), public.super_tg_save_token(text), public.owner_contact_get(),
  public.owner_contact_save(text, text, text), public.tg_link_start(), public.tg_unlink() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_bot_token(), public.tg_record_setup(boolean, text, text),
  public.tg_link_finish(text, bigint, text), public.tg_chat_of(uuid), public.tg_record_send(uuid, boolean, text, text),
  public.tg_eta_pending(int), public.tg_eta_mark(uuid, boolean, text) TO service_role;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('super_tg_status', '0237', 'telegram bot status (super)'),
  ('super_tg_save_token', '0237', 'telegram bot token → vault (super)'),
  ('owner_contact_get', '0237', 'company owner data + telegram link'),
  ('owner_contact_save', '0237', 'company owner data (owner)'),
  ('tg_link_start', '0237', 'telegram link code (owner)'),
  ('tg_unlink', '0237', 'telegram unlink (owner)')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- cron
DO $c$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'telegram-send';
  PERFORM cron.schedule('telegram-send', '*/5 * * * *', 'SELECT public.tg_send_tick()');
END $c$;

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN
    RAISE EXCEPTION '0237: exposed definer functions: %', (SELECT string_agg(f::text, ', ') FROM public.security_exposed_definer_functions() f);
  END IF;
END $chk$;
