-- 0216 — the hidden allocation engine is OFF (owner «الغي التوزيع شغال من ورا الشاشة … نفذ» 2026-11-14).
-- `ledger_allocate` keeps only: (1) DIRECT — money paid on its own document (with the invoice, or later from the
-- invoice itself) and a return on its own invoice; (2) EXPLICIT — the old recorded «من تحت حسابه» uses. The FIFO step
-- (a general receipt / payment quietly closing the oldest open documents) is gone, so a general voucher only lowers
-- the account's balance. Balances do not change (balance = documents − money, per branch); only «المدفوع» of a
-- document = the money paid ON it. The books are not touched (allocations post nothing since 0212).
-- History: every account and walk-in invoice is allocated again from the queue `gl_ca_queue` reused as
-- `alloc_queue` (pg_cron «alloc-run», removes itself when empty).
DO $mig$
DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.ledger_allocate'::regproc); o := d;
  d := replace(d, $s$    FOR m IN SELECT * FROM _la_cred WHERE rem > 0.005 ORDER BY md, ts, movement_id LOOP
      FOR d IN SELECT * FROM _la_debt db$s$, $s$    FOR m IN SELECT * FROM _la_cred WHERE rem > 0.005 AND false ORDER BY md, ts, movement_id LOOP
      FOR d IN SELECT * FROM _la_debt db$s$);
  IF d = o THEN RAISE EXCEPTION '0216: FIFO loop not found'; END IF;
  EXECUTE d;
END
$mig$;

CREATE TABLE IF NOT EXISTS public.alloc_queue (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, contact_id uuid, side text, invoice_id uuid,
  done_at timestamptz, result jsonb, error text);
ALTER TABLE public.alloc_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alloc_queue FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.alloc_step(p_n int)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q record; r jsonb; done int := 0;
BEGIN
  FOR q IN SELECT * FROM alloc_queue WHERE done_at IS NULL AND error IS NULL ORDER BY id LIMIT p_n FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('ledger_gl:' || COALESCE(q.contact_id::text, 'inv:' || q.invoice_id::text), 0));
      r := public.ledger_allocate(q.tenant_id, q.contact_id, COALESCE(q.side, 'customer'), q.invoice_id);
      UPDATE alloc_queue SET done_at = now(), result = r WHERE id = q.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE alloc_queue SET error = SQLERRM WHERE id = q.id;
    END;
    done := done + 1;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM alloc_queue WHERE done_at IS NULL AND error IS NULL) THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'alloc-run';
  END IF;
  RETURN jsonb_build_object('done', done, 'left', (SELECT count(*) FROM alloc_queue WHERE done_at IS NULL AND error IS NULL));
END
$function$;
REVOKE ALL ON FUNCTION public.alloc_step(int) FROM PUBLIC, anon, authenticated;

INSERT INTO public.alloc_queue (tenant_id, contact_id, side, invoice_id)
SELECT DISTINCT x.tenant_id, x.contact_id, x.side, x.invoice_id FROM (
  SELECT tenant_id, contact_id, side, NULL::uuid AS invoice_id FROM public.payment_allocations WHERE status = 'active' AND contact_id IS NOT NULL AND mode = 'fifo'
  UNION SELECT tenant_id, NULL, 'customer', debt_id FROM public.payment_allocations WHERE status = 'active' AND contact_id IS NULL AND mode = 'fifo'
) x
WHERE NOT EXISTS (SELECT 1 FROM public.alloc_queue q);
SELECT cron.schedule('alloc-run', '* * * * *', $$SELECT public.alloc_step(60)$$);
