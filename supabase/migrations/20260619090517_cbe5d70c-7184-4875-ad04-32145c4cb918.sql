
CREATE OR REPLACE FUNCTION public._test_guard_as_invoker()
RETURNS text LANGUAGE plpgsql
AS $$
DECLARE v_pid uuid; v_orig int; v_count int;
BEGIN
  -- Get a row id via elevated path (so RLS doesn't hide it)
  SELECT id, quantity INTO v_pid, v_orig
  FROM public._whoami_pick_product();
  RAISE NOTICE 'current_user=%, target product=%, orig qty=%', current_user, v_pid, v_orig;
  BEGIN
    UPDATE products SET quantity = v_orig + 1 WHERE id = v_pid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    -- Restore in case it slipped through
    BEGIN UPDATE products SET quantity = v_orig WHERE id = v_pid; EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN 'UNEXPECTED_PASS: guard did NOT block. rows affected=' || v_count || ', current_user=' || current_user;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'BLOCKED ✓ : ' || SQLERRM || ' (current_user=' || current_user || ')';
  END;
END;
$$;

-- Helper SECURITY DEFINER to fetch a product id (bypassing RLS)
CREATE OR REPLACE FUNCTION public._whoami_pick_product()
RETURNS TABLE(id uuid, quantity int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id, quantity FROM public.products LIMIT 1 $$;

GRANT EXECUTE ON FUNCTION public._whoami_pick_product() TO anon, authenticated;
