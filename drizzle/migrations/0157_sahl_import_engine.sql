-- 0157: the go-live import engine for the 2026 files of «سهل» (owner 2026-11-05 «نفذها بالكامل وارفع الكل»).
-- Functions and fixed choices only; nothing in the business tables changes until sahl_import.run_setup() /
-- sahl_import.run_ops() are called from the database console (they turn on 0156's import mode for their transaction).
-- Owner decisions it follows (2026-11-04 / 05):
--   * documents as they are, each branch with its own accounts (a name in two branches = two accounts, «(الفرع)» added);
--   * a code that means two products: the branch that differs gets its letter («-ش», «-ع»), the others keep the code;
--   * a receipt from an account that mostly sells to us = his supplier side (raises what we owe him);
--   * a credit invoice + a voucher of the same amount, same account, same day = that invoice's own payment;
--   * personal accounts as they are; «مكسب الشركة» = إيرادات أخرى;
--   * a return on a 2025 invoice: cost = price − «ربح» (شلبى); عبدالمنعم's three wait for the owner's cost;
--   * Sep / Oct: شلبى's sales / returns / purchases with سكة تلة and عبدالمنعم that the branch did not record are made
--     in the branch; شلبى's receipts from سكة تلة that سكة did not record become سكة payments;
--   * every old till is its own vessel (PayMob, الخزينة, درج النقدية القديم); old voucher items keep their name
--     without the number, merged with the system item of the same meaning;
--   * no till balances of 31/12/2025: tills may go below zero; the شلبى discounts-till rows 1–13 as decided.
CREATE TABLE IF NOT EXISTS sahl_import.cfg_branch (branch text PRIMARY KEY, code text NOT NULL, label text NOT NULL, letter text NOT NULL);
INSERT INTO sahl_import.cfg_branch VALUES ('shalaby','FR-005','شلبى','ش'), ('abdelmonem','FR-004','عبدالمنعم','ع'), ('sekka','FR-003','سكة','س')
ON CONFLICT (branch) DO NOTHING;

CREATE TABLE IF NOT EXISTS sahl_import.cfg_till (name text PRIMARY KEY, method text NOT NULL);
INSERT INTO sahl_import.cfg_till VALUES
  ('درج النقدية','cash'), ('انستاباي','instapay'), ('انستاباي / ح البنك الاهلي للشركة','instapay'), ('فودافون كاش','vodafone'),
  ('PayMob','paymob'), ('الخزينة','safe'), ('الخزينة#2','safe'),
  ('درج النقدية القديم - كل ما هو خارج الحصالة والبنك  (لاغى)','old_drawer'), ('خصومات / عروض الشركات','company_offers')
ON CONFLICT (name) DO NOTHING;
CREATE TABLE IF NOT EXISTS sahl_import.cfg_vessel (method text PRIMARY KEY, label text NOT NULL);
INSERT INTO sahl_import.cfg_vessel VALUES ('paymob','PayMob'), ('safe','الخزينة'), ('old_drawer','درج النقدية القديم') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS sahl_import.cfg_sku (branch text, code text, sku text, PRIMARY KEY (branch, code));
CREATE TABLE IF NOT EXISTS sahl_import.cfg_unit3 (sku text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sahl_import.cfg_inter (target text, op text, sha_no int, PRIMARY KEY (target, op, sha_no));
CREATE TABLE IF NOT EXISTS sahl_import.cfg_pair (target text, sha_inv int, br_purch int, PRIMARY KEY (target, sha_inv));

-- old voucher item → system item (existing name) or a new one (parent, account)
CREATE TABLE IF NOT EXISTS sahl_import.cfg_cat (type text, old text, target text NOT NULL, parent text, gl text, PRIMARY KEY (type, old));
INSERT INTO sahl_import.cfg_cat (type, old, target, parent, gl) VALUES
 ('payment','1 - ادوات مكتبية','1- ادوات مكتبية',NULL,NULL), ('payment','18- ادوات مكتبية','1- ادوات مكتبية',NULL,NULL), ('payment','ادوات مكتبيه','1- ادوات مكتبية',NULL,NULL),
 ('payment','1- (النقل) التروسيكل','(النقل) التروسيكل','مصاريف شحن','5700'),
 ('payment','10- شحن النت','9- انترنت و تليفون',NULL,NULL), ('payment','8-انترنت وتليفون','9- انترنت و تليفون',NULL,NULL), ('payment','نت و تليفون ارضي','9- انترنت و تليفون',NULL,NULL),
 ('payment','10-اكراميات','2- اكراميات عمال',NULL,NULL), ('payment','12-اكراميات','2- اكراميات عمال',NULL,NULL), ('payment','9- اكراميات العمال','2- اكراميات عمال',NULL,NULL),
 ('payment','10-ضيافة','ضيافة','نثريات / مصاريف غير مبوّبة',NULL), ('payment','11- ضيافة','ضيافة','نثريات / مصاريف غير مبوّبة',NULL), ('payment','3-ضيافة','ضيافة','نثريات / مصاريف غير مبوّبة',NULL),
 ('payment','11-كهرباء و مياه','كهرباء ومياه',NULL,NULL), ('payment','6-كهرباء و مياه','كهرباء ومياه',NULL,NULL), ('payment','7- شحن كهرباء','1- كهرباء',NULL,NULL),
 ('payment','11-مصروفات نقل','11- نقل و مواصلات',NULL,NULL), ('payment','18-مصروفات نقل','11- نقل و مواصلات',NULL,NULL),
 ('payment','12- رواتب العمال','رواتب موظفين',NULL,NULL), ('payment','3-رواتب','رواتب موظفين',NULL,NULL), ('payment','9-رواتب العاملين','رواتب موظفين',NULL,NULL),
 ('payment','13- طلبات للمخزن','طلبات للمخزن','نثريات / مصاريف غير مبوّبة',NULL),
 ('payment','13-تأمينات و ضرائب','تأمينات و ضرائب',NULL,NULL), ('payment','27- تامينات وضرائب','تأمينات و ضرائب',NULL,NULL),
 ('payment','14-مصروفات محاسبية واتعاب محاماة','مصروفات محاسبية واتعاب محاماة',NULL,NULL), ('payment','26- امصاريف محاسبية ومحاماه','مصروفات محاسبية واتعاب محاماة',NULL,NULL),
 ('payment','15-ايجارات','إيجارات',NULL,NULL), ('payment','25-ايجارات','إيجارات',NULL,NULL), ('payment','4-ايجارات','إيجارات',NULL,NULL),
 ('payment','16-خدمة ما بعد البيع','3- خدمة ما بعد البيع',NULL,NULL),
 ('payment','17- خسائر (باقى تصفية حساب)','خسائر (باقى تصفية حساب)','نثريات / مصاريف غير مبوّبة',NULL),
 ('payment','17- عمولة انستاباي/فودافون كاش','عمولات تحويل',NULL,NULL), ('payment','24-عمولة بنك / فودافون كاش','عمولات تحويل',NULL,NULL), ('payment','عمولة انستاباي/فودافون كاش','عمولات تحويل',NULL,NULL),
 ('payment','19- صيانة المخزن','1- صيانة بالمكان',NULL,NULL),
 ('payment','2- (النقل) عربية ربع نقل','4- عربية ربع نقل (بكر السواق)',NULL,NULL),
 ('payment','2- توكتوك','اجرة توكتوك','مصاريف شحن','5700'), ('payment','اجره تكتك','اجرة توكتوك','مصاريف شحن','5700'),
 ('payment','2-اكل عاملين','7- اكل وشرب للعاملين بالمكان',NULL,NULL), ('payment','5-اكل للعاملين','7- اكل وشرب للعاملين بالمكان',NULL,NULL),
 ('payment','6 غدا العمال','7- اكل وشرب للعاملين بالمكان',NULL,NULL), ('payment','6- اكل','7- اكل وشرب للعاملين بالمكان',NULL,NULL),
 ('payment','20- صيانة اجهزة تالفة','2- صيانة لمنتجات تالفة',NULL,NULL),
 ('payment','21- مصاريف نثرية','نثريات / مصاريف غير مبوّبة',NULL,NULL),
 ('payment','29-صيانة التوكتوك','صيانة التوكتوك','صيانة','5550'),
 ('payment','3- (النقل) عربية نص نقل جامبو','(النقل) عربية نص نقل جامبو','مصاريف شحن','5700'),
 ('payment','30-تغيير زيت تروسيكل','تغيير زيت تروسيكل','مصاريف شحن','5700'),
 ('payment','4- بنزين تروسيكل','بنزين تروسيكل','مصاريف شحن','5700'), ('payment','9-بنزين تروسيكل','بنزين تروسيكل','مصاريف شحن','5700'),
 ('payment','4 - مصاريف للمعرض','مصروفات المعرض','نثريات / مصاريف غير مبوّبة',NULL), ('payment','7-مصروفات معرض','مصروفات المعرض','نثريات / مصاريف غير مبوّبة',NULL),
 ('payment','5-مصروفات ادارية','مصروفات ادارية','نثريات / مصاريف غير مبوّبة',NULL),
 ('payment','6-سلف عاملين','سلف موظفين',NULL,NULL),
 ('payment','7-دعاية','4- دعاية واعلان',NULL,NULL), ('payment','رخصة دعاية واعلان','4- دعاية واعلان',NULL,NULL),
 ('payment','8- شاى وسكر المخزن','10- مشتريات ضيافة (شاى وسكر)',NULL,NULL),
 ('payment','ادوات نظافه','8- ادوات نظافة',NULL,NULL),
 ('payment','مصاريف برنامج المخز','مصاريف برنامج المخزن','نثريات / مصاريف غير مبوّبة',NULL),
 ('receipt','1- (النقل) التروسيكل','(النقل) التروسيكل','إيرادات أخرى','4200'),
 ('receipt','اجرة التكتوك','اجرة توكتوك','إيرادات أخرى','4200'), ('receipt','اجرة توكتوك','اجرة توكتوك','إيرادات أخرى','4200'), ('receipt','توكتوك','اجرة توكتوك','إيرادات أخرى','4200'),
 ('receipt','نقل','نقل','إيرادات أخرى','4200'),
 ('receipt','1- عمولة فودافون كاش / انستاباي','عمولات تحويل',NULL,NULL), ('receipt','1-عمولة فيزا / كاش','عمولات تحويل',NULL,NULL), ('receipt','عمولة بنك / فودافون كاش','عمولات تحويل',NULL,NULL),
 ('receipt','مكسب الشركة','إيرادات أخرى',NULL,NULL),
 -- default items of money with an account
 ('receipt','#customer','تحصيل أقساط عملاء',NULL,NULL), ('receipt','#supplier','مقبوضات من موردين',NULL,NULL),
 ('payment','#supplier','مدفوعات موردين',NULL,NULL), ('payment','#customer','مدفوعات لعملاء',NULL,NULL)
ON CONFLICT DO NOTHING;

-- the شلبى discounts-till decisions (claude/import-decisions-shalaby-discounts.md)
CREATE TABLE IF NOT EXISTS sahl_import.cfg_skip (branch text, kind text, no int, why text, PRIMARY KEY (branch, kind, no));
INSERT INTO sahl_import.cfg_skip VALUES
 ('shalaby','قبض',7079,'بند 1-4: سعر اللسته بدون خصم — يلغي الدفع النقدي لفاتورة 3397'),
 ('shalaby','قبض',7147,'بند 1-4: سعر اللسته بدون خصم — فاتورة 3417'),
 ('shalaby','قبض',7167,'بند 1-4: سعر اللسته بدون خصم — فاتورة 3427'),
 ('shalaby','قبض',7237,'بند 1-4: سعر اللسته بدون خصم — فاتورة 3449'),
 ('shalaby','صرف',11056,'بند 7-8: مرتجع 79 بيبقى على الحساب'),
 ('shalaby','صرف',11428,'بند 7-8: مرتجع 88 بيبقى على الحساب'),
 ('shalaby','قبض',8278,'بند 5: تنزيل من راس مال م / محمد ناصر — يتشال خالص'),
 ('shalaby','صرف',12430,'بند 5: الطرف التاني من التحويل 8278'),
 ('shalaby','صرف',11080,'بند 6: بيتسجل تسوية بدون فلوس'),
 ('shalaby','صرف',12402,'بند 9: بيتسجل تسوية بدون فلوس'),
 ('shalaby','صرف',12275,'بند 10: بيتسجل تسوية بدون فلوس'),
 ('shalaby','قبض',8122,'بند 11: بيتسجل تسوية بدون فلوس'),
 ('shalaby','صرف',12521,'بند 12: بيتسجل تسوية بدون فلوس'),
 ('shalaby','صرف',12950,'بند 13: بيتسجل تسوية بدون فلوس')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sahl_import.cfg_credit (branch text, kind text, no int, PRIMARY KEY (branch, kind, no));
INSERT INTO sahl_import.cfg_credit VALUES ('shalaby','شراء',3397), ('shalaby','شراء',3417), ('shalaby','شراء',3427), ('shalaby','شراء',3449),
 ('shalaby','مرتجع شراء',79), ('shalaby','مرتجع شراء',88) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sahl_import.cfg_settle (row_no int PRIMARY KEY, branch text, day date, contact text, side text, direction text, amount numeric, reason text);
INSERT INTO sahl_import.cfg_settle VALUES
 (6,'shalaby','2026-01-17','ريال تك','supplier','we_owe_less',6650,'بند 6 — سند صرف 11080 في سهل: 4000ج بروموتر شهر 12 وعمولة ايصال 15403'),
 (9,'shalaby','2026-02-17','شركة قنوات','supplier','we_owe_less',32077.32,'بند 9 — سند صرف 12402 في سهل: جزء من حوافز 2025'),
 (10,'shalaby','2026-03-31','شركة كريازي','supplier','we_owe_less',661343.01,'بند 10 — سند صرف 12275 في سهل: بونص اخر العام 2025'),
 (11,'shalaby','2026-04-19','التشطيبات','customer','he_owes_less',58283.77,'بند 11 — سند قبض 8122 في سهل: كريازي فرق بونص اخر العام 2025'),
 (12,'shalaby','2026-05-10','معرض تقسيم شلبي (حساب خاص)','customer','we_owe_less',41949.03,'بند 12 — سند صرف 12521 في سهل: تصفير الحساب'),
 (13,'shalaby','2026-06-09','شركة قنوات','supplier','we_owe_less',50000,'بند 13 — سند صرف 12950 في سهل: خصومات وتعويضات هبوط أسعار')
ON CONFLICT DO NOTHING;

-- work tables (rebuilt by build())
CREATE TABLE IF NOT EXISTS sahl_import.code_map (branch text, code text, sku text NOT NULL, name text, PRIMARY KEY (branch, code));
CREATE TABLE IF NOT EXISTS sahl_import.prod (sku text PRIMARY KEY, name text NOT NULL, unit3 boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS sahl_import.prod_price (branch text, sku text, price numeric, PRIMARY KEY (branch, sku));
CREATE TABLE IF NOT EXISTS sahl_import.acc (branch text, name text, display text, type text, major text, opening numeric DEFAULT 0,
  nature text, internal_of text, contact_id uuid, PRIMARY KEY (branch, name));
CREATE TABLE IF NOT EXISTS sahl_import.ops (
  id bigserial PRIMARY KEY, branch text NOT NULL, day date NOT NULL, tm time, ord int NOT NULL, kind text NOT NULL,
  src_kind text, no int, mirror_of int, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'todo',
  new_id uuid, new_no text, err text, done_at timestamptz);
CREATE INDEX IF NOT EXISTS sahl_import_ops_order ON sahl_import.ops (day, tm, ord, id);
CREATE INDEX IF NOT EXISTS sahl_import_ops_lookup ON sahl_import.ops (branch, kind, no);

CREATE OR REPLACE FUNCTION sahl_import.n(j jsonb, k text) RETURNS numeric LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(nullif(j->>k, '')::numeric, 0) $$;

-- money columns of a document → [{method, amount}] (old tills only)
CREATE OR REPLACE FUNCTION sahl_import.doc_pays(j jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('method', t.method, 'amount', round(abs(sahl_import.n(j, t.name)), 2))), '[]'::jsonb)
    FROM sahl_import.cfg_till t
   WHERE t.name NOT IN ('الخزينة#2', 'خصومات / عروض الشركات') AND j ? t.name AND sahl_import.n(j, t.name) <> 0
$$;

CREATE OR REPLACE FUNCTION sahl_import.lines(p_branch text, p_items jsonb, p_kind text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- one line: sku, whole quantity (fans per piece ×3), unit price so that qty × price − discount = the old line's final
  -- amount («النهائى», what the balances of «سهل» carry; some lines hold an extra charge above «السعر»)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sku', m.sku, 'code', it->>'رقم الصنف',
           'qty', q.qty,
           'price', CASE WHEN q.qty > 0 THEN (abs(sahl_import.n(it, 'النهائى')) + sahl_import.n(it, 'الخصم')) / q.qty ELSE 0 END,
           'disc', sahl_import.n(it, 'الخصم'),
           'net', abs(sahl_import.n(it, 'النهائى')),
           'profit', it->'ربح') ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(it, o)
    JOIN sahl_import.code_map m ON m.branch = p_branch AND m.code = it->>'رقم الصنف'
    CROSS JOIN LATERAL (SELECT round(sahl_import.n(it, 'كمية') * CASE WHEN EXISTS (SELECT 1 FROM sahl_import.cfg_unit3 u WHERE u.sku = m.sku) THEN 3 ELSE 1 END)::int AS qty) q
$$;

CREATE OR REPLACE FUNCTION sahl_import.build() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE rr record; n_ops int;
BEGIN
  TRUNCATE sahl_import.code_map, sahl_import.prod, sahl_import.prod_price, sahl_import.acc, sahl_import.ops RESTART IDENTITY;

  -- products: every (branch, code) seen, latest name; sku = code unless that branch's copy differs (cfg_sku)
  INSERT INTO sahl_import.code_map (branch, code, sku, name)
  SELECT DISTINCT ON (x.branch, x.code) x.branch, x.code, coalesce(s.sku, x.code), x.name
    FROM (
      SELECT r.branch, it->>'رقم الصنف' AS code, btrim(it->>'اسم الصنف') AS name, (r.rec->>'التاريخ')::timestamp AS at
        FROM sahl_import.records r CROSS JOIN LATERAL jsonb_array_elements(r.rec->'items') it
       WHERE r.kind IN ('بيع','شراء','مرتجع بيع','مرتجع شراء')
      UNION ALL
      SELECT r.branch, r.rec->>'رقم الصنف', btrim(r.rec->>'اسم الصنف'), '2026-01-01'::timestamp
        FROM sahl_import.records r WHERE r.kind = 'تقرير بضاعة مخزن'
    ) x LEFT JOIN sahl_import.cfg_sku s ON s.branch = x.branch AND s.code = x.code
   WHERE x.code IS NOT NULL
   ORDER BY x.branch, x.code, x.at DESC;

  INSERT INTO sahl_import.prod (sku, name, unit3)
  SELECT DISTINCT ON (m.sku) m.sku, m.name, EXISTS (SELECT 1 FROM sahl_import.cfg_unit3 u WHERE u.sku = m.sku)
    FROM sahl_import.code_map m
   ORDER BY m.sku, CASE m.branch WHEN 'shalaby' THEN 1 WHEN 'abdelmonem' THEN 2 ELSE 3 END;

  -- selling price per branch: the last sale price of the branch, else the opening count's price
  INSERT INTO sahl_import.prod_price (branch, sku, price)
  SELECT DISTINCT ON (x.branch, x.sku) x.branch, x.sku, x.price
    FROM (
      SELECT r.branch, m.sku, sahl_import.n(it, 'السعر') / CASE WHEN p.unit3 THEN 3 ELSE 1 END AS price, (r.rec->>'التاريخ')::timestamp AS at, 1 AS pr
        FROM sahl_import.records r CROSS JOIN LATERAL jsonb_array_elements(r.rec->'items') it
        JOIN sahl_import.code_map m ON m.branch = r.branch AND m.code = it->>'رقم الصنف'
        JOIN sahl_import.prod p ON p.sku = m.sku
       WHERE r.kind = 'بيع' AND sahl_import.n(it, 'السعر') > 0
      UNION ALL
      SELECT r.branch, m.sku, sahl_import.n(r.rec, 'سعر البيع') / CASE WHEN p.unit3 THEN 3 ELSE 1 END, '2026-01-01', 2
        FROM sahl_import.records r JOIN sahl_import.code_map m ON m.branch = r.branch AND m.code = r.rec->>'رقم الصنف'
        JOIN sahl_import.prod p ON p.sku = m.sku
       WHERE r.kind = 'تقرير بضاعة مخزن' AND sahl_import.n(r.rec, 'سعر البيع') > 0
    ) x ORDER BY x.branch, x.sku, x.pr, x.at DESC;

  -- accounts per branch: the balance files + every account that moved
  INSERT INTO sahl_import.acc (branch, name, opening, nature)
  SELECT r.branch, btrim(r.rec->>'name'), round(sahl_import.n(r.rec, 'od') - sahl_import.n(r.rec, 'oc'), 2), r.rec->>'nature'
    FROM sahl_import.records r WHERE r.kind = 'أرصدة الحسابات بتاريخ سابق'
  ON CONFLICT DO NOTHING;
  INSERT INTO sahl_import.acc (branch, name)
  SELECT DISTINCT r.branch, btrim(r.rec->>'الحساب') FROM sahl_import.records r
   WHERE r.kind IN ('بيع','شراء','مرتجع بيع','مرتجع شراء','قبض','صرف') AND nullif(btrim(r.rec->>'الحساب'), '') IS NOT NULL
  ON CONFLICT DO NOTHING;
  WITH v AS (
    SELECT r.branch, btrim(r.rec->>'الحساب') AS name,
           sum(CASE WHEN r.kind IN ('بيع','مرتجع بيع') THEN abs(sahl_import.n(r.rec, 'النهائى')) ELSE 0 END) AS cust,
           sum(CASE WHEN r.kind IN ('شراء','مرتجع شراء') THEN abs(sahl_import.n(r.rec, 'النهائى')) ELSE 0 END) AS supp
      FROM sahl_import.records r WHERE r.kind IN ('بيع','شراء','مرتجع بيع','مرتجع شراء') GROUP BY 1, 2)
  UPDATE sahl_import.acc a SET
    type = CASE WHEN coalesce(v.cust, 0) > 0 AND coalesce(v.supp, 0) > 0 THEN 'both'
                WHEN coalesce(v.cust, 0) > 0 THEN 'customer' WHEN coalesce(v.supp, 0) > 0 THEN 'supplier'
                WHEN a.nature = 'مورد' THEN 'supplier' ELSE 'customer' END,
    major = CASE WHEN coalesce(v.supp, 0) > coalesce(v.cust, 0) THEN 'supplier'
                 WHEN coalesce(v.cust, 0) > 0 THEN 'customer'
                 WHEN a.nature = 'مورد' THEN 'supplier' ELSE 'customer' END
    FROM (SELECT * FROM sahl_import.acc) a0 LEFT JOIN v ON v.branch = a0.branch AND v.name = a0.name
   WHERE a.branch = a0.branch AND a.name = a0.name;
  UPDATE sahl_import.acc a SET internal_of = CASE
      WHEN a.name = 'المخزن الرئيسي' AND a.branch IN ('abdelmonem', 'sekka') THEN 'shalaby'
      WHEN a.branch = 'shalaby' AND a.name = 'معرض سكة تلة (حساب خاص)' THEN 'sekka'
      WHEN a.branch = 'shalaby' AND a.name = 'معرض عبد المنعم الغربى (حساب خاص)' THEN 'abdelmonem' END;
  UPDATE sahl_import.acc a SET display = CASE
      WHEN EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.name = a.name AND b.branch <> a.branch)
      THEN a.name || ' (' || (SELECT label FROM sahl_import.cfg_branch c WHERE c.branch = a.branch) || ')' ELSE a.name END;

  -- ===== documents =====
  -- sales / purchases of the files
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload)
  SELECT r.branch, (r.rec->>'التاريخ')::date, (r.rec->>'الوقت')::time, CASE WHEN r.kind = 'شراء' THEN 1 ELSE 2 END,
         CASE WHEN r.kind = 'شراء' THEN 'purchase' ELSE 'sale' END, r.kind, (r.rec->>'رقم الفاتورة')::int,
         jsonb_build_object('contact', nullif(btrim(r.rec->>'الحساب'), ''),
           'lines', sahl_import.lines(r.branch, r.rec->'items', r.kind),
           'pays', CASE WHEN EXISTS (SELECT 1 FROM sahl_import.cfg_credit c WHERE c.branch = r.branch AND c.kind = r.kind
                                       AND c.no = (r.rec->>'رقم الفاتورة')::int) THEN '[]'::jsonb ELSE sahl_import.doc_pays(r.rec) END,
           'total', sahl_import.n(r.rec, 'النهائى'), 'credit', sahl_import.n(r.rec, 'الآجل'),
           'notes', 'سهل — ' || (SELECT label FROM sahl_import.cfg_branch c WHERE c.branch = r.branch) || ' — فاتورة '
                    || CASE WHEN r.kind = 'شراء' THEN 'شراء ' ELSE '' END || (r.rec->>'رقم الفاتورة'))
    FROM sahl_import.records r WHERE r.kind IN ('بيع', 'شراء');

  -- returns of the files (on a 2026 invoice in the files → normal return; otherwise → before 2026)
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload)
  SELECT r.branch, (r.rec->>'التاريخ')::date, (r.rec->>'الوقت')::time, 3,
         CASE WHEN r.kind = 'مرتجع بيع' AND orig.found THEN 'sale_return'
              WHEN r.kind = 'مرتجع بيع' THEN 'prior_sale_return'
              WHEN orig.found THEN 'purchase_return' ELSE 'prior_purchase_return' END,
         r.kind, (r.rec->>'رقم الفاتورة')::int,
         jsonb_build_object('contact', nullif(btrim(r.rec->>'الحساب'), ''), 'inv_no', (r.rec->>'الفاتورة المرتجعة')::int,
           'lines', sahl_import.lines(r.branch, r.rec->'items', r.kind),
           'pays', CASE WHEN EXISTS (SELECT 1 FROM sahl_import.cfg_credit c WHERE c.branch = r.branch AND c.kind = r.kind
                                       AND c.no = (r.rec->>'رقم الفاتورة')::int) THEN '[]'::jsonb ELSE sahl_import.doc_pays(r.rec) END,
           'total', abs(sahl_import.n(r.rec, 'النهائى')),
           'notes', 'سهل — ' || (SELECT label FROM sahl_import.cfg_branch c WHERE c.branch = r.branch) || ' — مرتجع '
                    || CASE WHEN r.kind = 'مرتجع شراء' THEN 'شراء ' ELSE '' END || (r.rec->>'رقم الفاتورة')
                    || ' على فاتورة ' || (r.rec->>'الفاتورة المرتجعة'))
    FROM sahl_import.records r
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM sahl_import.records o WHERE o.branch = r.branch
              AND o.kind = CASE WHEN r.kind = 'مرتجع بيع' THEN 'بيع' ELSE 'شراء' END
              AND (o.rec->>'رقم الفاتورة') = (r.rec->>'الفاتورة المرتجعة')) AS found) orig
   WHERE r.kind IN ('مرتجع بيع', 'مرتجع شراء');

  -- vouchers (not transfers, not skipped)
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload)
  SELECT r.branch, (r.rec->>'التاريخ')::date, (r.rec->>'الوقت')::time, 4, 'voucher', r.kind, (r.rec->>'رقم الحركة')::int,
         jsonb_build_object('type', CASE WHEN r.kind = 'قبض' THEN 'receipt' ELSE 'payment' END,
           'contact', nullif(btrim(r.rec->>'الحساب'), ''), 'item', nullif(btrim(r.rec->>'البند'), ''),
           'method', (SELECT t.method FROM sahl_import.cfg_till t WHERE t.name = btrim(r.rec->>'الخزينة')),
           'till', btrim(r.rec->>'الخزينة'),
           'amount', round(sahl_import.n(r.rec, 'القيمة'), 2),
           'notes', concat_ws(' — ', nullif(btrim(r.rec->>'ملاحظات'), ''),
                     'سهل ' || (SELECT label FROM sahl_import.cfg_branch c WHERE c.branch = r.branch) || ' — سند ' || r.kind || ' ' || (r.rec->>'رقم الحركة')))
    FROM sahl_import.records r
   WHERE r.kind IN ('قبض', 'صرف') AND coalesce(r.rec->>'الحركة', '') NOT LIKE 'تحويل%'
     AND NOT EXISTS (SELECT 1 FROM sahl_import.cfg_skip s WHERE s.branch = r.branch AND s.kind = r.kind AND s.no = (r.rec->>'رقم الحركة')::int);

  -- transfers between tills: pair «تحويل من الخزينة» (صرف) with «تحويل إلى الخزينة» (قبض) of the same day and amount
  FOR rr IN
    SELECT o.branch, o.rec AS ro, (o.rec->>'رقم الحركة')::int AS ono
      FROM sahl_import.records o
     WHERE o.kind = 'صرف' AND o.rec->>'الحركة' = 'تحويل من الخزينة'
       AND NOT EXISTS (SELECT 1 FROM sahl_import.cfg_skip s WHERE s.branch = o.branch AND s.kind = 'صرف' AND s.no = (o.rec->>'رقم الحركة')::int)
     ORDER BY o.branch, (o.rec->>'التاريخ'), (o.rec->>'الوقت')
  LOOP
    DECLARE v_in jsonb; v_from text; v_to text;
    BEGIN
      SELECT i.rec INTO v_in FROM sahl_import.records i
       WHERE i.branch = rr.branch AND i.kind = 'قبض' AND i.rec->>'الحركة' = 'تحويل إلى الخزينة'
         AND (i.rec->>'التاريخ') = (rr.ro->>'التاريخ') AND abs(sahl_import.n(i.rec, 'القيمة') - sahl_import.n(rr.ro, 'القيمة')) < 0.01
         AND NOT EXISTS (SELECT 1 FROM sahl_import.ops x WHERE x.branch = rr.branch AND x.kind = 'vtransfer' AND (x.payload->>'in_no')::int = (i.rec->>'رقم الحركة')::int)
         AND NOT EXISTS (SELECT 1 FROM sahl_import.cfg_skip s WHERE s.branch = i.branch AND s.kind = 'قبض' AND s.no = (i.rec->>'رقم الحركة')::int)
       ORDER BY abs(extract(epoch FROM ((i.rec->>'الوقت')::time - (rr.ro->>'الوقت')::time))) LIMIT 1;
      IF v_in IS NULL THEN RAISE EXCEPTION 'build: transfer % (%) has no pair', rr.ono, rr.branch; END IF;
      v_from := (SELECT t.method FROM sahl_import.cfg_till t WHERE t.name = btrim(rr.ro->>'الخزينة'));
      v_to := (SELECT t.method FROM sahl_import.cfg_till t WHERE t.name = btrim(v_in->>'الخزينة'));
      INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload, status)
      VALUES (rr.branch, (rr.ro->>'التاريخ')::date, (rr.ro->>'الوقت')::time, 4, 'vtransfer', 'صرف', rr.ono,
              jsonb_build_object('from', v_from, 'to', v_to, 'amount', round(sahl_import.n(rr.ro, 'القيمة'), 2), 'in_no', (v_in->>'رقم الحركة')::int,
                'notes', concat_ws(' — ', nullif(btrim(rr.ro->>'ملاحظات'), ''), 'سهل ' || (SELECT label FROM sahl_import.cfg_branch c WHERE c.branch = rr.branch)
                         || ' — تحويل ' || rr.ono || ' / ' || (v_in->>'رقم الحركة'))),
              CASE WHEN v_from = v_to THEN 'same_vessel' ELSE 'todo' END);
    END;
  END LOOP;

  -- the decided settlements (rows 6, 9–13)
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, no, payload)
  SELECT s.branch, s.day, '23:59', 5, 'settle', s.row_no,
         jsonb_build_object('contact', s.contact, 'side', s.side, 'direction', s.direction, 'amount', s.amount, 'reason', s.reason)
    FROM sahl_import.cfg_settle s;

  -- Sep / Oct: what شلبى recorded with سكة تلة / عبدالمنعم that the branch did not
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, mirror_of, payload)
  SELECT ci.target, (r.rec->>'التاريخ')::date, (r.rec->>'الوقت')::time,
         CASE ci.op WHEN 'purchase' THEN 1 WHEN 'sale' THEN 2 WHEN 'purchase_return' THEN 3 ELSE 4 END,
         CASE ci.op WHEN 'purchase_return' THEN 'mirror_purchase_return' ELSE ci.op END, r.kind, ci.sha_no,
         CASE WHEN ci.op = 'payment' THEN
           jsonb_build_object('type', 'payment', 'contact', 'المخزن الرئيسي', 'item', NULL,
             'method', (SELECT t.method FROM sahl_import.cfg_till t WHERE t.name = btrim(r.rec->>'الخزينة')),
             'amount', round(sahl_import.n(r.rec, 'القيمة'), 2),
             'notes', 'من سجل شلبى: سند قبض ' || ci.sha_no || ' من الفرع — ما اتسجلش صرف في الفرع' || coalesce(' — ' || nullif(btrim(r.rec->>'ملاحظات'), ''), ''))
         ELSE
           jsonb_build_object('contact', 'المخزن الرئيسي', 'sha_lines', true,
             'lines', sahl_import.lines('shalaby', r.rec->'items', r.kind),
             'pays', '[]'::jsonb, 'total', abs(sahl_import.n(r.rec, 'النهائى')), 'credit', abs(sahl_import.n(r.rec, 'النهائى')),
             'inv_no', (r.rec->>'الفاتورة المرتجعة')::int,
             'notes', 'من سجل شلبى: ' || CASE ci.op WHEN 'purchase' THEN 'فاتورة بيع ' WHEN 'sale' THEN 'فاتورة شراء ' ELSE 'مرتجع بيع ' END
                      || ci.sha_no || ' — ما اتسجلتش في الفرع')
         END
    FROM sahl_import.cfg_inter ci
    JOIN sahl_import.records r ON r.branch = 'shalaby'
     AND r.kind = CASE ci.op WHEN 'purchase' THEN 'بيع' WHEN 'purchase_return' THEN 'مرتجع بيع' WHEN 'sale' THEN 'شراء' ELSE 'قبض' END
     AND (r.rec->>(CASE WHEN ci.op = 'payment' THEN 'رقم الحركة' ELSE 'رقم الفاتورة' END))::int = ci.sha_no;
  UPDATE sahl_import.ops SET kind = 'voucher' WHERE kind = 'payment';

  -- a credit invoice + a voucher of the same account, day and amount = the invoice's own payment (owner decision)
  FOR rr IN SELECT o.* FROM sahl_import.ops o
            WHERE o.kind IN ('sale', 'purchase') AND o.mirror_of IS NULL AND (o.payload->>'credit')::numeric > 0.005
              AND o.payload->>'contact' IS NOT NULL
            ORDER BY o.day, o.tm, o.id LOOP
    DECLARE v record;
    BEGIN
      SELECT x.* INTO v FROM sahl_import.ops x
       WHERE x.branch = rr.branch AND x.kind = 'voucher' AND x.status = 'todo' AND x.mirror_of IS NULL AND x.day = rr.day
         AND x.payload->>'contact' = rr.payload->>'contact'
         AND x.payload->>'type' = CASE WHEN rr.kind = 'sale' THEN 'receipt' ELSE 'payment' END
         AND abs((x.payload->>'amount')::numeric - (rr.payload->>'credit')::numeric) < 0.01
         AND x.payload->>'item' IS NULL
       ORDER BY abs(extract(epoch FROM (coalesce(x.tm, '00:00') - coalesce(rr.tm, '00:00')))), x.id LIMIT 1;
      IF FOUND THEN
        UPDATE sahl_import.ops SET status = 'linked', payload = payload || jsonb_build_object('linked_to', rr.id) WHERE id = v.id;
        UPDATE sahl_import.ops SET payload = jsonb_set(payload, '{pays}', (payload->'pays') || jsonb_build_array(jsonb_build_object(
                 'method', v.payload->>'method', 'amount', (v.payload->>'amount')::numeric, 'voucher', v.no))) WHERE id = rr.id;
      END IF;
    END;
  END LOOP;

  -- عبدالمنعم's returns on old invoices have no «ربح»: they wait for the owner's cost
  UPDATE sahl_import.ops SET status = 'pending_cost' WHERE kind = 'prior_sale_return' AND branch <> 'shalaby';

  SELECT count(*) INTO n_ops FROM sahl_import.ops;
  RETURN jsonb_build_object('products', (SELECT count(*) FROM sahl_import.prod), 'codes', (SELECT count(*) FROM sahl_import.code_map),
    'accounts', (SELECT count(*) FROM sahl_import.acc), 'ops', n_ops,
    'by_kind', (SELECT jsonb_object_agg(k, c) FROM (SELECT kind || ':' || status AS k, count(*) c FROM sahl_import.ops GROUP BY 1) z));
