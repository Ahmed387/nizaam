GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_reservations TO authenticated;
GRANT ALL ON TABLE public.inventory_reservations TO service_role;
REVOKE ALL ON TABLE public.inventory_reservations FROM anon;