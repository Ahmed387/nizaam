-- 0284 — fix a fixed asset that was entered wrong (owner 2026-11-25 «افرض دخلنا اصول غلط وعاوزين نعدلها … صلحها»).
--   cancel_fixed_asset(asset, reason)        owner / admin. Undoes EVERYTHING the asset wrote, each on its own day
--                                            (`app.reverse_on_original_date`): the purchase (till row reversed with
--                                            `till_cancel_on_original_date` + its entry) or the opening entry (Cr 3950
--                                            comes back — the «الفرق ده راح فين؟» card shows the difference again), every
--                                            depreciation entry, and the disposal (till row + entry) if it was sold.
--                                            The row stays as status 'cancelled' with its reason (no hard delete).
--   edit_fixed_asset(asset, ..., reason)     name / category / notes only → changed in place, nothing in the books moves.
--                                            Anything else (branch, date, cost, salvage, life, how it was paid, vessel)
--                                            = cancel + a new asset with the corrected values in ONE transaction; the
--                                            two point at each other (replaced_by / replaces). Refused on a sold asset
--                                            (undo the disposal first).
--   undo_fixed_asset_disposal(asset, reason) owner / admin. Undoes the sale / write-off only (till row + entry on its
--                                            day), the asset is active again and the missing depreciation is posted.
ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_status_check;
ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_status_check CHECK (status = ANY (ARRAY['active', 'disposed', 'cancelled']));
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES public.fixed_assets(id),
  ADD COLUMN IF NOT EXISTS replaces uuid REFERENCES public.fixed_assets(id);

