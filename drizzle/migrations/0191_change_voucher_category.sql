-- 0191: owner 2026-11-11 «نخلي السند ينفع نغير تصنيفه حتى بعد ما طلع … نفذ». `change_voucher_category(voucher, category, reason)`
-- — owner only. Allowed for an ACTIVE manual income / expense voucher (no customer / supplier on it, not contact money, not a
-- system voucher) to another active category of the same type that is income / expense too. The voucher keeps its number,
-- date, amount and till; its category changes and, when the two categories sit on different accounts, ONE reclassification
-- entry is posted on the VOUCHER'S date (a voucher has one journal entry by a unique key, so it is never re-posted):
--   receipt: Dr old account / Cr new account        payment: Dr new account / Cr old account
-- (account of a category = its gl_account_code, else 4200 for receipts / 5500 for payments — same rule as post_voucher_journal).
-- Every change is a row of `voucher_category_changes`; cancelling the voucher later reverses its reclassification entries too.
-- Effects: tills and contact balances never move; profit moves in the month of the voucher when the two accounts differ in
-- kind (4200 ⇄ 3800); a closed period refuses it (the vouchers' closed-period guard).
CREATE TABLE IF NOT EXISTS public.voucher_category_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  voucher_id uuid NOT NULL REFERENCES public.vouchers(id),
  old_category_id uuid, new_category_id uuid NOT NULL,
  old_account text NOT NULL, new_account text NOT NULL,
  amount numeric NOT NULL, reason text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.voucher_category_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voucher_category_changes FROM anon, authenticated;
GRANT SELECT ON public.voucher_category_changes TO authenticated;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'voucher_category_changes' AND policyname = 'vcc_read') THEN
    CREATE POLICY vcc_read ON public.voucher_category_changes FOR SELECT USING (
      (SELECT public.is_super_admin((SELECT auth.uid())))
      OR (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid()))))));
  END IF;
END $p$;

CREATE OR REPLACE FUNCTION public.change_voucher_category(p_voucher uuid, p_category uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v public.vouchers%ROWTYPE; oc public.voucher_categories%ROWTYPE; nc public.voucher_categories%ROWTYPE;
  v_old text; v_new text; v_id uuid := gen_random_uuid(); v_fc text; v_party text[] := ARRAY['1100','1200','1460','2100','2150','1910','1950'];
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'تغيير تصنيف السند للمالك بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'السند مش موجود'; END IF;
  IF v.status <> 'active' THEN RAISE EXCEPTION 'السند ملغي'; END IF;
  IF v.source = 'system' OR v.party_id IS NOT NULL OR public.ledger_voucher_is_contact_money(v.id)
     OR coalesce(v.flow_class, '') NOT IN ('other_income', 'operating') THEN
    RAISE EXCEPTION 'السند ده مربوط بعميل أو مورد أو بحركة نظام — تصنيفه مينفعش يتغير. التغيير لسندات الإيراد والمصروف بس.';
  END IF;
  SELECT * INTO oc FROM public.voucher_categories WHERE id = v.category_id;
  SELECT * INTO nc FROM public.voucher_categories WHERE id = p_category AND tenant_id = v.tenant_id AND is_active;
  IF nc.id IS NULL THEN RAISE EXCEPTION 'التصنيف الجديد مش موجود'; END IF;
  IF nc.type <> v.type THEN RAISE EXCEPTION 'التصنيف الجديد لازم يكون من نفس نوع السند'; END IF;
  IF nc.id = v.category_id THEN RAISE EXCEPTION 'ده نفس التصنيف الحالي'; END IF;
  v_old := coalesce(oc.gl_account_code, CASE WHEN v.type = 'receipt' THEN '4200' ELSE '5500' END);
  v_new := coalesce(nc.gl_account_code, CASE WHEN v.type = 'receipt' THEN '4200' ELSE '5500' END);
  IF v_new = ANY (v_party) OR v_old = ANY (v_party) THEN
    RAISE EXCEPTION 'تصنيفات العملاء والموردين والتحويلات مش داخلة في تغيير التصنيف';
  END IF;
  v_fc := public.voucher_flow_class_of(v.type::text, v.party_type::text, v.source_type, nc.id, v.treasury_id);
  IF v_fc NOT IN ('other_income', 'operating') THEN RAISE EXCEPTION 'التصنيف الجديد مش تصنيف إيراد أو مصروف'; END IF;

  UPDATE public.vouchers SET category_id = nc.id, flow_class = v_fc WHERE id = v.id;
  INSERT INTO public.voucher_category_changes (id, tenant_id, voucher_id, old_category_id, new_category_id, old_account, new_account, amount, reason, created_by)
  VALUES (v_id, v.tenant_id, v.id, oc.id, nc.id, v_old, v_new, v.amount, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
  IF v_old <> v_new AND EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.source_type = 'voucher' AND e.source_id = v.id AND e.status = 'posted') THEN
    PERFORM public.post_journal(v.tenant_id, v.voucher_date,
      'تغيير تصنيف سند ' || v.voucher_number || ': ' || coalesce(oc.name, '—') || ' ← ' || nc.name, 'voucher_reclass', v_id,
      CASE WHEN v.type = 'receipt' THEN jsonb_build_array(
             jsonb_build_object('account_code', v_old, 'debit', v.amount, 'credit', 0, 'description', 'تغيير تصنيف ' || v.voucher_number),
             jsonb_build_object('account_code', v_new, 'debit', 0, 'credit', v.amount, 'description', 'تغيير تصنيف ' || v.voucher_number))
           ELSE jsonb_build_array(
             jsonb_build_object('account_code', v_new, 'debit', v.amount, 'credit', 0, 'description', 'تغيير تصنيف ' || v.voucher_number),
             jsonb_build_object('account_code', v_old, 'debit', 0, 'credit', v.amount, 'description', 'تغيير تصنيف ' || v.voucher_number)) END);
    UPDATE public.journal_entries SET branch_id = v.branch_id, created_by = auth.uid() WHERE source_type = 'voucher_reclass' AND source_id = v_id;
  END IF;
  RETURN jsonb_build_object('voucher', v.voucher_number, 'from', oc.name, 'to', nc.name, 'old_account', v_old, 'new_account', v_new,
                            'entry', v_old <> v_new, 'amount', v.amount);
END
$fn$;
REVOKE ALL ON FUNCTION public.change_voucher_category(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_voucher_category(uuid, uuid, text) TO authenticated;

-- cancelling a voucher takes its reclassification entries with it
CREATE OR REPLACE FUNCTION public.trg_voucher_reclass_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    FOR r IN SELECT id FROM public.voucher_category_changes WHERE voucher_id = NEW.id AND old_account <> new_account LOOP
      PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'voucher_reclass', r.id, 'Voucher ' || NEW.voucher_number || ' cancelled');
    END LOOP;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE OR REPLACE TRIGGER trg_vouchers_reclass_cancel AFTER UPDATE OF status ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.trg_voucher_reclass_cancel();
NOTIFY pgrst, 'reload schema';
