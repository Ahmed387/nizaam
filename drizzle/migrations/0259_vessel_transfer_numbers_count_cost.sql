-- 0259 (owner 2026-11-18, unified filter round 2):
-- (1) «عاوزك تعمل ل تحويلات بين الأوعية ارقام مستند عشان نبحث برقم المستند»: vessel_transfers.doc_number VT00001…, one
--     counter per company (like IN / PO / PV / RV). Existing rows (cancelled too) numbered by transfer_date, created_at, id;
--     new rows get the next number in a BEFORE INSERT trigger (per-company advisory lock, so two at once never clash).
-- (2) «تابة المبلغ بتبحث هنا على اسعار الشراء او التكلفة اللى تم بها الجرد … بتكلفة الصنف»: inventory_session_items.unit_cost =
--     the item's cost when the count session was made (avg_cost, else cost_price), frozen; the count tab's amount filter
--     matches sessions with an item whose unit_cost is in the range. No sessions existed on 2026-11-18, so nothing to backfill.

ALTER TABLE public.vessel_transfers ADD COLUMN IF NOT EXISTS doc_number text;

WITH n AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY transfer_date, created_at, id) AS rn
    FROM public.vessel_transfers WHERE doc_number IS NULL
)
UPDATE public.vessel_transfers v SET doc_number = 'VT' || lpad(n.rn::text, 5, '0') FROM n WHERE v.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS vessel_transfers_tenant_doc_number_uq ON public.vessel_transfers (tenant_id, doc_number);

CREATE OR REPLACE FUNCTION public.vessel_transfer_set_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  IF NEW.doc_number IS NOT NULL AND NEW.doc_number <> '' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('vessel_transfer_number:' || coalesce(NEW.tenant_id::text, '')));
  SELECT coalesce(max(substring(v.doc_number FROM '^VT([0-9]+)$')::int), 0) + 1 INTO v_n
    FROM public.vessel_transfers v WHERE v.tenant_id IS NOT DISTINCT FROM NEW.tenant_id;
  NEW.doc_number := 'VT' || lpad(v_n::text, 5, '0');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.vessel_transfer_set_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vessel_transfer_number ON public.vessel_transfers;
CREATE TRIGGER trg_vessel_transfer_number BEFORE INSERT ON public.vessel_transfers
  FOR EACH ROW EXECUTE FUNCTION public.vessel_transfer_set_number();

ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS unit_cost numeric;

CREATE OR REPLACE FUNCTION public.inventory_session_item_set_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.unit_cost IS NULL THEN
    SELECT coalesce(nullif(p.avg_cost, 0), p.cost_price, 0) INTO NEW.unit_cost FROM public.products p WHERE p.id = NEW.product_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.inventory_session_item_set_cost() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_inventory_session_item_cost ON public.inventory_session_items;
CREATE TRIGGER trg_inventory_session_item_cost BEFORE INSERT ON public.inventory_session_items
  FOR EACH ROW EXECUTE FUNCTION public.inventory_session_item_set_cost();
