DROP FUNCTION IF EXISTS public.create_pre_order(uuid,uuid,text,text,uuid,text,text,integer,numeric,numeric,text,text);
DROP FUNCTION IF EXISTS public.process_sale(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.transfer_treasury_atomic(uuid,uuid,numeric,text,text,numeric,text,text);
DROP FUNCTION IF EXISTS public.edit_voucher(uuid,uuid,numeric,text,date,voucher_party_type,uuid,text,text,text,text,numeric,text);