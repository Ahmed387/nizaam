-- 0144 checks — rollback-only. Tag «معرض سكة تلة (حساب خاص)»-like accounts: pick the customer with the biggest October
-- sales in عبدالمنعم and tag it as branch سكة; the card's «منها بين الفروع» = its October sales (without VAT); a cashier
-- cannot tag; untag works; documents untouched.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; v_mgr uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde';
  v_s uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; v_c uuid; v_want numeric; v_snap jsonb; v_pos jsonb; v_mgr_err text; v_inv_before text; v_inv_after text;
BEGIN
  SELECT i.contact_id, round(sum(i.total - coalesce(i.vat_amount, 0)), 2) INTO v_c, v_want FROM public.invoices i
   WHERE i.branch_id = '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213' AND i.status = 'active' AND i.contact_id IS NOT NULL
     AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN '2026-10-01' AND '2026-10-31'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 1;
  SELECT md5(string_agg(id::text || total::text || status::text, ',' ORDER BY id)) INTO v_inv_before FROM public.invoices WHERE contact_id = v_c;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.set_contact_internal_branch(v_c, v_s); v_mgr_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_mgr_err := SQLERRM; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM public.set_contact_internal_branch(v_c, v_s);
  v_snap := public.owner_business_snapshot('2026-10-01', '2026-10-31');
  v_pos := public.ledger_position(NULL);
  SELECT md5(string_agg(id::text || total::text || status::text, ',' ORDER BY id)) INTO v_inv_after FROM public.invoices WHERE contact_id = v_c;
  PERFORM public.set_contact_internal_branch(v_c, NULL);
  RAISE EXCEPTION '0144 CHECKS %', jsonb_build_object(
    'K1_internal_sales_equals_want', (v_snap->'total'->>'internal_sales')::numeric = v_want, 'want', v_want,
    'K2_manager_refused', v_mgr_err, 'K3_position_has_internal', v_pos->'customers' ? 'internal_open',
    'K4_documents_untouched', v_inv_before = v_inv_after,
    'K5_untagged', (SELECT internal_branch_id IS NULL FROM public.contacts WHERE id = v_c));
END
$t$;
