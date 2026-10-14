-- 0088 — cancel_sale_return failed on every call: its guard used the alias «r», which clashes with its own record
-- variable «r» ("record r is not assigned yet"). Same fix as cancel_voucher (alias gv): the guard alias is «gr».
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.cancel_sale_return(uuid,text)'::regprocedure);
  IF position('SELECT r.branch_id FROM public.returns r WHERE r.id = _return_id' in d) > 0 THEN
    d := replace(d, 'SELECT r.branch_id FROM public.returns r WHERE r.id = _return_id',
                    'SELECT gr.branch_id FROM public.returns gr WHERE gr.id = _return_id');
    EXECUTE d;
  END IF;
END $x$;
