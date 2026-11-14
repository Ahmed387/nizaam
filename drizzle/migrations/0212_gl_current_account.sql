-- 0212 — the books as a CURRENT ACCOUNT (owner «نفذ» 2026-11-14): customer / supplier money goes straight to the
-- account (1200 customers / 2100 suppliers); nothing passes through the pools 2150 «مقدمات عملاء» / 1460 «مقدمات
-- موردين» and no allocation entry is posted any more (allocations stay in the subledger only — no GL effect).
--   customer receipt      Dr cash / Cr 1200          (was Cr 2150, then Dr 2150 / Cr 1200 per allocation)
--   supplier payment      Dr 2100 / Cr cash          (was Dr 1460, then Dr 2100 / Cr 1460 per allocation)
--   return «على حسابه»    nothing more: the return's own entry already credits 1200 / debits 2100
--   walk-in refund        Dr 1200 / Cr cash
--   archive cancel credit Cr 1200, contacts opening advances Cr 1200 / Dr 2100
-- History: every posted link whose entry touches 2150 / 1460 (and every allocation link) is reversed on its own day
-- (`gl_ca_repost`, per contact / walk-in invoice, run in steps by pg_cron job «gl-ca-run») and the movement is posted
-- again with the new lines; the contacts' opening advances get ONE reclass entry per branch on the opening day.
-- Balances of accounts, tills and profit do not change; 2150 and 1460 end at 0 and are switched off in the chart.

