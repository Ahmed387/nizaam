-- 0164: the real «سهل» import runs in small committed steps from pg_cron (owner 2026-11-05 «نفذها بالكامل … كمل»):
-- one long transaction stacks thousands of savepoints and slows down (Q1 dry-run: 6,175 operations in 4.5 min), and
-- the web gateway cuts long calls. `sahl_import.step(to, n)` does ONE step per call: the setup once (products,
-- accounts, opening balances and stock — logged in `run_log`), then up to n operations in date order up to `to`.
-- An error rolls back that whole step and stops (the job's message says which operation); nothing half-written stays.
-- The work tables go back to LOGGED: a server restart must not lose which operations are done.
ALTER TABLE sahl_import.ops SET LOGGED;
ALTER TABLE sahl_import.code_map SET LOGGED;
ALTER TABLE sahl_import.prod_price SET LOGGED;

CREATE TABLE IF NOT EXISTS sahl_import.run_log (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), what text NOT NULL, res jsonb);

CREATE OR REPLACE FUNCTION sahl_import.step(p_to date, p_limit int DEFAULT 500) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sahl_import.run_log WHERE what = 'setup') THEN
    v := sahl_import.run_setup();
    INSERT INTO sahl_import.run_log (what, res) VALUES ('setup', v);
    RETURN v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sahl_import.ops WHERE status = 'todo' AND day <= p_to) THEN
    RETURN jsonb_build_object('idle', true);
  END IF;
  v := sahl_import.run_ops(p_to, true, p_limit);
  INSERT INTO sahl_import.run_log (what, res) VALUES ('ops to ' || p_to, v);
  RETURN v;
END
$$;
