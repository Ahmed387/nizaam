DELETE FROM public.inventory_session_items WHERE session_id IN (
  SELECT id FROM public.inventory_sessions WHERE status IN ('counting','draft','review')
);
DELETE FROM public.inventory_sessions WHERE status IN ('counting','draft','review');

CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_inventory_session_per_branch
  ON public.inventory_sessions (branch_id)
  WHERE status IN ('counting','draft','review');

ALTER TABLE public.inventory_session_items
  ADD CONSTRAINT isi_actual_quantity_non_negative CHECK (actual_quantity IS NULL OR actual_quantity >= 0) NOT VALID;
ALTER TABLE public.inventory_session_items VALIDATE CONSTRAINT isi_actual_quantity_non_negative;