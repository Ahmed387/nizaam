-- Add fields needed for unified employee login
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS role public.app_role,
  ADD COLUMN IF NOT EXISTS login_password text;

-- Helpful index for login lookups (case-insensitive email)
CREATE INDEX IF NOT EXISTS idx_employees_email_lower ON public.employees (lower(email));
CREATE INDEX IF NOT EXISTS idx_employees_phone ON public.employees (phone);

-- Predefined positions list (job titles) — stored in settings as a tenant-level list
-- (Frontend will use a hardcoded fallback list as well.)