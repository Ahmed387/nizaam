CREATE OR REPLACE FUNCTION public.next_journal_number(p_tenant_id uuid, p_entry_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_seq INTEGER; v_prefix TEXT;
BEGIN
  v_prefix := 'JE-'||to_char(p_entry_date,'YYYYMM')||'-';
  -- serialize numbering per tenant+month for the duration of the transaction
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || v_prefix));
  SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'-',3) AS INTEGER)),0)+1 INTO v_seq
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND entry_number LIKE v_prefix||'%';
  RETURN v_prefix||LPAD(v_seq::TEXT,4,'0');
END;
$fn$;

REVOKE ALL ON FUNCTION public.next_journal_number(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_journal_number(uuid, date) TO authenticated, service_role;

DO $do$
DECLARE
  r RECORD;
  v_def TEXT;
  v_old TEXT := 'SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,''-'',3) AS INTEGER)),0)+1 INTO v_seq';
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('create_journal_entry','post_journal')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position(v_old in v_def) > 0 THEN
      v_def := replace(
        v_def,
        v_old,
        'PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ''JE-''||to_char(p_entry_date,''YYYYMM'')||''-'')); '||v_old
      );
      EXECUTE v_def;
    END IF;
  END LOOP;
END;
$do$;