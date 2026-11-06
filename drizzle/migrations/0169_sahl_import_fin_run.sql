-- 0169: the end of the «سهل» import (0165) runs from pg_cron like the import, with the same guard as 0167: one step =
-- `fin_step(n)`; an error rolls that step back, is written to `run_log` and switches the job `sahl-run` off, so a
-- failing step is never retried every minute (2026-11-05: retries drained the Micro server). When the queue is empty
-- the job switches itself off too.
CREATE OR REPLACE FUNCTION sahl_import.fin_run(p_n int DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb; v_err text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sahl_import.fin_queue WHERE done_at IS NULL) THEN
    PERFORM cron.alter_job(j.jobid, active := false) FROM cron.job j WHERE j.jobname = 'sahl-run';
    RETURN jsonb_build_object('idle', true);
  END IF;
  BEGIN
    v := sahl_import.fin_step(p_n);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL THEN
    INSERT INTO sahl_import.run_log (what, res) VALUES ('fin error', jsonb_build_object('error', v_err));
    PERFORM cron.alter_job(j.jobid, active := false) FROM cron.job j WHERE j.jobname = 'sahl-run';
    RETURN jsonb_build_object('error', v_err, 'paused', true);
  END IF;
  INSERT INTO sahl_import.run_log (what, res) VALUES ('fin', v);
  RETURN v;
END
$$;
