ALTER TABLE public.inventory_sessions
DROP CONSTRAINT IF EXISTS inventory_sessions_status_check;

ALTER TABLE public.inventory_sessions
ADD CONSTRAINT inventory_sessions_status_check
CHECK (status = ANY (ARRAY[
  'counting'::text,
  'reviewing'::text,
  'pending_approval'::text,
  'approved'::text,
  'rejected'::text,
  'closed'::text,
  'cancelled'::text
]));