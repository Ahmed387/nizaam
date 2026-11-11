-- 0187: owner 2026-11-11 «أعيد بناء الدفعات = الكمية الحقيقية نفذ». After the «سهل» import the batches' `quantity_remaining`
-- of 214 product rows (FR-003 / FR-004 / FR-005) no longer added up to the product quantity: batches were made in import run
-- order, corrections (fans ÷3, merges, opening re-base) moved quantities without them. Cost and profit come from the moving
-- average, not from batches, but batches still gate operations (FIFO consumption, purchase-return / purchase-cancel checks).
-- Rule: what is on the shelf is the NEWEST purchases — walking a product's batches from the newest back, each keeps
-- min(its purchased quantity, what is still unplaced of the product quantity); a negative quantity keeps 0 everywhere.
-- Only `quantity_remaining` changes. Dry-run: 214 products, 223 batch rows changed, 0 still different, avg_cost of none changed.
DO $mig$
BEGIN
  IF to_regnamespace('sahl_import') IS NULL THEN RETURN; END IF;
  PERFORM sahl_import.ctx();
  CREATE TEMP TABLE _p ON COMMIT DROP AS
    SELECT p.id, greatest(p.quantity, 0) q FROM public.products p JOIN public.branches b ON b.id = p.branch_id
     WHERE b.code IN ('FR-003', 'FR-004', 'FR-005') AND p.archived_at IS NULL
       AND p.quantity <> coalesce((SELECT sum(pb.quantity_remaining) FROM public.product_batches pb WHERE pb.product_id = p.id), 0);
  UPDATE public.product_batches pb SET quantity_remaining = n.nw
    FROM (SELECT pb2.id, pb2.quantity_remaining old,
                 greatest(least(greatest(pb2.quantity_purchased, 0),
                   _p.q - coalesce(sum(greatest(pb2.quantity_purchased, 0)) OVER (PARTITION BY pb2.product_id
                            ORDER BY coalesce(pb2.effective_at, pb2.created_at) DESC, pb2.created_at DESC, pb2.id
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)), 0) nw
            FROM public.product_batches pb2 JOIN _p ON _p.id = pb2.product_id) n
   WHERE n.id = pb.id AND n.nw <> n.old;
END
$mig$;
