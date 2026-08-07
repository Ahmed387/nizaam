DELETE FROM public.employees WHERE base_salary < 0;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_base_salary_non_negative CHECK (base_salary >= 0) NOT VALID;
ALTER TABLE public.employees VALIDATE CONSTRAINT employees_base_salary_non_negative;