END
$$;

-- same codes that mean two products, and fans sold by the third of a carton (counted per piece)
INSERT INTO sahl_import.cfg_sku (branch, code, sku) VALUES
 ('shalaby','1512','1512-ش'), ('shalaby','1513','1513-ش'), ('shalaby','1514','1514-ش'), ('shalaby','1515','1515-ش'), ('shalaby','1517','1517-ش'),
 ('shalaby','1986','1986-ش'), ('shalaby','1987','1987-ش'), ('shalaby','1988','1988-ش'), ('shalaby','1989','1989-ش'), ('shalaby','1990','1990-ش'),
 ('shalaby','1991','1991-ش'), ('abdelmonem','1985','1985-ع'), ('abdelmonem','1986','1986-ع'), ('abdelmonem','1987','1987-ع'), ('abdelmonem','1989','1989-ع')
ON CONFLICT DO NOTHING;
INSERT INTO sahl_import.cfg_unit3 (sku) VALUES ('1048'), ('1235'), ('1253'), ('1423'), ('143'), ('1478'), ('922') ON CONFLICT DO NOTHING;

-- شلبى's documents with a branch ↔ the branch's own: same amount (±1), the branch 5 days before to 30 days after,
-- nearest day first (the analysis shown to the owner). Unmatched Sep / Oct ones are mirrored in the branch.
CREATE OR REPLACE FUNCTION sahl_import.match_inter() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t record; a record; b record; v_used bigint[]; v_out jsonb := '{}'::jsonb; n_m int; n_un int;
BEGIN
  TRUNCATE sahl_import.cfg_inter, sahl_import.cfg_pair;
  FOR t IN SELECT * FROM (VALUES
      ('sekka','معرض سكة تلة (حساب خاص)','بيع','شراء','النهائى','purchase'),
      ('sekka','معرض سكة تلة (حساب خاص)','مرتجع بيع','مرتجع شراء','النهائى','purchase_return'),
      ('sekka','معرض سكة تلة (حساب خاص)','شراء','بيع','النهائى','sale'),
      ('sekka','معرض سكة تلة (حساب خاص)','قبض','صرف','القيمة','payment'),
      ('abdelmonem','معرض عبد المنعم الغربى (حساب خاص)','بيع','شراء','النهائى','purchase'),
      ('abdelmonem','معرض عبد المنعم الغربى (حساب خاص)','مرتجع بيع','مرتجع شراء','النهائى','purchase_return'),
      ('abdelmonem','معرض عبد المنعم الغربى (حساب خاص)','شراء','بيع','النهائى','sale')) AS v(target, acc, ks, kb, f, op) LOOP
    v_used := '{}'; n_m := 0; n_un := 0;
    FOR a IN SELECT r.* FROM sahl_import.records r
              WHERE r.branch = 'shalaby' AND r.kind = t.ks AND btrim(r.rec->>'الحساب') = t.acc
              ORDER BY r.rec->>'التاريخ', coalesce(r.rec->>'الوقت', ''), r.seq LOOP
      SELECT x.id, x.rec INTO b FROM sahl_import.records x
       WHERE x.branch = t.target AND x.kind = t.kb AND btrim(x.rec->>'الحساب') = 'المخزن الرئيسي' AND NOT (x.id = ANY (v_used))
         AND abs(round(sahl_import.n(x.rec, t.f), 2) - round(sahl_import.n(a.rec, t.f), 2)) <= 1
         AND ((x.rec->>'التاريخ')::date - (a.rec->>'التاريخ')::date) BETWEEN -5 AND 30
       ORDER BY abs((x.rec->>'التاريخ')::date - (a.rec->>'التاريخ')::date), x.seq LIMIT 1;
      IF FOUND THEN
        v_used := v_used || b.id; n_m := n_m + 1;
        IF t.op = 'purchase' THEN
          INSERT INTO sahl_import.cfg_pair VALUES (t.target, (a.rec->>'رقم الفاتورة')::int, (b.rec->>'رقم الفاتورة')::int) ON CONFLICT DO NOTHING;
        END IF;
      ELSIF to_char((a.rec->>'التاريخ')::date, 'YYYY-MM') IN ('2026-09', '2026-10') THEN
        n_un := n_un + 1;
        INSERT INTO sahl_import.cfg_inter VALUES (t.target, t.op,
          (a.rec->>(CASE WHEN t.ks IN ('قبض', 'صرف') THEN 'رقم الحركة' ELSE 'رقم الفاتورة' END))::int) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
    v_out := v_out || jsonb_build_object(t.target || ':' || t.op, jsonb_build_object('matched', n_m, 'mirror', n_un));
  END LOOP;
  RETURN v_out || jsonb_build_object('pairs', (SELECT count(*) FROM sahl_import.cfg_pair));
