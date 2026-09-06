-- 1) Table hardening
ALTER TABLE public.owner_expenses_access
  DROP CONSTRAINT IF EXISTS unique_owner_granted_pair;
DELETE FROM public.owner_expenses_access a
  USING public.owner_expenses_access b
  WHERE a.ctid < b.ctid AND a.owner_user_id = b.owner_user_id AND a.granted_user_id = b.granted_user_id;
ALTER TABLE public.owner_expenses_access
  ADD CONSTRAINT unique_owner_granted_pair UNIQUE (owner_user_id, granted_user_id);

DELETE FROM public.owner_expenses_access oa
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = oa.granted_user_id);

ALTER TABLE public.owner_expenses_access
  DROP CONSTRAINT IF EXISTS owner_expenses_access_granted_user_id_fkey;
ALTER TABLE public.owner_expenses_access
  ADD CONSTRAINT owner_expenses_access_granted_user_id_fkey
  FOREIGN KEY (granted_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2) Backfill existing hardcoded viewer (Hag Nasser) so access never breaks
INSERT INTO public.owner_expenses_access (owner_user_id, granted_user_id, can_view, can_edit)
SELECT o.id, g.id, true, false
FROM auth.users o
JOIN public.profiles p ON lower(p.username) = 'nasser1968ayoub@gmail.com'
JOIN auth.users g ON g.id = p.id
WHERE lower(o.email) = 'an.ayoub98@gmail.com'
ON CONFLICT (owner_user_id, granted_user_id) DO NOTHING;

-- 3) Central security functions
CREATE OR REPLACE FUNCTION public.personal_ledger_owner_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT u.id FROM auth.users u WHERE lower(u.email) = 'an.ayoub98@gmail.com' LIMIT 1),
    (SELECT t.owner_user_id FROM public.tenants t WHERE t.owner_user_id IS NOT NULL ORDER BY t.created_at LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.personal_identity()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    -- Level 1: sovereign owner immunity
    WHEN auth.uid() IS NULL THEN 'none'
    WHEN auth.uid() = public.personal_ledger_owner_id() THEN 'owner'
    -- Level 2: delegates table
    WHEN EXISTS (
      SELECT 1 FROM public.owner_expenses_access a
      WHERE a.granted_user_id = auth.uid()
        AND a.owner_user_id = public.personal_ledger_owner_id()
        AND a.can_edit
    ) THEN 'editor'
    WHEN EXISTS (
      SELECT 1 FROM public.owner_expenses_access a
      WHERE a.granted_user_id = auth.uid()
        AND a.owner_user_id = public.personal_ledger_owner_id()
        AND a.can_view
    ) THEN 'viewer'
    -- Level 3: legacy fallback
    WHEN lower(coalesce((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), '')) = 'an.ayoub98@gmail.com'
      OR lower(coalesce((SELECT p.username FROM public.profiles p WHERE p.id = auth.uid()), '')) = 'an.ayoub98@gmail.com'
      THEN 'owner'
    WHEN lower(coalesce((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), '')) = 'nasser1968ayoub@gmail.com'
      OR lower(coalesce((SELECT p.username FROM public.profiles p WHERE p.id = auth.uid()), '')) = 'nasser1968ayoub@gmail.com'
      THEN 'viewer'
    ELSE 'none'
  END;
$$;

CREATE OR REPLACE FUNCTION public.personal_access_level(_owner uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _owner IS DISTINCT FROM public.personal_ledger_owner_id() THEN 'none'
    WHEN public.personal_identity() = 'owner' THEN 'edit'
    WHEN public.personal_identity() = 'editor' THEN 'edit'
    WHEN public.personal_identity() = 'viewer' THEN 'view'
    ELSE 'none'
  END;
$$;

DROP FUNCTION IF EXISTS public.personal_owner_info();
CREATE FUNCTION public.personal_owner_info()
RETURNS TABLE(owner_id uuid, owner_name text, access text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    public.personal_ledger_owner_id() AS owner_id,
    'حج ناصر'::text AS owner_name,
    CASE public.personal_identity()
      WHEN 'owner' THEN 'edit'
      WHEN 'editor' THEN 'edit'
      WHEN 'viewer' THEN 'view'
      ELSE 'none'
    END AS access
  WHERE public.personal_identity() <> 'none';
$$;

-- 4) Owner-only management functions
CREATE OR REPLACE FUNCTION public.get_owner_expense_delegates()
RETURNS TABLE(granted_user_id uuid, full_name text, email text, can_view boolean, can_edit boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF public.personal_identity() <> 'owner' THEN
    RAISE EXCEPTION 'غير مصرح: هذه الصفحة للمالك فقط';
  END IF;
  RETURN QUERY
    SELECT a.granted_user_id,
           COALESCE(p.name, '')::text,
           COALESCE(u.email, p.username, '')::text,
           a.can_view, a.can_edit, a.created_at
    FROM public.owner_expenses_access a
    LEFT JOIN public.profiles p ON p.id = a.granted_user_id
    LEFT JOIN auth.users u ON u.id = a.granted_user_id
    WHERE a.owner_user_id = public.personal_ledger_owner_id()
    ORDER BY a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_owner_expense_access(target_user_id uuid, allow_view boolean, allow_edit boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_owner uuid;
BEGIN
  IF public.personal_identity() <> 'owner' THEN
    RAISE EXCEPTION 'غير مصرح: هذه العملية للمالك فقط';
  END IF;
  v_owner := public.personal_ledger_owner_id();
  IF target_user_id = v_owner THEN
    RAISE EXCEPTION 'المالك لديه صلاحية كاملة تلقائياً';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = target_user_id) THEN
    RAISE EXCEPTION 'المستخدم غير موجود';
  END IF;
  INSERT INTO public.owner_expenses_access (owner_user_id, granted_user_id, can_view, can_edit)
  VALUES (v_owner, target_user_id, COALESCE(allow_view, true) OR COALESCE(allow_edit, false), COALESCE(allow_edit, false))
  ON CONFLICT (owner_user_id, granted_user_id)
  DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_owner_expense_access(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF public.personal_identity() <> 'owner' THEN
    RAISE EXCEPTION 'غير مصرح: هذه العملية للمالك فقط';
  END IF;
  DELETE FROM public.owner_expenses_access
   WHERE owner_user_id = public.personal_ledger_owner_id()
     AND granted_user_id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_owner_expense_delegates() FROM public;
REVOKE ALL ON FUNCTION public.manage_owner_expense_access(uuid, boolean, boolean) FROM public;
REVOKE ALL ON FUNCTION public.revoke_owner_expense_access(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.personal_ledger_owner_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.personal_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.personal_access_level(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.personal_owner_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_expense_delegates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_owner_expense_access(uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_owner_expense_access(uuid) TO authenticated;