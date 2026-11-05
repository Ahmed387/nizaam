-- 0167: a failing import step pauses its own pg_cron job. Before, the job retried the same failing operation every
-- minute (return 979, 2026-11-05 16:36 → 20:14 UTC) and the retries drained the Micro server's CPU credits. Now the
-- step's work is rolled back as before (nothing half-written), the error is written to `run_log`, and the job
-- `sahl-run` is switched off; it is switched on again by hand after the fix.
CREATE OR REPLACE FUNCTION sahl_import.step(p_to date, p_limit int DEFAULT 500) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb; v_err text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sahl_import.run_log WHERE what = 'setup') THEN
    v := sahl_import.run_setup();
    INSERT INTO sahl_import.run_log (what, res) VALUES ('setup', v);
    RETURN v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sahl_import.ops WHERE status = 'todo' AND day <= p_to) THEN
    RETURN jsonb_build_object('idle', true);
  END IF;
  BEGIN
    v := sahl_import.run_ops(p_to, true, p_limit);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;   -- the whole step is rolled back to here
  END;
  IF v_err IS NOT NULL THEN
    INSERT INTO sahl_import.run_log (what, res) VALUES ('error', jsonb_build_object('error', v_err));
    PERFORM cron.alter_job(j.jobid, active := false) FROM cron.job j WHERE j.jobname = 'sahl-run';
    RETURN jsonb_build_object('error', v_err, 'paused', true);
  END IF;
  INSERT INTO sahl_import.run_log (what, res) VALUES ('ops to ' || p_to, v);
  RETURN v;
END
$$;
