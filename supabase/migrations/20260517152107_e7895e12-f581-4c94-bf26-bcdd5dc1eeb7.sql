DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
                 WHERE t.typname='app_role' AND e.enumlabel='viewer') THEN
    ALTER TYPE public.app_role ADD VALUE 'viewer';
  END IF;
END $$;