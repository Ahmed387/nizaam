CREATE OR REPLACE FUNCTION public.sync_invoice_cash_treasury(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  v_pay numeric[];
  v_tid uuid[];
  i int;
  n_pay int;
  n_row int;
BEGIN
  SELECT id, invoice_number, branch_id, tenant_id INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv.id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(array_agg(amount ORDER BY created_at), '{}')
    INTO v_pay
  FROM public.invoice_payments
  WHERE invoice_id = _invoice_id
    AND LOWER(COALESCE(payment_method, 'cash')) = 'cash';

  SELECT COALESCE(array_agg(id ORDER BY created_at), '{}')
    INTO v_tid
  FROM public.treasury
  WHERE reference_id = _invoice_id AND type = 'income';

  n_pay := COALESCE(array_length(v_pay, 1), 0);
  n_row := COALESCE(array_length(v_tid, 1), 0);

  FOR i IN 1..GREATEST(n_pay, n_row) LOOP
    IF i <= n_pay AND i <= n_row THEN
      UPDATE public.treasury
         SET amount = v_pay[i],
             description = 'فاتورة ' || inv.invoice_number
       WHERE id = v_tid[i];
    ELSIF i <= n_pay THEN
      INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, payment_method, created_by)
      VALUES (inv.branch_id, inv.tenant_id, 'income', 'sales_extra_payment', v_pay[i],
              'فاتورة ' || inv.invoice_number, _invoice_id, 'cash', auth.uid());
    ELSE
      DELETE FROM public.treasury WHERE id = v_tid[i];
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_invoice_cash_treasury(uuid) FROM PUBLIC, anon;

DO $do$
DECLARE r record; v_def text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc WHERE proname = 'edit_invoice__impl' LOOP
    v_def := pg_get_functiondef(r.oid);
    v_def := regexp_replace(
      v_def,
      'UPDATE public\.treasury SET amount = v_total.*?type = ''income'';',
      'PERFORM public.sync_invoice_cash_treasury(_invoice_id);',
      'gs');
    EXECUTE v_def;
  END LOOP;
END
$do$;