END
$$;

-- ===== the runner =====
CREATE OR REPLACE FUNCTION sahl_import.ctx() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'sahl_import: owner not found'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.sahl_import', '1', true);
  PERFORM set_config('app.ledger_capture', 'off', true);
  RETURN v_owner;
END $$;

CREATE OR REPLACE FUNCTION sahl_import.bid(p text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT b.id FROM public.branches b JOIN sahl_import.cfg_branch c ON c.code = b.code WHERE c.branch = p $$;
CREATE OR REPLACE FUNCTION sahl_import.pid(p_branch text, p_sku text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT p.id FROM public.products p WHERE p.branch_id = sahl_import.bid(p_branch) AND p.sku = p_sku ORDER BY p.created_at LIMIT 1 $$;
CREATE OR REPLACE FUNCTION sahl_import.cid(p_branch text, p_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT a.contact_id FROM sahl_import.acc a WHERE a.branch = p_branch AND a.name = p_name $$;
CREATE OR REPLACE FUNCTION sahl_import.catid(p_type text, p_old text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT vc.id FROM public.voucher_categories vc JOIN sahl_import.cfg_cat c ON c.type = p_type AND c.old = p_old
   WHERE vc.tenant_id = (SELECT b.tenant_id FROM public.branches b WHERE b.code = 'FR-005') AND vc.type::text = p_type AND vc.name = c.target
   ORDER BY vc.is_active DESC, vc.created_at LIMIT 1 $$;

-- vessels, items, products, accounts, internal tags, opening balances and opening stock
CREATE OR REPLACE FUNCTION sahl_import.run_setup() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_owner uuid := sahl_import.ctx(); v_t uuid; r record; v_res jsonb; v_cont jsonb; v_inv jsonb; n_p int := 0; n_c int := 0;
BEGIN
  SELECT tenant_id INTO v_t FROM public.branches WHERE code = 'FR-005';
  INSERT INTO public.transfer_fees (tenant_id, payment_method, label, kind, fee_type, fee_value, is_enabled)
  SELECT v_t, v.method, v.label, 'wallet', 'fixed', 0, true FROM sahl_import.cfg_vessel v
  ON CONFLICT (tenant_id, payment_method) DO NOTHING;

  INSERT INTO public.voucher_categories (tenant_id, name, type, parent_id, gl_account_code, is_active, is_system,
                                         is_deductible_from_profit, is_added_to_profit)
  SELECT DISTINCT ON (c.type, c.target) v_t, c.target, c.type::voucher_type,
         (SELECT p.id FROM public.voucher_categories p WHERE p.tenant_id = v_t AND p.type::text = c.type AND p.name = c.parent LIMIT 1),
         c.gl, true, false, true, c.type = 'receipt'
    FROM sahl_import.cfg_cat c
   WHERE NOT EXISTS (SELECT 1 FROM public.voucher_categories x WHERE x.tenant_id = v_t AND x.type::text = c.type AND x.name = c.target);

  FOR r IN SELECT p.*, coalesce((SELECT pp.price FROM sahl_import.prod_price pp WHERE pp.branch = 'shalaby' AND pp.sku = p.sku), 0) AS price
             FROM sahl_import.prod p ORDER BY p.sku LOOP
    IF sahl_import.pid('shalaby', r.sku) IS NULL THEN
      PERFORM public.create_product_with_opening_stock(jsonb_build_object('branch_id', sahl_import.bid('shalaby'), 'name', r.name,
        'sku', r.sku, 'cost_price', 0, 'selling_price', r.price, 'market_price', r.price, 'quantity', 0, 'low_stock_alert', 0), '2026-01-01');
      n_p := n_p + 1;
    END IF;
  END LOOP;
  UPDATE public.products p SET selling_price = pp.price, market_price = pp.price
    FROM sahl_import.prod_price pp JOIN sahl_import.cfg_branch c ON c.branch = pp.branch JOIN public.branches b ON b.code = c.code
   WHERE p.branch_id = b.id AND p.sku = pp.sku AND p.selling_price IS DISTINCT FROM pp.price;

  FOR r IN SELECT * FROM sahl_import.acc WHERE contact_id IS NULL ORDER BY branch, name LOOP
    v_res := public.save_contact(NULL, jsonb_build_object('name', r.display, 'type', r.type, 'branch_id', sahl_import.bid(r.branch),
              'notes', 'من سهل — ' || (SELECT label FROM sahl_import.cfg_branch c WHERE c.branch = r.branch)));
    UPDATE sahl_import.acc SET contact_id = (v_res->>'id')::uuid WHERE branch = r.branch AND name = r.name;
    n_c := n_c + 1;
  END LOOP;
  FOR r IN SELECT * FROM sahl_import.acc WHERE internal_of IS NOT NULL LOOP
    PERFORM public.set_contact_internal_branch(r.contact_id, sahl_import.bid(r.internal_of));
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object('contact_id', a.contact_id, 'amount', a.opening)) INTO v_cont
    FROM sahl_import.acc a WHERE abs(a.opening) >= 0.005;
  SELECT jsonb_agg(jsonb_build_object('product_id', sahl_import.pid(r.branch, m.sku),
           'quantity', round(sahl_import.n(r.rec, 'الكمية') * CASE WHEN p.unit3 THEN 3 ELSE 1 END),
           'cost_price', round(sahl_import.n(r.rec, 'سعر الشراء') / CASE WHEN p.unit3 THEN 3 ELSE 1 END, 4)))
    INTO v_inv
    FROM sahl_import.records r JOIN sahl_import.code_map m ON m.branch = r.branch AND m.code = r.rec->>'رقم الصنف'
    JOIN sahl_import.prod p ON p.sku = m.sku
   WHERE r.kind = 'تقرير بضاعة مخزن' AND sahl_import.n(r.rec, 'الكمية') > 0;
  v_res := public.post_opening_balances('2026-01-01', NULL, v_cont, v_inv);
  RETURN jsonb_build_object('products_created', n_p, 'contacts_created', n_c, 'opening', v_res);
END
$$;

-- one document / voucher of the old program, through the system's own write paths
CREATE OR REPLACE FUNCTION sahl_import.do_op(o sahl_import.ops) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  p jsonb := o.payload; v_b uuid := sahl_import.bid(o.branch); v_c uuid; v_items jsonb; v_pays jsonb; v_id uuid; v_res jsonb;
  v_sum numeric; v_paid numeric; v_m text; v_inv uuid; v_ship uuid; l jsonb; pay jsonb; v_side text; v_cat uuid; v_no text;
  v_at timestamptz := ((o.day + coalesce(o.tm, time '12:00')) AT TIME ZONE 'Africa/Cairo');
  v_cash numeric := 0; v_tr numeric := 0; v_bal numeric; v_pr record; v_left numeric; v_take numeric; v_rest jsonb; v_part jsonb;
BEGIN
  IF p->>'contact' IS NOT NULL THEN
    v_c := sahl_import.cid(o.branch, p->>'contact');
    IF v_c IS NULL THEN RAISE EXCEPTION 'account not found: %', p->>'contact'; END IF;
  END IF;

  IF o.kind = 'sale' THEN
    SELECT jsonb_agg(jsonb_build_object('product_id', sahl_import.pid(o.branch, x->>'sku'), 'product_name', pr.name,
             'quantity', (x->>'qty')::int, 'selling_price', (x->>'price')::numeric, 'cost_price', 0,
             'line_discount', (x->>'disc')::numeric, 'market_price', 0)),
           sum((x->>'qty')::int * (x->>'price')::numeric - (x->>'disc')::numeric)
      INTO v_items, v_sum
      FROM jsonb_array_elements(p->'lines') x JOIN sahl_import.prod pr ON pr.sku = x->>'sku';
    SELECT coalesce(jsonb_agg(jsonb_build_object('payment_method', y->>'method', 'amount', (y->>'amount')::numeric,
             'reference_number', 'سهل', 'transfer_from_account', 'سهل', 'transfer_to_account', 'سهل', 'received_by_name', 'سهل')), '[]'::jsonb),
           coalesce(sum((y->>'amount')::numeric), 0)
      INTO v_pays, v_paid FROM jsonb_array_elements(p->'pays') y WHERE (y->>'amount')::numeric > 0;
    v_m := CASE WHEN jsonb_array_length(v_pays) > 0 THEN v_pays->0->>'payment_method' ELSE 'credit' END;
    v_id := public.process_sale_full(v_b, v_c, round(v_sum, 2), 0, 0, NULL, round(v_sum, 2), v_m, v_items, v_pays, 0, 0, o.day,
                                     NULL, p->>'notes', 0, 'سهل');
    SELECT invoice_number INTO v_no FROM public.invoices WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'no', v_no);

  ELSIF o.kind = 'purchase' THEN
    SELECT jsonb_agg(jsonb_build_object('product_id', sahl_import.pid(o.branch, x->>'sku'), 'product_name', pr.name,
             'quantity', (x->>'qty')::int, 'cost_price', (x->>'price')::numeric, 'discount_amount', (x->>'disc')::numeric))
      INTO v_items FROM jsonb_array_elements(p->'lines') x JOIN sahl_import.prod pr ON pr.sku = x->>'sku';
    SELECT coalesce(sum((y->>'amount')::numeric), 0) INTO v_paid FROM jsonb_array_elements(p->'pays') y;
    v_res := public.record_shipment_with_credit(
      jsonb_build_object('branch_id', v_b, 'contact_id', v_c, 'arrival_date', o.day, 'invoice_date', o.day,
                         'received_by', 'سهل', 'notes', p->>'notes'),
      v_items, jsonb_build_object('plan_type', 'open', 'paid_now', v_paid, 'apply_credit', false));
    FOR pay IN SELECT * FROM jsonb_array_elements(p->'pays') LOOP
      CONTINUE WHEN (pay->>'amount')::numeric <= 0;
      PERFORM public.record_payment_transaction((v_res->>'payment_plan_id')::uuid, NULL, (pay->>'amount')::numeric, pay->>'method',
        'سهل', 'سهل', 'سهل', 0, NULL, false, 'out', 'سهل', o.day);
    END LOOP;
    RETURN jsonb_build_object('id', v_res->>'shipment_id', 'no', v_res->>'shipment_number');

  ELSIF o.kind = 'sale_return' THEN
    SELECT new_id INTO v_inv FROM sahl_import.ops WHERE branch = o.branch AND kind = 'sale' AND no = (p->>'inv_no')::int AND mirror_of IS NULL;
    IF v_inv IS NULL THEN RAISE EXCEPTION 'invoice % not imported', p->>'inv_no'; END IF;
    SELECT y->>'method', (y->>'amount')::numeric INTO v_m, v_paid FROM jsonb_array_elements(p->'pays') y LIMIT 1;
    v_paid := coalesce(v_paid, 0);
    -- a line above what is left on its invoice: the rest goes on the latest earlier invoice of the same account
    v_rest := '[]'::jsonb; v_part := '[]'::jsonb;
    FOR l IN SELECT * FROM jsonb_array_elements(p->'lines') LOOP
      SELECT coalesce(sum(ii.quantity - coalesce(ii.returned_quantity, 0)), 0) INTO v_left FROM public.invoice_items ii
       WHERE ii.invoice_id = v_inv AND ii.product_id = sahl_import.pid(o.branch, l->>'sku');
      v_take := least((l->>'qty')::int, greatest(v_left, 0));
      IF v_take > 0 THEN
        v_part := v_part || jsonb_build_object('product_id', sahl_import.pid(o.branch, l->>'sku'), 'quantity', v_take,
                     'refund', round((l->>'net')::numeric * v_take / (l->>'qty')::int, 2));
      END IF;
      IF (l->>'qty')::int > v_take THEN
        v_rest := v_rest || (l || jsonb_build_object('qty', (l->>'qty')::int - v_take,
                     'net', round((l->>'net')::numeric * ((l->>'qty')::int - v_take) / (l->>'qty')::int, 2)));
      END IF;
    END LOOP;
    IF jsonb_array_length(v_part) > 0 THEN
      v_sum := (SELECT sum((e->>'refund')::numeric) FROM jsonb_array_elements(v_part) e);
      v_cash := CASE WHEN v_m = 'cash' THEN least(v_paid, v_sum) ELSE 0 END;
      v_tr := CASE WHEN v_m IS NOT NULL AND v_m <> 'cash' THEN least(v_paid, v_sum) ELSE 0 END;
      PERFORM set_config('app.sahl_split', jsonb_build_object('balance', v_sum - v_cash - v_tr, 'cash', v_cash, 'transfer', v_tr,
                         'method', CASE WHEN v_cash + v_tr > 0 THEN v_m ELSE 'balance' END, 'at', v_at)::text, true);
      v_res := public.register_sale_return_full(v_inv, 'سهل', p->>'notes', 'active', coalesce(v_m, 'balance'), 'سهل', 'سهل',
                                                v_cash, v_tr, v_sum - v_cash - v_tr, v_part);
      PERFORM set_config('app.sahl_split', '', true);
      v_paid := v_paid - v_cash - v_tr;
    END IF;
    FOR l IN SELECT * FROM jsonb_array_elements(v_rest) LOOP
      SELECT i.id INTO v_inv FROM public.invoices i JOIN public.invoice_items ii ON ii.invoice_id = i.id
       WHERE i.branch_id = v_b AND i.contact_id = v_c AND i.status = 'active' AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date <= o.day
         AND ii.product_id = sahl_import.pid(o.branch, l->>'sku')
       GROUP BY i.id, i.invoice_date HAVING sum(ii.quantity - coalesce(ii.returned_quantity, 0)) >= (l->>'qty')::int
       ORDER BY i.invoice_date DESC LIMIT 1;
      IF v_inv IS NULL THEN RAISE EXCEPTION 'return %: % pieces of % have no invoice to go on', o.no, l->>'qty', l->>'sku'; END IF;
      v_cash := CASE WHEN v_m = 'cash' THEN least(v_paid, (l->>'net')::numeric) ELSE 0 END;
      v_tr := CASE WHEN v_m IS NOT NULL AND v_m <> 'cash' THEN least(v_paid, (l->>'net')::numeric) ELSE 0 END;
      PERFORM set_config('app.sahl_split', jsonb_build_object('balance', (l->>'net')::numeric - v_cash - v_tr, 'cash', v_cash, 'transfer', v_tr,
                         'method', CASE WHEN v_cash + v_tr > 0 THEN v_m ELSE 'balance' END, 'at', v_at)::text, true);
      PERFORM public.register_sale_return_full(v_inv, 'سهل', p->>'notes' || ' (الباقي فوق كمية الفاتورة)', 'active', coalesce(v_m, 'balance'),
                'سهل', 'سهل', v_cash, v_tr, (l->>'net')::numeric - v_cash - v_tr,
                jsonb_build_array(jsonb_build_object('product_id', sahl_import.pid(o.branch, l->>'sku'), 'quantity', (l->>'qty')::int, 'refund', (l->>'net')::numeric)));
      PERFORM set_config('app.sahl_split', '', true);
      v_paid := v_paid - v_cash - v_tr;
    END LOOP;
    RETURN jsonb_build_object('id', v_res->>'id', 'no', v_res->>'return_number');

  ELSIF o.kind = 'prior_sale_return' THEN
    SELECT jsonb_agg(jsonb_build_object('product_id', sahl_import.pid(o.branch, x->>'sku'), 'quantity', (x->>'qty')::int,
             'price', round((x->>'net')::numeric / (x->>'qty')::int, 4),
             'cost', greatest(round(((x->>'net')::numeric - coalesce((x->>'profit')::numeric, 0)) / (x->>'qty')::int, 4), 0)))
      INTO v_items FROM jsonb_array_elements(p->'lines') x;
    SELECT y->>'method' INTO v_m FROM jsonb_array_elements(p->'pays') y LIMIT 1;
    v_res := public.record_prior_year_return(v_b, v_c, o.day, v_items, CASE WHEN v_m IS NULL THEN 'account' ELSE 'refund' END,
                                             coalesce(v_m, 'cash'), p->>'notes');
    RETURN jsonb_build_object('id', v_res->>'id', 'no', v_res->>'return_number');

  ELSIF o.kind IN ('purchase_return', 'prior_purchase_return', 'mirror_purchase_return') THEN
    IF o.kind = 'purchase_return' THEN
      SELECT new_id INTO v_ship FROM sahl_import.ops WHERE branch = o.branch AND kind = 'purchase' AND no = (p->>'inv_no')::int AND mirror_of IS NULL;
      IF v_ship IS NULL THEN RAISE EXCEPTION 'purchase % not imported', p->>'inv_no'; END IF;
    ELSIF o.kind = 'mirror_purchase_return' THEN
      SELECT x.new_id INTO v_ship FROM sahl_import.cfg_pair cp
        JOIN sahl_import.ops x ON x.branch = o.branch AND x.kind = 'purchase' AND x.no = cp.br_purch AND x.mirror_of IS NULL
       WHERE cp.target = o.branch AND cp.sha_inv = (p->>'inv_no')::int;
      IF v_ship IS NULL THEN
        SELECT x.new_id INTO v_ship FROM sahl_import.ops x WHERE x.branch = o.branch AND x.kind = 'purchase' AND x.mirror_of = (p->>'inv_no')::int;
      END IF;
    END IF;
    SELECT y->>'method', (y->>'amount')::numeric INTO v_m, v_paid FROM jsonb_array_elements(p->'pays') y LIMIT 1;
    v_paid := coalesce(v_paid, 0);
    v_sum := (SELECT sum((x->>'net')::numeric) FROM jsonb_array_elements(p->'lines') x);
    v_cash := CASE WHEN v_m = 'cash' THEN least(v_paid, v_sum) ELSE 0 END;
    v_tr := CASE WHEN v_m IS NOT NULL AND v_m <> 'cash' THEN least(v_paid, v_sum) ELSE 0 END;
    PERFORM set_config('app.sahl_split', jsonb_build_object('balance', v_sum - v_cash - v_tr, 'cash', v_cash, 'transfer', v_tr,
                       'method', CASE WHEN v_cash + v_tr > 0 THEN v_m ELSE 'balance' END)::text, true);
    -- a line above what is left on its purchase invoice goes without the invoice (like a 2025 one)
    IF v_ship IS NOT NULL AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(p->'lines') x
          WHERE (x->>'qty')::int > (SELECT coalesce(sum(si.quantity), 0) FROM public.shipment_items si WHERE si.shipment_id = v_ship
                                     AND si.product_id = sahl_import.pid(o.branch, x->>'sku'))
                                - (SELECT coalesce(sum(pri.quantity), 0) FROM public.purchase_return_items pri
                                     JOIN public.purchase_returns pr2 ON pr2.id = pri.purchase_return_id
                                    WHERE pr2.shipment_id = v_ship AND pr2.status = 'active' AND pri.product_id = sahl_import.pid(o.branch, x->>'sku'))) THEN
      v_ship := NULL;
    END IF;
    INSERT INTO public.purchase_returns (branch_id, contact_id, shipment_id, reason, notes, created_by, total_amount, status,
      refund_method, refund_reference, refund_account, refund_cash_amount, refund_transfer_amount, refund_balance_amount, invoice_date)
    VALUES (v_b, v_c, v_ship, 'سهل', p->>'notes' || CASE WHEN v_ship IS NULL AND o.kind <> 'purchase_return' THEN ' (فاتورة الشراء مش في 2026)' ELSE '' END,
      auth.uid(), round(v_sum, 2), 'active', coalesce(v_m, 'balance'), 'سهل', 'سهل', v_cash, v_tr, v_sum - v_cash - v_tr, v_at)
    RETURNING * INTO v_pr;
    INSERT INTO public.purchase_return_items (purchase_return_id, product_id, product_name, quantity, unit_cost, total)
    SELECT v_pr.id, sahl_import.pid(o.branch, x->>'sku'), pr.name, (x->>'qty')::int,
           round((x->>'net')::numeric / (x->>'qty')::int, 4), round((x->>'net')::numeric, 2)
      FROM jsonb_array_elements(p->'lines') x JOIN sahl_import.prod pr ON pr.sku = x->>'sku';
    PERFORM set_config('app.sahl_split', '', true);
    SELECT return_number INTO v_no FROM public.purchase_returns WHERE id = v_pr.id;
    RETURN jsonb_build_object('id', v_pr.id, 'no', v_no);

  ELSIF o.kind = 'voucher' THEN
    IF v_c IS NOT NULL THEN
      v_side := (SELECT a.major FROM sahl_import.acc a WHERE a.branch = o.branch AND a.name = p->>'contact');
    END IF;
    v_cat := CASE WHEN p->>'item' IS NOT NULL THEN sahl_import.catid(p->>'type', p->>'item')
                  WHEN v_side IS NOT NULL THEN sahl_import.catid(p->>'type', '#' || v_side) END;
    IF v_cat IS NULL THEN RAISE EXCEPTION 'no item for voucher % (item %, account %)', o.no, p->>'item', p->>'contact'; END IF;
    IF p->>'method' IS NULL THEN RAISE EXCEPTION 'unknown till for voucher %', o.no; END IF;
    v_id := public.create_manual_voucher(v_b, (p->>'type')::voucher_type, v_cat, (p->>'amount')::numeric, p->>'method',
      CASE WHEN p->>'method' = 'cash' THEN NULL ELSE 'سهل' END, CASE WHEN p->>'method' = 'cash' THEN NULL ELSE 'سهل' END, 0,
      v_side::voucher_party_type, v_c, (SELECT a.display FROM sahl_import.acc a WHERE a.branch = o.branch AND a.name = p->>'contact'),
      p->>'notes', o.day, CASE WHEN p->>'method' = 'cash' THEN NULL ELSE 'سهل' END);
    SELECT voucher_number INTO v_no FROM public.vouchers WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'no', v_no);

  ELSIF o.kind = 'vtransfer' THEN
    v_res := to_jsonb(public.transfer_between_vessels(v_b, p->>'from', p->>'to', (p->>'amount')::numeric, 'none', 0, o.day, p->>'notes'));
    RETURN jsonb_build_object('id', NULL, 'no', NULL, 'res', v_res);

  ELSIF o.kind = 'settle' THEN
    v_res := to_jsonb(public.settle_contact_without_money(v_b, v_c, p->>'side', p->>'direction', (p->>'amount')::numeric, o.day, p->>'reason'));
    RETURN jsonb_build_object('id', NULL, 'no', NULL, 'res', v_res);
  END IF;
  RAISE EXCEPTION 'unknown op kind %', o.kind;
