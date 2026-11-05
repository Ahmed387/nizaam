-- 0159: owner 2026-11-05 «أ) صنف واحد بكود باقي الفروع … نفذ». Eight شلبى codes are the same product as another code of
-- the other branches (the same name exactly; the system keeps one product per name per branch, `products_variant_uniq`):
-- شلبى's code takes the other branches' code, so the product is ONE product with one code in every branch.
--   سخان غاز كريازي 5 لتر 1513 → 1512, ثلاجة كريازى سولتير 370 1514 → 1513, ميكروويف ميديا 28 1515 → 1514,
--   محضر طعام كاسيل 1517 → 1516, بوتاجاز زانوسى 60*60 1512 → 1511, بوتاجاز زانوسى 60*90 1518 → 1517,
--   مبرد مياه جاك 1508 → 1507, مروحة سقف نيو ناتشيوني 1388 → 1423 (counted per piece like the other branches:
--   شلبى bought it at the same carton price, 2,260).
-- شلبى's 1512–1517 therefore no longer need the letter «-ش» (0157); 1986–1991 «-ش» and عبدالمنعم's «-ع» stay.
INSERT INTO sahl_import.cfg_sku (branch, code, sku) VALUES
 ('shalaby','1508','1507'), ('shalaby','1512','1511'), ('shalaby','1513','1512'), ('shalaby','1514','1513'),
 ('shalaby','1515','1514'), ('shalaby','1517','1516'), ('shalaby','1518','1517'), ('shalaby','1388','1423')
ON CONFLICT (branch, code) DO UPDATE SET sku = EXCLUDED.sku;
