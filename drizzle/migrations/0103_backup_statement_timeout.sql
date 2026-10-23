-- 0103 — Nightly backup: give the server role time to read the big tables
--
-- Why: every automatic backup since 2026-10-13 failed with «canceling statement due to statement timeout»
-- (57014) on journal_entries (166k rows) / journal_entry_lines (333k) — sometimes historical_vouchers or
-- audit_log. The edge function reads each table with backup_fetch_page through the REST API, where the
-- default limit is 8 s per statement; deep OFFSET pages on a busy Micro database pass 8 s.
-- Last full backup: 2026-10-12.
--
-- Fix: statement_timeout 2 min for service_role only (edge functions / cron — never the browser).
-- anon / authenticated keep 8 s. No table, row or function changes.

ALTER ROLE service_role SET statement_timeout = '120s';
NOTIFY pgrst, 'reload config';
