-- 0155: the writer the edge function `sahl-import` uses to put one file's records into the staging tables of 0154
-- (service role only), and the edge function's token (removed when the staging is finished). A file staged again
-- replaces its earlier rows. Nothing in the business tables changes here.
CREATE OR REPLACE FUNCTION public.sahl_import_stage(p_file jsonb, p_records jsonb, p_offset int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, sahl_import
AS $$
DECLARE n int;
BEGIN
  IF p_offset = 0 THEN
    DELETE FROM sahl_import.files WHERE sha256 = p_file->>'sha256';
    INSERT INTO sahl_import.files (sha256, name, branch, kind, period, n_records)
    VALUES (p_file->>'sha256', p_file->>'name', p_file->>'branch', p_file->>'kind', p_file->>'period',
            coalesce((p_file->>'n_records')::int, 0));
  END IF;
  INSERT INTO sahl_import.records (sha256, branch, kind, seq, rec)
  SELECT p_file->>'sha256', p_file->>'branch', p_file->>'kind', p_offset + t.o::int, t.r
  FROM jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) WITH ORDINALITY AS t(r, o);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.sahl_import_stage(jsonb, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_import_stage(jsonb, jsonb, int) TO service_role;

INSERT INTO public.system_cron_tokens (name, token)
VALUES ('sahl-import', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (name) DO NOTHING;
