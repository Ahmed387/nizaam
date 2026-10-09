-- Stale partial copies of Step 6B helpers (different parameter names / return columns) block CREATE OR REPLACE.
-- Nothing in the app calls them; 0055 recreates them with the reviewed definitions.
DROP FUNCTION IF EXISTS public.ledger_desired_movements(uuid);
DROP FUNCTION IF EXISTS public.ledger_ip_is_voided_mirror(uuid);
DROP FUNCTION IF EXISTS public.ledger_day(timestamptz);