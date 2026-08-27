CREATE OR REPLACE FUNCTION public.personal_access_level(_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND lower(u.email) IN ('an.ayoub98@gmail.com','nasser1968ayoub@gmail.com')
    )
    AND _owner = (SELECT u2.id FROM auth.users u2 WHERE lower(u2.email) = 'an.ayoub98@gmail.com' LIMIT 1)
    THEN 'edit'
    ELSE 'none'
  END;
$$;