
CREATE OR REPLACE FUNCTION public._test_guard_as_invoker()
RETURNS text LANGUAGE plpgsql
AS $$
DECLARE v_pid uuid; v_orig int;
BEGIN
  SELECT id, quantity INTO v_pid, v_orig FROM products LIMIT 1;
  BEGIN
    UPDATE products SET quantity = v_orig + 1 WHERE id = v_pid;
    UPDATE products SET quantity = v_orig WHERE id = v_pid;
    RETURN 'UNEXPECTED_PASS: guard did NOT block invoker update';
  EXCEPTION WHEN OTHERS THEN
    RETURN 'BLOCKED ✓ : ' || SQLERRM;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._test_guard_as_definer()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pid uuid; v_orig int;
BEGIN
  SELECT id, quantity INTO v_pid, v_orig FROM products LIMIT 1;
  BEGIN
    UPDATE products SET quantity = v_orig + 1 WHERE id = v_pid;
    UPDATE products SET quantity = v_orig WHERE id = v_pid;
    RETURN 'PASSED ✓ : SECURITY DEFINER allowed through (current_user=' || current_user || ')';
  EXCEPTION WHEN OTHERS THEN
    RETURN 'UNEXPECTED_BLOCK: ' || SQLERRM;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public._test_guard_as_invoker() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._test_guard_as_definer() TO anon, authenticated;
