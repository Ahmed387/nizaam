-- Merge every public.X__impl into its guarded wrapper public.X (nested block), then drop the __impl copy.
DO $merge$
DECLARE
  r record; w text; i text; marker constant text := 'AS $function$'; endtag constant text := '$function$';
  s int; head text; wbody text; ibody text; call text;
BEGIN
  FOR r IN
    SELECT p.oid AS ioid, left(p.proname, length(p.proname) - 6) AS base
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%\_\_impl'
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO STRICT w
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.base;
    i := pg_get_functiondef(r.ioid);

    s := position(marker in i);
    ibody := rtrim(substr(i, s + length(marker)), E' \n\t');
    ibody := rtrim(left(ibody, length(ibody) - length(endtag)), E' \n\t;');

    s := position(marker in w);
    head := left(w, s - 1);
    wbody := rtrim(substr(w, s + length(marker)), E' \n\t');
    wbody := left(wbody, length(wbody) - length(endtag));

    call := (regexp_match(wbody, '((?:PERFORM|RETURN)\s+public\.' || r.base || '__impl\s*\([^;]*\);)'))[1];
    IF call IS NULL THEN RAISE EXCEPTION 'impl call not found in %', r.base; END IF;
    wbody := replace(wbody, call, '-- merged body (formerly ' || r.base || '__impl)' || E'\n  ' || ibody || ';');

    EXECUTE head || marker || wbody || endtag;
  END LOOP;

  -- the only other caller of an __impl copy
  SELECT pg_get_functiondef(p.oid) INTO STRICT w
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'confirm_transfer_group';
  EXECUTE replace(w, 'public.partial_confirm_transfer__impl(', 'public.partial_confirm_transfer(');

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%\_\_impl'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.prosrc LIKE '%\_\_impl(%' AND p.proname NOT LIKE '%\_impl') THEN
    RAISE EXCEPTION 'a function still references an __impl copy';
  END IF;
END
$merge$;

-- Unified voucher -> treasury date guard
CREATE OR REPLACE FUNCTION public.sync_treasury_date_from_voucher()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.treasury_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.treasury
     SET transaction_date = NEW.voucher_date
   WHERE id = NEW.treasury_id
     AND transaction_date IS DISTINCT FROM NEW.voucher_date;
  -- legacy compatibility: backdated manual vouchers also stamp created_at at Cairo noon
  IF TG_OP = 'INSERT' AND NEW.source = 'manual'
     AND NEW.voucher_date <> (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    UPDATE public.treasury
       SET created_at = (NEW.voucher_date + time '12:00') AT TIME ZONE 'Africa/Cairo'
     WHERE id = NEW.treasury_id;
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS trg_voucher_sync_treasury_date ON public.vouchers;
DROP FUNCTION IF EXISTS public.voucher_sync_treasury_date();

-- Strict foreign keys
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE,
  ADD CONSTRAINT payment_transactions_treasury_id_fkey FOREIGN KEY (treasury_id) REFERENCES public.treasury(id) ON DELETE SET NULL,
  ADD CONSTRAINT payment_transactions_fee_treasury_id_fkey FOREIGN KEY (fee_treasury_id) REFERENCES public.treasury(id) ON DELETE SET NULL;
ALTER TABLE public.supplier_payments
  ADD CONSTRAINT supplier_payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE,
  ADD CONSTRAINT supplier_payments_treasury_id_fkey FOREIGN KEY (treasury_id) REFERENCES public.treasury(id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE,
  ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE public.invoice_payments
  ADD CONSTRAINT invoice_payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_pt_treasury_id ON public.payment_transactions(treasury_id);
CREATE INDEX IF NOT EXISTS idx_pt_fee_treasury_id ON public.payment_transactions(fee_treasury_id);
CREATE INDEX IF NOT EXISTS idx_sp_treasury_id ON public.supplier_payments(treasury_id);
