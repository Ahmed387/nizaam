-- 0192: owner 2026-11-11 «وحدات القياس (كرتونة/قطعة) نفذ … ابدا». Stock, prices, costs and documents stay BY THE PIECE (nothing
-- in the books changes). A product only learns how many pieces its pack holds: `pack_size` (≥ 1, 1 = sold by the piece only)
-- and `pack_name` («كرتونة»). Screens show «= 2 كرتونة + 1 قطعة» next to a quantity and let the user add / remove a whole pack
-- in sale and purchase lines; what is saved is always pieces. `set_product_pack(product, size, name)` — admin / owner / branch
-- manager — sets it on every branch row of the same code (one product, one pack). The seven fans that «سهل» counted by the
-- carton of 3 (0179) get pack_size 3.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pack_size integer NOT NULL DEFAULT 1;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pack_name text NOT NULL DEFAULT 'كرتونة';
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_pack_size_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_pack_size_check CHECK (pack_size >= 1 AND pack_size <= 100000);
  END IF;
END $c$;

CREATE OR REPLACE FUNCTION public.set_product_pack(p_product uuid, p_size integer, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p public.products%ROWTYPE; n int;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'branch_manager'::app_role)) THEN
    RAISE EXCEPTION 'تحديد وحدة الصنف للمدير أو المالك' USING ERRCODE = '42501';
  END IF;
  IF p_size IS NULL OR p_size < 1 THEN RAISE EXCEPTION 'عدد القطع في الكرتونة لازم يكون 1 أو أكتر'; END IF;
  SELECT * INTO p FROM public.products WHERE id = p_product AND tenant_id = public.current_tenant_id();
  IF p.id IS NULL THEN RAISE EXCEPTION 'الصنف مش موجود'; END IF;
  UPDATE public.products SET pack_size = p_size, pack_name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), pack_name)
   WHERE tenant_id = p.tenant_id AND sku = p.sku;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('sku', p.sku, 'pack_size', p_size, 'rows', n);
END
$fn$;
REVOKE ALL ON FUNCTION public.set_product_pack(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_pack(uuid, integer, text) TO authenticated;

DO $f$ BEGIN
  IF to_regclass('sahl_import.cfg_unit3') IS NOT NULL THEN
    UPDATE public.products p SET pack_size = 3 FROM sahl_import.cfg_unit3 u, public.branches b
     WHERE p.sku = u.sku AND b.id = p.branch_id AND b.code IN ('FR-003', 'FR-004', 'FR-005') AND p.pack_size = 1;
  END IF;
END $f$;
NOTIFY pgrst, 'reload schema';

-- same day, owner: «ممكن احدد سعر مخصوص للكرتونة او للقطعه وانت تحسب الكرتونة كام». `pack_price` (NULL = pack size × piece
-- price). It is a SELLING hint only: a sale line offers «طبّق سعر الكرتونة», which puts the difference as the line's discount
-- (full packs at the pack price, the rest at the piece price); the saved unit price stays the piece price.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pack_price numeric;
DO $d$ BEGIN
  IF to_regprocedure('public.set_product_pack(uuid, integer, text)') IS NOT NULL THEN
    EXECUTE 'DROP FUNCTION public.set_product_pack(uuid, integer, text)';
  END IF;
END $d$;
CREATE OR REPLACE FUNCTION public.set_product_pack(p_product uuid, p_size integer, p_name text DEFAULT NULL, p_pack_price numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p public.products%ROWTYPE; n int;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'branch_manager'::app_role)) THEN
    RAISE EXCEPTION 'تحديد وحدة الصنف للمدير أو المالك' USING ERRCODE = '42501';
  END IF;
  IF p_size IS NULL OR p_size < 1 THEN RAISE EXCEPTION 'عدد القطع في الكرتونة لازم يكون 1 أو أكتر'; END IF;
  IF p_pack_price IS NOT NULL AND p_pack_price < 0 THEN RAISE EXCEPTION 'سعر الكرتونة مينفعش يكون بالسالب'; END IF;
  SELECT * INTO p FROM public.products WHERE id = p_product AND tenant_id = public.current_tenant_id();
  IF p.id IS NULL THEN RAISE EXCEPTION 'الصنف مش موجود'; END IF;
  UPDATE public.products SET pack_size = p_size, pack_name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), pack_name),
         pack_price = CASE WHEN p_size > 1 THEN nullif(p_pack_price, 0) END
   WHERE tenant_id = p.tenant_id AND sku = p.sku;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('sku', p.sku, 'pack_size', p_size, 'pack_price', nullif(p_pack_price, 0), 'rows', n);
END
$fn$;
REVOKE ALL ON FUNCTION public.set_product_pack(uuid, integer, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_pack(uuid, integer, text, numeric) TO authenticated;
NOTIFY pgrst, 'reload schema';