-- 1) ledger_gl_sync: new movement lines, no allocation entries
DO $mig$
DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.ledger_gl_sync'::regproc); o := d;
  d := replace(d, $s$jsonb_build_object('account_code', '2150', 'debit', 0, 'credit', m.amount, 'description', 'فلوس العميل لحين خصمها من فواتيره'))$s$,
                  $s$jsonb_build_object('account_code', '1200', 'debit', 0, 'credit', m.amount, 'description', v_desc))$s$);
  IF d = o THEN RAISE EXCEPTION '0212: customer payment line not found'; END IF; o := d;
  d := replace(d, $s$
      WHEN m.side = 'customer' AND m.kind = 'return_credit' THEN jsonb_build_array(
             jsonb_build_object('account_code', '1200', 'debit', m.amount, 'credit', 0, 'description', v_desc),
             jsonb_build_object('account_code', '2150', 'debit', 0, 'credit', m.amount, 'description', 'رصيد مرتجع لحين خصمه'))$s$, '');
  IF d = o THEN RAISE EXCEPTION '0212: customer return_credit block not found'; END IF; o := d;
  d := replace(d, $s$jsonb_build_object('account_code', '1460', 'debit', m.amount, 'credit', 0, 'description', 'فلوس للمورد لحين خصمها من فواتيره'),$s$,
                  $s$jsonb_build_object('account_code', '2100', 'debit', m.amount, 'credit', 0, 'description', v_desc),$s$);
  IF d = o THEN RAISE EXCEPTION '0212: supplier payment line not found'; END IF; o := d;
  d := replace(d, $s$
      WHEN m.side = 'supplier' AND m.kind = 'return_credit' THEN jsonb_build_array(
             jsonb_build_object('account_code', '1460', 'debit', m.amount, 'credit', 0, 'description', 'رصيد مرتجع لحين خصمه'),
             jsonb_build_object('account_code', '2100', 'debit', 0, 'credit', m.amount, 'description', v_desc))$s$, '');
  IF d = o THEN RAISE EXCEPTION '0212: supplier return_credit block not found'; END IF; o := d;
  d := replace(d, $s$    END;
    v_j := public.ledger_gl_post(p_tenant, m.branch_id,$s$, $s$    END;
    IF v_lines IS NULL THEN CONTINUE; END IF;
    v_j := public.ledger_gl_post(p_tenant, m.branch_id,$s$);
  IF d = o THEN RAISE EXCEPTION '0212: post anchor not found'; END IF; o := d;
  d := replace(d, $s$     WHERE pa.tenant_id = p_tenant AND pa.status = 'active'$s$,
                  $s$     WHERE pa.tenant_id = p_tenant AND pa.status = 'active' AND false$s$);
  IF d = o THEN RAISE EXCEPTION '0212: allocation loop not found'; END IF; o := d;
  d := replace(d, $s$jsonb_build_object('account_code', '2150', 'debit', i.refund_amount$s$, $s$jsonb_build_object('account_code', '1200', 'debit', i.refund_amount$s$);
  IF d = o THEN RAISE EXCEPTION '0212: walk-in refund line not found'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.ledger_archive_cancel_lines'::regproc); o := d;
  d := replace(d, $s$(3, '2150', 0::numeric, GREATEST(p.j, 0)$s$, $s$(3, '1200', 0::numeric, GREATEST(p.j, 0)$s$);
  IF d = o THEN RAISE EXCEPTION '0212: archive cancel line not found'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.post_contacts_opening_entries'::regproc); o := d;
  d := replace(d, $s$'account_code','1460','debit',r.s_adv$s$, $s$'account_code','2100','debit',r.s_adv$s$);
  d := replace(d, $s$'account_code','2150','debit',0,'credit',r.c_adv$s$, $s$'account_code','1200','debit',0,'credit',r.c_adv$s$);
  IF (length(o) - length(replace(o, '''2150''', ''))) = 0 OR d = o THEN RAISE EXCEPTION '0212: opening lines not found'; END IF;
  EXECUTE d;
END
$mig$;

-- 2) one contact (or one walk-in invoice): reverse its pool / allocation entries on their day, post the new lines
CREATE OR REPLACE FUNCTION public.gl_ca_repost(p_tenant uuid, p_contact uuid, p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE k record; v uuid; n int := 0; r jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger_gl:' || COALESCE(p_contact::text, 'inv:' || p_invoice::text), 0));
  FOR k IN
    SELECT l.* FROM ledger_gl_links l
     WHERE l.tenant_id = p_tenant AND l.status = 'posted'
       AND (
         (l.ref_type = 'allocation' AND EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.id = l.ref_id
             AND ((p_contact IS NOT NULL AND pa.contact_id = p_contact)
                  OR (p_contact IS NULL AND pa.contact_id IS NULL AND pa.debt_id = p_invoice))))
         OR (l.ref_type IN ('movement', 'walkin_refund', 'archive_cancel')
             AND (EXISTS (SELECT 1 FROM money_movements mm WHERE mm.id = l.ref_id
                    AND ((p_contact IS NOT NULL AND mm.contact_id = p_contact)
                         OR (p_contact IS NULL AND mm.contact_id IS NULL AND mm.target_doc_id = p_invoice)))
                  OR (l.ref_type <> 'movement' AND l.ref_id = p_invoice)
                  OR (l.ref_type = 'archive_cancel' AND EXISTS (SELECT 1 FROM invoices x WHERE x.id = l.ref_id AND x.contact_id = p_contact)))
             AND EXISTS (SELECT 1 FROM journal_entry_lines jl JOIN chart_of_accounts a ON a.id = jl.account_id
                          WHERE jl.entry_id = l.journal_id AND a.code IN ('2150', '1460'))))
     ORDER BY l.created_at, l.id
  LOOP
    v := public.ledger_gl_reverse(k.journal_id, 'حساب جاري: الفلوس مباشرة على الحساب');
    UPDATE ledger_gl_links SET status = 'reversed', reversal_journal_id = v, reversed_at = now() WHERE id = k.id;
    n := n + 1;
  END LOOP;
  r := public.ledger_gl_sync(p_tenant, p_contact, p_invoice);
  RETURN jsonb_build_object('reversed', n, 'sync', r);
END
$function$;
REVOKE ALL ON FUNCTION public.gl_ca_repost(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 3) work queue + step for pg_cron
CREATE TABLE IF NOT EXISTS public.gl_ca_queue (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, contact_id uuid, invoice_id uuid,
  done_at timestamptz, result jsonb, error text);
ALTER TABLE public.gl_ca_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gl_ca_queue FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.gl_ca_step(p_n int)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q record; r jsonb; done int := 0;
BEGIN
  FOR q IN SELECT * FROM gl_ca_queue WHERE done_at IS NULL AND error IS NULL ORDER BY id LIMIT p_n FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      r := public.gl_ca_repost(q.tenant_id, q.contact_id, q.invoice_id);
      UPDATE gl_ca_queue SET done_at = now(), result = r WHERE id = q.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE gl_ca_queue SET error = SQLERRM WHERE id = q.id;
    END;
    done := done + 1;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM gl_ca_queue WHERE done_at IS NULL AND error IS NULL) THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gl-ca-run';
  END IF;
  RETURN jsonb_build_object('done', done, 'left', (SELECT count(*) FROM gl_ca_queue WHERE done_at IS NULL AND error IS NULL));
END
$function$;
REVOKE ALL ON FUNCTION public.gl_ca_step(int) FROM PUBLIC, anon, authenticated;

-- 4) the contacts' opening advances: ONE reclass entry per branch on the opening day (2150 → 1200, 1460 → 2100)
CREATE OR REPLACE FUNCTION public.gl_ca_opening_reclass(p_tenant uuid)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_lines jsonb; v uuid; n int := 0;
BEGIN
  FOR r IN
    SELECT je.branch_id, min(je.entry_date) AS d,
           round(sum(CASE WHEN a.code = '2150' THEN jl.credit - jl.debit ELSE 0 END), 2) AS c_adv,
           round(sum(CASE WHEN a.code = '1460' THEN jl.debit - jl.credit ELSE 0 END), 2) AS s_adv
      FROM journal_entries je JOIN journal_entry_lines jl ON jl.entry_id = je.id JOIN chart_of_accounts a ON a.id = jl.account_id
     WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND a.code IN ('2150', '1460')
       AND je.source_type IN ('opening_balance', 'opening_balance_reversal')
     GROUP BY je.branch_id
  LOOP
    v_lines := '[]'::jsonb;
    IF r.c_adv <> 0 THEN v_lines := v_lines
      || jsonb_build_object('account_code', '2150', 'debit', GREATEST(r.c_adv, 0), 'credit', GREATEST(-r.c_adv, 0), 'description', 'مقدمات العملاء الافتتاحية على حساباتهم')
      || jsonb_build_object('account_code', '1200', 'debit', GREATEST(-r.c_adv, 0), 'credit', GREATEST(r.c_adv, 0), 'description', 'مقدمات العملاء الافتتاحية على حساباتهم'); END IF;
    IF r.s_adv <> 0 THEN v_lines := v_lines
      || jsonb_build_object('account_code', '2100', 'debit', GREATEST(r.s_adv, 0), 'credit', GREATEST(-r.s_adv, 0), 'description', 'مقدمات الموردين الافتتاحية على حساباتهم')
      || jsonb_build_object('account_code', '1460', 'debit', GREATEST(-r.s_adv, 0), 'credit', GREATEST(r.s_adv, 0), 'description', 'مقدمات الموردين الافتتاحية على حساباتهم'); END IF;
    IF jsonb_array_length(v_lines) = 0 THEN CONTINUE; END IF;
    v := public.ledger_gl_post(p_tenant, r.branch_id, r.d, 'حساب جاري — أرصدة افتتاحية على الحسابات مباشرة',
                               'opening_ca_reclass', COALESCE(r.branch_id, p_tenant), v_lines);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION public.gl_ca_opening_reclass(uuid) FROM PUBLIC, anon, authenticated;

-- 5) queue every account and walk-in invoice that has ledger money, then run in steps of 20 every minute
INSERT INTO public.gl_ca_queue (tenant_id, contact_id, invoice_id)
SELECT DISTINCT x.tenant_id, x.contact_id, x.invoice_id FROM (
  SELECT tenant_id, contact_id, NULL::uuid AS invoice_id FROM public.money_movements WHERE contact_id IS NOT NULL
  UNION SELECT tenant_id, contact_id, NULL FROM public.payment_allocations WHERE contact_id IS NOT NULL
  UNION SELECT tenant_id, NULL, target_doc_id FROM public.money_movements WHERE contact_id IS NULL AND target_doc_type = 'invoice'
  UNION SELECT tenant_id, NULL, debt_id FROM public.payment_allocations WHERE contact_id IS NULL AND debt_type = 'invoice'
) x
WHERE NOT EXISTS (SELECT 1 FROM public.gl_ca_queue q);
SELECT public.gl_ca_opening_reclass(t.id) FROM public.tenants t;
SELECT cron.schedule('gl-ca-run', '* * * * *', $$SELECT public.gl_ca_step(20)$$);
