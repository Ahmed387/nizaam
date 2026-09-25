ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS merged_into uuid;
CREATE INDEX IF NOT EXISTS contacts_active_idx ON public.contacts(tenant_id) WHERE is_archived = false;

CREATE OR REPLACE FUNCTION public.contacts_block_similar_name()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE hit text;
BEGIN
  IF NEW.is_archived OR NEW.name LIKE '%[مدمج%' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND public.normalize_ar_name(NEW.name) = public.normalize_ar_name(OLD.name) AND NOT OLD.is_archived THEN RETURN NEW; END IF;
  SELECT c.name INTO hit FROM public.contacts c
   WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id
     AND c.is_archived = false AND c.name NOT LIKE '%[مدمج%'
     AND trim(public.normalize_ar_name(c.name)) = trim(public.normalize_ar_name(NEW.name))
   LIMIT 1;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION 'يوجد حساب مسجل بالفعل بنفس الاسم: «%» — اختره من القائمة بدل إنشاء حساب جديد', hit USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.block_archived_contact_tx()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cid uuid;
BEGIN
  IF TG_TABLE_NAME = 'vouchers' THEN
    cid := NEW.party_id;
  ELSE
    cid := NEW.contact_id;
  END IF;
  IF cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.contacts WHERE id = cid AND is_archived) THEN
    RAISE EXCEPTION 'لا يمكن تسجيل معاملات جديدة على هذا الحساب';
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_block_archived_contact BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.block_archived_contact_tx();
CREATE TRIGGER trg_block_archived_contact BEFORE INSERT ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.block_archived_contact_tx();
CREATE TRIGGER trg_block_archived_contact BEFORE INSERT ON public.purchase_returns FOR EACH ROW EXECUTE FUNCTION public.block_archived_contact_tx();
CREATE TRIGGER trg_block_archived_contact BEFORE INSERT ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.block_archived_contact_tx();
CREATE TRIGGER trg_block_archived_contact BEFORE INSERT ON public.pre_orders FOR EACH ROW EXECUTE FUNCTION public.block_archived_contact_tx();
CREATE TRIGGER trg_block_archived_contact BEFORE INSERT ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.block_archived_contact_tx();
CREATE TRIGGER trg_block_archived_contact BEFORE INSERT ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.block_archived_contact_tx();