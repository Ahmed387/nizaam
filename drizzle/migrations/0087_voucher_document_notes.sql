-- 0087 — An automatic voucher carries its document's notes and recipient (owner rule 2026-10-14).
--
-- «ويكون في السند نفس الملاحظات اللي مكتوبة في الفاتورة»: the till / plan voucher of a sale, purchase, sale return
-- or purchase return shows the document's notes after its own text (" — ملاحظات: …") and the document's recipient
-- when the voucher has none. Old vouchers are filled once; a later notes / recipient change on the document
-- (set_document_annotations or any edit) updates its vouchers. Text only: amounts, dates, till and ledger untouched.

CREATE OR REPLACE FUNCTION public.voucher_doc_annotation(p_treasury_id uuid)
RETURNS TABLE(notes text, recipient text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ref AS (
    SELECT coalesce(pp.reference_id, t.reference_id) AS doc_id
      FROM treasury t
      LEFT JOIN payment_transactions pt ON pt.treasury_id = t.id
      LEFT JOIN payment_plans pp ON pp.id = pt.payment_plan_id
     WHERE t.id = p_treasury_id
     LIMIT 1)
  SELECT nullif(btrim(d.notes), ''), nullif(btrim(d.recipient), '')
    FROM ref
    JOIN LATERAL (
      SELECT i.notes, i.recipient_name AS recipient FROM invoices i WHERE i.id = ref.doc_id
      UNION ALL SELECT s.notes, NULL FROM shipments s WHERE s.id = ref.doc_id
      UNION ALL SELECT r.notes, r.recipient_name FROM returns r WHERE r.id = ref.doc_id
      UNION ALL SELECT pr.notes, pr.recipient_name FROM purchase_returns pr WHERE pr.id = ref.doc_id
    ) d ON true
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.voucher_doc_annotation(uuid) FROM PUBLIC, anon, authenticated;

-- the voucher's own text without a previous notes suffix
CREATE OR REPLACE FUNCTION public.voucher_desc_with_notes(p_desc text, p_notes text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_notes IS NULL THEN nullif(split_part(coalesce(p_desc, ''), ' — ملاحظات: ', 1), '')
              ELSE concat_ws(' — ملاحظات: ', nullif(split_part(coalesce(p_desc, ''), ' — ملاحظات: ', 1), ''), p_notes) END
$$;

-- refresh one voucher (text only; no ledger re-capture for a text change)
CREATE OR REPLACE FUNCTION public.voucher_apply_doc_notes(p_voucher_id uuid, p_old_recipient text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; a record; v_desc text; v_rec text; v_prev text;
BEGIN
  SELECT * INTO v FROM vouchers WHERE id = p_voucher_id;
  IF NOT FOUND OR v.source IS DISTINCT FROM 'system' OR v.treasury_id IS NULL THEN RETURN false; END IF;
  IF public.ledger_period_closed(v.tenant_id, v.voucher_date) THEN RETURN false; END IF;
  SELECT * INTO a FROM public.voucher_doc_annotation(v.treasury_id);
  v_desc := public.voucher_desc_with_notes(v.description, a.notes);
  v_rec := CASE WHEN v.recipient_name IS NULL OR v.recipient_name = p_old_recipient THEN coalesce(a.recipient, v.recipient_name)
                ELSE v.recipient_name END;
  IF v_desc IS NOT DISTINCT FROM v.description AND v_rec IS NOT DISTINCT FROM v.recipient_name THEN RETURN false; END IF;
  v_prev := current_setting('app.ledger_capture', true);
  PERFORM set_config('app.ledger_capture', 'off', true);
  UPDATE vouchers SET description = v_desc, recipient_name = v_rec WHERE id = p_voucher_id;
  PERFORM set_config('app.ledger_capture', coalesce(v_prev, ''), true);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.voucher_apply_doc_notes(uuid, text) FROM PUBLIC, anon, authenticated;

-- new automatic vouchers whose document is already linked through the till row
CREATE OR REPLACE FUNCTION public.voucher_fill_doc_notes_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  IF NEW.source IS DISTINCT FROM 'system' OR NEW.treasury_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO a FROM public.voucher_doc_annotation(NEW.treasury_id);
  NEW.description := public.voucher_desc_with_notes(NEW.description, a.notes);
  IF NEW.recipient_name IS NULL THEN NEW.recipient_name := a.recipient; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER ab_voucher_doc_notes BEFORE INSERT ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.voucher_fill_doc_notes_trg();

-- plan payments: the plan link is written after the till row / voucher
CREATE OR REPLACE FUNCTION public.pt_voucher_doc_notes_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE vid uuid;
BEGIN
  IF NEW.treasury_id IS NULL THEN RETURN NULL; END IF;
  FOR vid IN SELECT id FROM vouchers WHERE treasury_id = NEW.treasury_id AND source = 'system' LOOP
    PERFORM public.voucher_apply_doc_notes(vid);
  END LOOP;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER zz_pt_voucher_doc_notes AFTER INSERT OR UPDATE OF treasury_id ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.pt_voucher_doc_notes_trg();

-- a document's notes / recipient changed: its automatic vouchers follow
CREATE OR REPLACE FUNCTION public.doc_notes_to_vouchers_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE vid uuid; v_old_rec text;
BEGIN
  IF TG_TABLE_NAME <> 'shipments' THEN v_old_rec := OLD.recipient_name; END IF;
  FOR vid IN
    SELECT v.id FROM treasury t JOIN vouchers v ON v.treasury_id = t.id AND v.source = 'system' WHERE t.reference_id = NEW.id
    UNION
    SELECT v.id FROM payment_plans pp JOIN payment_transactions pt ON pt.payment_plan_id = pp.id
      JOIN vouchers v ON v.treasury_id = pt.treasury_id AND v.source = 'system' WHERE pp.reference_id = NEW.id
  LOOP
    PERFORM public.voucher_apply_doc_notes(vid, v_old_rec);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER zz_doc_notes_to_vouchers AFTER UPDATE OF notes, recipient_name ON public.invoices
  FOR EACH ROW WHEN (OLD.notes IS DISTINCT FROM NEW.notes OR OLD.recipient_name IS DISTINCT FROM NEW.recipient_name)
  EXECUTE FUNCTION public.doc_notes_to_vouchers_trg();
CREATE OR REPLACE TRIGGER zz_doc_notes_to_vouchers AFTER UPDATE OF notes, recipient_name ON public.returns
  FOR EACH ROW WHEN (OLD.notes IS DISTINCT FROM NEW.notes OR OLD.recipient_name IS DISTINCT FROM NEW.recipient_name)
  EXECUTE FUNCTION public.doc_notes_to_vouchers_trg();
CREATE OR REPLACE TRIGGER zz_doc_notes_to_vouchers AFTER UPDATE OF notes, recipient_name ON public.purchase_returns
  FOR EACH ROW WHEN (OLD.notes IS DISTINCT FROM NEW.notes OR OLD.recipient_name IS DISTINCT FROM NEW.recipient_name)
  EXECUTE FUNCTION public.doc_notes_to_vouchers_trg();
CREATE OR REPLACE TRIGGER zz_doc_notes_to_vouchers AFTER UPDATE OF notes ON public.shipments
  FOR EACH ROW WHEN (OLD.notes IS DISTINCT FROM NEW.notes)
  EXECUTE FUNCTION public.doc_notes_to_vouchers_trg();

-- backfill the existing automatic vouchers (each change gets its own audit row)
DO $b$
DECLARE vid uuid; n int := 0;
BEGIN
  FOR vid IN SELECT id FROM vouchers WHERE source = 'system' AND treasury_id IS NOT NULL LOOP
    IF public.voucher_apply_doc_notes(vid) THEN n := n + 1; END IF;
  END LOOP;
  RAISE NOTICE '0087: % vouchers annotated', n;
END $b$;
