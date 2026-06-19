
BEGIN;

UPDATE public.product_batches SET quantity_remaining = 5
WHERE id = 'a4e106e9-c753-4735-b512-3cef4a077ac7' AND quantity_remaining = 7;

UPDATE public.product_batches SET quantity_remaining = 3
WHERE id = '80d04085-0ee9-4340-b2b2-af654fa6a43b' AND quantity_remaining = 4;

UPDATE public.product_batches SET quantity_remaining = 0
WHERE id = 'f5264490-5553-4590-9450-0278fa82668e' AND quantity_remaining = 2;

UPDATE public.product_batches SET quantity_remaining = 4
WHERE id = '3ade1f07-db27-4fe5-ac4e-e21986bd1925' AND quantity_remaining = 5;

INSERT INTO public.audit_log (action, entity, entity_id, user_name, details, created_at)
VALUES
  ('drift_correction', 'product_batches', 'a4e106e9-c753-4735-b512-3cef4a077ac7', 'system_migration',
   jsonb_build_object('reason', 'Step 3: Miraoko 9Kg', 'from', 7, 'to', 5), now()),
  ('drift_correction', 'product_batches', '80d04085-0ee9-4340-b2b2-af654fa6a43b', 'system_migration',
   jsonb_build_object('reason', 'Step 3: Miraoko 11Kg', 'from', 4, 'to', 3), now()),
  ('drift_correction', 'product_batches', 'f5264490-5553-4590-9450-0278fa82668e', 'system_migration',
   jsonb_build_object('reason', 'Step 3: Toshiba chaos', 'from', 2, 'to', 0), now()),
  ('drift_correction', 'product_batches', '3ade1f07-db27-4fe5-ac4e-e21986bd1925', 'system_migration',
   jsonb_build_object('reason', 'Step 3: Toshiba FIFO cont', 'from', 5, 'to', 4), now());

COMMIT;
