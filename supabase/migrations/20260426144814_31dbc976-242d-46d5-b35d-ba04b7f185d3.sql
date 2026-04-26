-- 1) Drop the enforcement triggers if exist
DROP TRIGGER IF EXISTS enforce_branch_limit_trg ON public.branches;
DROP TRIGGER IF EXISTS enforce_product_limit_trg ON public.products;
DROP TRIGGER IF EXISTS enforce_user_limit_trg ON public.profiles;

DROP TRIGGER IF EXISTS trg_enforce_branch_limit ON public.branches;
DROP TRIGGER IF EXISTS trg_enforce_product_limit ON public.products;
DROP TRIGGER IF EXISTS trg_enforce_user_limit ON public.profiles;

-- 2) Drop the enforcement functions
DROP FUNCTION IF EXISTS public.enforce_branch_limit() CASCADE;
DROP FUNCTION IF EXISTS public.enforce_product_limit() CASCADE;
DROP FUNCTION IF EXISTS public.enforce_user_limit() CASCADE;

-- 3) Make plan/limit columns nullable so NULL = unlimited
ALTER TABLE public.tenants ALTER COLUMN max_branches DROP NOT NULL;
ALTER TABLE public.tenants ALTER COLUMN max_products DROP NOT NULL;
ALTER TABLE public.tenants ALTER COLUMN max_users DROP NOT NULL;
ALTER TABLE public.tenants ALTER COLUMN max_branches DROP DEFAULT;
ALTER TABLE public.tenants ALTER COLUMN max_products DROP DEFAULT;
ALTER TABLE public.tenants ALTER COLUMN max_users DROP DEFAULT;

-- 4) Open up all existing tenants
UPDATE public.tenants
SET max_branches = NULL,
    max_products = NULL,
    max_users = NULL,
    plan = 'unlimited';