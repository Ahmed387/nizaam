-- 0209: owner 2026-11-14 «سجلهم»: the browser RPCs added by 0191–0205 were granted but not listed in the allow-list.
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('bank_wallet_balance', '0209', 'bank reconciliation by vessel (0197)'),
  ('bank_wallet_movements', '0209', 'bank reconciliation by vessel (0197)'),
  ('change_voucher_category', '0209', 'owner only (0191)'),
  ('contact_account_movements', '0209', 'contact file movements (0199)'),
  ('contacts_debit_credit', '0209', 'accounts debit / credit at two dates (0194)'),
  ('ledger_contact_statement_x', '0209', 'contact statement body (0199)'),
  ('merge_contacts', '0209', 'owner only (0185)'),
  ('purge_audit_log', '0209', 'owner only (0190)'),
  ('restore_contact', '0209', 'archive page (0202)'),
  ('set_product_pack', '0209', 'pack units (0192)')
ON CONFLICT DO NOTHING;
DO $c$ BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN
    RAISE EXCEPTION '0209: still exposed: %', (SELECT string_agg(function_signature, ', ') FROM public.security_exposed_definer_functions());
  END IF;
END $c$;
