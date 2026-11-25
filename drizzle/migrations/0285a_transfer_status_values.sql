-- 0285a — new stock transfer states (owner 2026-11-25): waiting for the owner's approval, refused by him, cancelled by
-- the sender before it was received. Own migration: a new enum value can't be used in the transaction that adds it.
ALTER TYPE public.transfer_status ADD VALUE IF NOT EXISTS 'awaiting_approval';
ALTER TYPE public.transfer_status ADD VALUE IF NOT EXISTS 'refused';
ALTER TYPE public.transfer_status ADD VALUE IF NOT EXISTS 'cancelled';
