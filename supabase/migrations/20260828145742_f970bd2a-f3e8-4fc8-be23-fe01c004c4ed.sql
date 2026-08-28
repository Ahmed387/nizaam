REVOKE ALL ON FUNCTION public.post_journal_lines(uuid,date,text,text,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_account(uuid,text,text,account_type) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_fixed_asset_journal() FROM PUBLIC, anon, authenticated;