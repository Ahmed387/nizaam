-- 0070 — Root-cause fix for the 405 «سند قبض من مورد» vouchers (Step 8).
-- What happened: money moved between branches (and PayMob settlements) was typed in by hand as a
-- RECEIPT voucher whose party was a «supplier» contact (the branches had been created as contacts),
-- under the user category «مقبوضات من موردين». The ledger reads a receipt from a supplier as the
-- supplier refunding us, so every one of them inflated the till AND put a fake charge on that supplier.
-- Fix:
--   1) the database refuses any active receipt voucher with party_type = 'supplier' (insert or edit),
--      whatever screen, RPC or script it comes from;
--   2) the category «مقبوضات من موردين» is switched off so it can't be picked again.
-- Money from another branch goes through «التحويلات بين الفروع» (تحويل خزنة); money a supplier gives back goes through
-- «مرتجع شراء» (purchase return refund), which books it on the supplier side correctly.

CREATE OR REPLACE FUNCTION public.guard_voucher_receipt_party()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.type = 'receipt' AND NEW.party_type::text = 'supplier' AND COALESCE(NEW.status::text, 'active') = 'active' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'مينفعش سند قبض من مورد. فلوس جاية من فرع تاني → «التحويلات بين الفروع» (تحويل خزنة). فلوس رجعها مورد → «مرتجع شراء». سند القبض للعملاء أو «أخرى» بس.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aa_guard_voucher_receipt_party ON public.vouchers;
CREATE TRIGGER aa_guard_voucher_receipt_party
  BEFORE INSERT OR UPDATE OF type, party_type, status ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.guard_voucher_receipt_party();

UPDATE public.voucher_categories
   SET is_active = false
 WHERE type = 'receipt' AND name = 'مقبوضات من موردين' AND is_active IS DISTINCT FROM false;
