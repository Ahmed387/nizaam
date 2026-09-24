CREATE OR REPLACE FUNCTION public.normalize_ar_name(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(regexp_replace(translate(regexp_replace(coalesce(t,''), '[\u064B-\u065F\u0670\u0640]', '', 'g'), 'إأآىة', 'ااايه'), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.contacts_block_similar_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE hit text;
BEGIN
  IF TG_OP = 'UPDATE' AND public.normalize_ar_name(NEW.name) = public.normalize_ar_name(OLD.name) THEN RETURN NEW; END IF;
  IF NEW.name LIKE '%[مدمج%' THEN RETURN NEW; END IF;
  SELECT c.name INTO hit FROM public.contacts c
   WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id
     AND c.name NOT LIKE '%[مدمج%'
     AND trim(public.normalize_ar_name(c.name)) = trim(public.normalize_ar_name(NEW.name))
   LIMIT 1;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION 'يوجد حساب مسجل بالفعل بنفس الاسم: «%» — اختره من القائمة بدل إنشاء حساب جديد', hit USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contacts_block_similar_name ON public.contacts;
CREATE TRIGGER trg_contacts_block_similar_name BEFORE INSERT OR UPDATE OF name ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.contacts_block_similar_name();