REVOKE EXECUTE ON FUNCTION public.historical_stock_at(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.historical_stock_at(uuid, timestamptz) TO authenticated;