
-- 1) Add new enum value
ALTER TYPE public.advance_request_status ADD VALUE IF NOT EXISTS 'approved_pending_funds';
