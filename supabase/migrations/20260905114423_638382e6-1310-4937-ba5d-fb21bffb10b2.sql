ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_branch_id_fkey
  FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_attendance_branch_date ON public.attendance (branch_id, date);