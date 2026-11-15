-- 0231 — «دمج حسابين»: the books follow the merge at once.
-- merge_contacts re-synced both ledgers but left the GL to the deferred capture, which posts the kept account's moved
-- money and does not always reverse the old account's entries (a merged voucher stayed posted twice: dry-run 2026-11-15,
-- محمود علاء → مايكل الجمل, عبدالمنعم 1100 +3,500 / 1200 −3,500). Now merge_contacts calls ledger_gl_sync for the old
-- account (reverses the entries of its cancelled movements) and for the kept one (posts the moved ones).
-- Also cleans the one old case (0185 merge «عم بدر قنا زبون»: a 1,000 payment and its 1,000 refund still posted on
-- the merged account — net 0 in the books, now reversed on both sides).

DO $m$
DECLARE d text; d0 text;
BEGIN
  d := pg_get_functiondef('public.merge_contacts(uuid,uuid,boolean,text,uuid)'::regprocedure);
  d0 := d;
  d := replace(d, $o$    PERFORM public.recompute_contact_credit(p_into);
$o$, $o$    PERFORM public.recompute_contact_credit(p_into);
    PERFORM public.ledger_gl_sync(v_t, p_from);
    PERFORM public.ledger_gl_sync(v_t, p_into);
$o$);
  IF d = d0 THEN RAISE EXCEPTION '0231: merge_contacts text not found'; END IF;
  EXECUTE d;
END
$m$;

DO $m$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT mm.tenant_id, mm.contact_id
             FROM money_movements mm
             JOIN ledger_gl_links l ON l.ref_type = 'movement' AND l.ref_id = mm.id AND l.status = 'posted'
             JOIN contacts c ON c.id = mm.contact_id AND c.merged_into IS NOT NULL
            WHERE mm.status <> 'active'
  LOOP
    PERFORM public.ledger_gl_sync(r.tenant_id, r.contact_id);
  END LOOP;
END
$m$;
