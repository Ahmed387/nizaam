CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DROP TRIGGER IF EXISTS trg_hash_employee_password ON public.employees;

CREATE TRIGGER trg_hash_employee_password
BEFORE INSERT OR UPDATE OF login_password ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.hash_employee_password();

UPDATE public.employees
SET
  email = 'ahmedfadl4400@gmail.com',
  phone = '01551464464',
  job_title = 'كاشير',
  login_password = crypt('12345678', gen_salt('bf', 10))
WHERE id = '59bc6e64-8cf4-4251-80f9-16bbc6e0d73b';

UPDATE public.employees
SET login_password = crypt(login_password, gen_salt('bf', 10))
WHERE login_password IS NOT NULL
  AND length(login_password) > 0
  AND login_password !~ '^\$2[aby]\$';