END
$$;

-- run the waiting operations in date order up to a day; an error stops the run (p_stop) or is kept on the row
CREATE OR REPLACE FUNCTION sahl_import.run_ops(p_to date, p_stop boolean DEFAULT true, p_limit int DEFAULT 100000)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o sahl_import.ops; v_res jsonb; n_ok int := 0; n_err int := 0; v_t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM sahl_import.ctx();
  FOR o IN SELECT * FROM sahl_import.ops WHERE status = 'todo' AND day <= p_to ORDER BY day, tm NULLS FIRST, ord, id LIMIT p_limit LOOP
    BEGIN
      v_res := sahl_import.do_op(o);
      UPDATE sahl_import.ops SET status = 'done', new_id = nullif(v_res->>'id', '')::uuid, new_no = v_res->>'no', err = NULL, done_at = now()
       WHERE id = o.id;
      n_ok := n_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      IF p_stop THEN RAISE EXCEPTION 'op % (% % % no %): %', o.id, o.branch, o.kind, o.day, o.no, SQLERRM; END IF;
      UPDATE sahl_import.ops SET status = 'error', err = SQLERRM WHERE id = o.id;
      n_err := n_err + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', n_ok, 'errors', n_err, 'seconds', round(extract(epoch FROM clock_timestamp() - v_t0)::numeric, 1),
                            'left', (SELECT count(*) FROM sahl_import.ops WHERE status = 'todo'));
END
$$;
