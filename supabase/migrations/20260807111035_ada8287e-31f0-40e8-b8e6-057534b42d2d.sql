DROP INDEX IF EXISTS public.uniq_open_inventory_session_per_branch;
CREATE UNIQUE INDEX uniq_open_inventory_session_per_branch
  ON public.inventory_sessions (branch_id)
  WHERE status IN ('counting','reviewing','pending_approval');