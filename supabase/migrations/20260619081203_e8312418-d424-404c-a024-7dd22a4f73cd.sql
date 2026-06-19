
-- 1) Delete the 27 orphaned purchase batches
DELETE FROM public.product_batches
WHERE shipment_id IS NULL AND batch_type = 'purchase';

-- 2) Switch FK from SET NULL to CASCADE
ALTER TABLE public.product_batches
  DROP CONSTRAINT IF EXISTS product_batches_shipment_id_fkey;

ALTER TABLE public.product_batches
  ADD CONSTRAINT product_batches_shipment_id_fkey
  FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;

-- 3) Guard trigger: block shipment deletion if any of its batches has been consumed (sold/transferred/adjusted)
CREATE OR REPLACE FUNCTION public.prevent_shipment_delete_if_consumed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  consumed_count integer;
BEGIN
  SELECT COUNT(*)
    INTO consumed_count
  FROM public.product_batches
  WHERE shipment_id = OLD.id
    AND quantity_remaining < quantity_purchased;

  IF consumed_count > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف الشحنة: يوجد % دفعة تم البيع/الاستهلاك منها. يجب إلغاء المبيعات/التحويلات أولاً.', consumed_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_shipment_delete_if_consumed ON public.shipments;
CREATE TRIGGER trg_prevent_shipment_delete_if_consumed
  BEFORE DELETE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_shipment_delete_if_consumed();

-- 4) Manual detection function for Settings button
CREATE OR REPLACE FUNCTION public.detect_orphaned_batches()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  orphan_batches bigint,
  orphan_quantity_remaining numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    COUNT(pb.id)::bigint AS orphan_batches,
    COALESCE(SUM(pb.quantity_remaining), 0)::numeric AS orphan_quantity_remaining
  FROM public.product_batches pb
  JOIN public.products p ON p.id = pb.product_id
  WHERE pb.shipment_id IS NULL
    AND pb.batch_type = 'purchase'
  GROUP BY p.id, p.name
  ORDER BY orphan_batches DESC;
$$;

GRANT EXECUTE ON FUNCTION public.detect_orphaned_batches() TO authenticated;
