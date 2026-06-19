
CREATE OR REPLACE FUNCTION public._test_guard_as_authenticated()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pid uuid; v_orig int; v_count int; v_result text;
BEGIN
  SELECT id, quantity INTO v_pid, v_orig FROM public.products LIMIT 1;
  -- Switch to authenticated role (mirrors what PostgREST does for a logged-in user)
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.products SET quantity = v_orig + 1 WHERE id = v_pid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    BEGIN UPDATE public.products SET quantity = v_orig WHERE id = v_pid; EXCEPTION WHEN OTHERS THEN NULL; END;
    v_result := 'UNEXPECTED_PASS: guard did NOT fire. rows=' || v_count || ', current_user=' || current_user;
  EXCEPTION WHEN OTHERS THEN
    v_result := 'BLOCKED ✓ : ' || SQLERRM || ' (current_user=' || current_user || ')';
  END;
  RESET ROLE;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public._test_guard_as_authenticated() TO anon, authenticated;
