ALTER TABLE public.role_permissions REPLICA IDENTITY FULL;
ALTER TABLE public.user_permissions REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='role_permissions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.role_permissions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='user_permissions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_permissions;
  END IF;
END $$;