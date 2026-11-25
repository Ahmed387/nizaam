-- 0281 Who sees / uses each money vessel (owner 2026-11-25 «عاوز اتحكم في الاوعية تظهر لمين وتختفي لمين … أ وب يكونوا موجودين
-- وانا اللي اختار»): per person, per vessel and — when the vessel has several accounts (numbers) — per account, one of
--   'use'    يشوف ويستخدم (default for everybody, always for the company owner)
--   'view'   يشوف بس مايدفعش — sees its balance and movements, cannot receive / pay with it
--   'hidden' مخفي خالص — not in the payment choices, not in the till: its rows are not read at all
-- An account's own rule wins over its vessel's rule. Example: محمد طه — cash 'use', instapay 'view', vodafone 'hidden' but
-- the branch number 010… 'use' → he pays with cash or that number, sees instapay, and never sees the owner's number 012….
-- Enforced on the server: a new till row in a vessel / account the user may not USE is refused (reversals of an existing
-- movement are not new money and pass); till rows of a HIDDEN vessel / account are not readable by him (RLS).

CREATE TABLE IF NOT EXISTS public.vessel_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  method text NOT NULL,
  account_id uuid REFERENCES public.vessel_accounts(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('hidden', 'view', 'use')),
  set_by uuid, set_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vessel_access_one ON public.vessel_access (tenant_id, user_id, method, account_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS vessel_access_user ON public.vessel_access (user_id);
ALTER TABLE public.vessel_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vessel_access_read ON public.vessel_access;
CREATE POLICY vessel_access_read ON public.vessel_access FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_owner(auth.uid()))));
REVOKE INSERT, UPDATE, DELETE ON public.vessel_access FROM anon, authenticated;
GRANT SELECT ON public.vessel_access TO authenticated;

-- the level of one user for one vessel / account (owner and super admin: always 'use')
CREATE OR REPLACE FUNCTION public.vessel_level(p_user uuid, p_method text, p_account uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_user IS NULL OR public.is_owner(p_user) OR public.is_super_admin(p_user) THEN 'use'
    ELSE coalesce(
      (SELECT level FROM public.vessel_access WHERE user_id = p_user AND method = p_method AND p_account IS NOT NULL AND account_id = p_account LIMIT 1),
      (SELECT level FROM public.vessel_access WHERE user_id = p_user AND method = p_method AND account_id IS NULL LIMIT 1),
      'use') END;
$$;
REVOKE ALL ON FUNCTION public.vessel_level(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- what the signed-in user may not read (evaluated ONCE per query by the policy: `(SELECT …)`)
CREATE OR REPLACE FUNCTION public.my_hidden_methods() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(method), '{}') FROM public.vessel_access
   WHERE user_id = auth.uid() AND account_id IS NULL AND level = 'hidden' AND NOT public.is_owner(auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.my_hidden_accounts() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(account_id), '{}') FROM public.vessel_access
   WHERE user_id = auth.uid() AND account_id IS NOT NULL AND level = 'hidden' AND NOT public.is_owner(auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.my_open_accounts() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(account_id), '{}') FROM public.vessel_access
   WHERE user_id = auth.uid() AND account_id IS NOT NULL AND level <> 'hidden';
$$;
REVOKE ALL ON FUNCTION public.my_hidden_methods(), public.my_hidden_accounts(), public.my_open_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_hidden_methods(), public.my_hidden_accounts(), public.my_open_accounts() TO authenticated;

DROP POLICY IF EXISTS hidden_vessel_rows ON public.treasury;
CREATE POLICY hidden_vessel_rows ON public.treasury AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (
    coalesce(vessel_account_id = ANY ((SELECT public.my_hidden_accounts())::uuid[]), false)
    OR (payment_method = ANY ((SELECT public.my_hidden_methods())::text[])
        AND NOT coalesce(vessel_account_id = ANY ((SELECT public.my_open_accounts())::uuid[]), false))
  ));

-- new money only through a vessel / account the user may USE
CREATE OR REPLACE FUNCTION public.a0_guard_vessel_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_level text;
BEGIN
  IF auth.uid() IS NULL OR public.sahl_import_mode() THEN RETURN NEW; END IF;
  -- a reversal / cancellation of an existing movement is not new money
  IF NEW.category IN ('إلغاء سند', 'return_cancel', 'purchase_return_cancel', 'sales_refund', 'payment_edit_reversal', 'payment_in_void',
                      'payment_out_void', 'fee_void', 'تصحيح قيد عكسي', 'partner_cancel', 'vessel_transfer_cancel', 'transfer_back')
     OR NEW.category ILIKE '%cancel%' OR NEW.category ILIKE '%reversal%' OR NEW.category ILIKE '%void%' THEN
    RETURN NEW;
  END IF;
  v_level := public.vessel_level(auth.uid(), coalesce(NEW.payment_method, 'cash'), NEW.vessel_account_id);
  IF v_level <> 'use' THEN
    RAISE EXCEPTION 'الوعاء ده مش متاح ليك تستلم أو تدفع بيه (%) — اسأل صاحب الشركة', coalesce(NEW.payment_method, 'cash') USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a0_guard_vessel_access ON public.treasury;
CREATE TRIGGER a0_guard_vessel_access BEFORE INSERT ON public.treasury FOR EACH ROW EXECUTE FUNCTION public.a0_guard_vessel_access();

-- the owner sets one person's rules in one go (replaces them all); a rule equal to 'use' on a vessel is not stored
CREATE OR REPLACE FUNCTION public.set_vessel_access(p_user uuid, p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); r jsonb; n int := 0; v_acc uuid;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'لصاحب الشركة بس' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND tenant_id = v_t) THEN RAISE EXCEPTION 'الشخص مش في الشركة'; END IF;
  IF public.is_owner(p_user) THEN RAISE EXCEPTION 'صاحب الشركة بيشوف كل الأوعية دايماً'; END IF;
  IF jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'بيانات غلط'; END IF;
  DELETE FROM public.vessel_access WHERE tenant_id = v_t AND user_id = p_user;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) LOOP
    IF coalesce(r->>'level', '') NOT IN ('hidden', 'view', 'use') THEN RAISE EXCEPTION 'اختيار غلط: %', r->>'level'; END IF;
    IF coalesce(btrim(r->>'method'), '') = '' THEN RAISE EXCEPTION 'الوعاء ناقص'; END IF;
    v_acc := nullif(r->>'account_id', '')::uuid;
    IF v_acc IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vessel_accounts WHERE id = v_acc AND tenant_id = v_t AND payment_method = r->>'method') THEN
      RAISE EXCEPTION 'الحساب ده مش في الوعاء ده';
    END IF;
    CONTINUE WHEN v_acc IS NULL AND r->>'level' = 'use';
    INSERT INTO public.vessel_access (tenant_id, user_id, method, account_id, level, set_by)
    VALUES (v_t, p_user, r->>'method', v_acc, r->>'level', auth.uid())
    ON CONFLICT (tenant_id, user_id, method, account_id) DO UPDATE SET level = EXCLUDED.level, set_by = EXCLUDED.set_by, set_at = now();
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.set_vessel_access(uuid, jsonb) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('set_vessel_access', '0281', 'vessels per person: hidden / view / use, per vessel and per account (owner only)'),
  ('my_hidden_methods', '0281', 'vessel visibility of the signed-in user (RLS helper)'),
  ('my_hidden_accounts', '0281', 'vessel visibility of the signed-in user (RLS helper)'),
  ('my_open_accounts', '0281', 'vessel visibility of the signed-in user (RLS helper)')
ON CONFLICT (function_name) DO NOTHING;