-- internal: reverse the disposal of one asset (till row + entry, on their day)
CREATE OR REPLACE FUNCTION public.fa_reverse_disposal(p_asset uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a fixed_assets%ROWTYPE; j journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO a FROM fixed_assets WHERE id = p_asset;
  IF a.disposal_journal_entry_id IS NULL THEN RETURN; END IF;
  SELECT * INTO j FROM journal_entries WHERE id = a.disposal_journal_entry_id;
  PERFORM set_config('app.reverse_on_original_date', '1', true);
  IF j.source_type = 'treasury_row' THEN
    PERFORM public.till_cancel_on_original_date(j.source_id, p_reason);
  END IF;
  PERFORM public.reverse_journal_for_source(a.tenant_id, j.source_type, j.source_id, p_reason);
  PERFORM set_config('app.reverse_on_original_date', '0', true);
END $function$;
REVOKE ALL ON FUNCTION public.fa_reverse_disposal(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_fixed_asset(p_asset uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; a fixed_assets%ROWTYPE; v_why text := NULLIF(btrim(p_reason), ''); v_dep numeric;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'إلغاء الأصول للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF v_why IS NULL THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  SELECT * INTO a FROM fixed_assets WHERE id = p_asset AND tenant_id = v_t FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الأصل مش موجود'; END IF;
  IF a.status = 'cancelled' THEN RAISE EXCEPTION 'الأصل ده متلغي قبل كده'; END IF;
  v_why := 'إلغاء أصل ' || a.code || ': ' || v_why;

  IF a.status = 'disposed' THEN PERFORM public.fa_reverse_disposal(a.id, v_why); END IF;

  PERFORM set_config('app.reverse_on_original_date', '1', true);
  SELECT COALESCE(sum(amount), 0) INTO v_dep FROM depreciation_entries WHERE asset_id = a.id;
  PERFORM public.reverse_journal_for_source(v_t, 'depreciation', a.id, v_why);
  IF a.funding = 'paid' AND a.treasury_id IS NOT NULL THEN
    PERFORM public.till_cancel_on_original_date(a.treasury_id, v_why);
    PERFORM public.reverse_journal_for_source(v_t, 'treasury_row', a.treasury_id, v_why);
  ELSE
    PERFORM public.reverse_journal_for_source(v_t, 'fixed_asset_opening', a.id, v_why);
  END IF;
  PERFORM set_config('app.reverse_on_original_date', '0', true);

  UPDATE fixed_assets SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = btrim(p_reason) WHERE id = a.id;
  RETURN jsonb_build_object('id', a.id, 'code', a.code, 'cost', a.cost, 'depreciation_reversed', v_dep,
                            'funding', a.funding, 'was_disposed', a.status = 'disposed');
END $function$;

CREATE OR REPLACE FUNCTION public.undo_fixed_asset_disposal(p_asset uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; a fixed_assets%ROWTYPE; r jsonb;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'اكتب السبب'; END IF;
  SELECT * INTO a FROM fixed_assets WHERE id = p_asset AND tenant_id = v_t FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الأصل مش موجود'; END IF;
  IF a.status <> 'disposed' THEN RAISE EXCEPTION 'الأصل ده مش متباع / متشال'; END IF;
  PERFORM public.fa_reverse_disposal(a.id, 'إلغاء التخلص من ' || a.code || ': ' || btrim(p_reason));
  UPDATE fixed_assets SET status = 'active', disposal_date = NULL, disposal_amount = NULL, disposal_journal_entry_id = NULL,
         notes = concat_ws(' — ', notes, 'اتلغى التخلص: ' || btrim(p_reason)) WHERE id = a.id;
  r := public.depreciation_catch_up(v_t);
  RETURN jsonb_build_object('id', a.id, 'depreciation', r);
END $function$;

CREATE OR REPLACE FUNCTION public.edit_fixed_asset(p_asset uuid, p_name text, p_category text, p_branch uuid, p_date date,
  p_cost numeric, p_salvage numeric, p_life_months int, p_funding text, p_method text, p_notes text, p_account text, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; a fixed_assets%ROWTYPE; v_new jsonb; v_money boolean; v_pm text := COALESCE(NULLIF(p_method, ''), 'cash');
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'تعديل الأصول للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM fixed_assets WHERE id = p_asset AND tenant_id = v_t FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الأصل مش موجود'; END IF;
  IF a.status = 'cancelled' THEN RAISE EXCEPTION 'الأصل ده متلغي'; END IF;
  IF a.status = 'disposed' THEN RAISE EXCEPTION 'الأصل ده اتباع / اتشال — الغي التخلص الأول وبعدين عدّل'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'اكتب اسم الأصل'; END IF;

  v_money := p_branch IS DISTINCT FROM a.branch_id OR p_date IS DISTINCT FROM a.acquisition_date
          OR round(COALESCE(p_cost, 0), 2) <> a.cost OR round(COALESCE(p_salvage, 0), 2) <> COALESCE(a.salvage_value, 0)
          OR p_life_months IS DISTINCT FROM a.useful_life_months OR p_funding IS DISTINCT FROM a.funding
          OR (p_funding = 'paid' AND v_pm IS DISTINCT FROM a.payment_method)
          OR (p_funding = 'paid' AND NULLIF(btrim(p_account), '') IS NOT NULL);

  IF NOT v_money THEN
    UPDATE fixed_assets SET name = btrim(p_name), category = NULLIF(btrim(p_category), ''), notes = NULLIF(btrim(p_notes), '')
     WHERE id = a.id;
    RETURN jsonb_build_object('id', a.id, 'code', a.code, 'mode', 'text');
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'اكتب سبب التعديل'; END IF;
  PERFORM public.cancel_fixed_asset(a.id, 'تعديل: ' || btrim(p_reason));
  v_new := public.add_fixed_asset(p_name, p_category, p_branch, p_date, p_cost, p_salvage, p_life_months, p_funding, v_pm,
             concat_ws(' — ', NULLIF(btrim(p_notes), ''), 'بدل ' || a.code), p_account);
  UPDATE fixed_assets SET replaced_by = (v_new->>'id')::uuid WHERE id = a.id;
  UPDATE fixed_assets SET replaces = a.id WHERE id = (v_new->>'id')::uuid;
  RETURN v_new || jsonb_build_object('mode', 'replace', 'old_code', a.code);
END $function$;

REVOKE ALL ON FUNCTION public.cancel_fixed_asset(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_fixed_asset_disposal(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_fixed_asset(uuid, text, text, uuid, date, numeric, numeric, int, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_fixed_asset(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_fixed_asset_disposal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_fixed_asset(uuid, text, text, uuid, date, numeric, numeric, int, text, text, text, text, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('cancel_fixed_asset', '0284', 'owner / admin: undo an asset on its own days'),
  ('undo_fixed_asset_disposal', '0284', 'owner / admin: undo a sale / write-off'),
  ('edit_fixed_asset', '0284', 'owner / admin: text in place, else cancel + new')
ON CONFLICT DO NOTHING;
