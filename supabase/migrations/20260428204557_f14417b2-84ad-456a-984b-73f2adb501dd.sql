-- ضمان تفرّد SKU على مستوى الشركة بالكامل (مش على مستوى الفرع بس)
-- لو نفس المنتج موجود في فرعين بنفس الـ SKU ده مسموح، لكن SKU مختلف لازم يكون فريد
-- بدل ما نحط unique على (tenant, sku) لأن ده هيمنع وجود نفس المنتج في فروع مختلفة،
-- نضيف فهرس لتسريع البحث عن آخر SKU ولتفرّد عشوائي مولّد
CREATE INDEX IF NOT EXISTS products_tenant_sku_idx ON public.products (tenant_id, sku);