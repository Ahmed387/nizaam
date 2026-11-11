-- 0186: owner 2026-11-10 «رجّع الافتتاحي للأرصدة والبضاعة بتاريخ 31/12، وبعدها أضيف مستندات 1/1 … ومتكررش … نفذ».
-- The books of شلبى / عبدالمنعم were opened on the END of 1/1/2026 («سهل» balance and stock files dated 1/1) and their documents
-- started on 2/1. The owner's 31/12/2025 files + the January document files prove: balance 31/12 + documents of 1/1 = balance of
-- 1/1 for every account (شلبى 17, عبدالمنعم 2) and every item (34 + 13; item 1703 was already right). So:
--   * contacts' opening = current opening − what the 1/1 documents add (`post_opening_balances`, contacts section re-posted);
--   * stock opening of the 47 changed items = the 31/12 quantity at the 31/12 cost (opening batch edited / created, one
--     `opening_stock_correction` entry per branch: شلبى +329,903.09, عبدالمنعم +61,816.00);
--   * the 80 documents of 1/1 are created through the import's own `sahl_import.do_op` (16 sales, 6 purchases, 6 + 5 returns on
--     2025 invoices, 44 vouchers incl. 8802 = 84,901.23 and 907 = 16,558.08, 3 till transfers). سكة's five purchases of 1/1 were
--     already in the books and are not added again.
-- Result (dry-run = applied): every contact balance and every quantity from 2/1 on is unchanged; tills move by the cash of 1/1
-- (شلبى drawer −99,030, vodafone −24,561.08, instapay +84,801.23, safe/vessels +240,000 from the drawer; عبدالمنعم drawer +5,150,
-- vodafone +16,558.08); tills = GL cash, opening ledger = opening journal, nothing unposted, ledger unexplained 0.
-- Known leftovers: «شركة راش برش» +0.01 (lines of purchase 3436 add up to 6,516.99, «سهل» total 6,516.98); «اسحاق المحبة» shows
-- 115,500 on both sides (return of a 2025 sale credited as his advance while his opening is a debt) — net unchanged 16,760.
-- Data staged in `sahl_import.rebase_raw` (D documents, V vouchers, S stock at 31/12). The first live run used
-- `ledger_sync_contact`; `ledger_sync_safe` (which also posts the GL) was run right after for the same contacts.
CREATE TABLE IF NOT EXISTS sahl_import.rebase_raw (k text PRIMARY KEY, j jsonb NOT NULL, at timestamptz DEFAULT now());
INSERT INTO sahl_import.rebase_raw (k, j) VALUES
('D', $j$[["s","S",6825,0,"22:16:57","ياسر المحمدي",61400,61400,{},[[765,3,0,11550,260.31],[756,3,0,24000,1407.76],[1699,1,0,12350,1064],[1700,1,0,13500,729]]],["s","S",6824,0,"20:04:38","يسري ابو صالح الحواصلية",25800,25800,{},[[63,2,0,25800,-282.27]]],["s","S",6823,0,"19:26:15","معرض سكة تلة (حساب خاص)",50410,50410,{},[[1390,1,0,13500,-4878.75],[1349,1,0,14000,-6990],[971,1,0,13800,0],[1614,1,0,9110,0]]],["s","S",6822,0,"19:21:58","مرعى سعد احمد",16750,0,{"c":16750},[[735,1,25.89,8674.11,-340.89],[756,1,24.11,8075.89,545.15]]],["s","S",6821,0,"19:01:24","معرض سكة تلة (حساب خاص)",134800,134800,{},[[744,1,0,24000,-1795.31],[219,1,0,15300,-59.6],[63,1,0,12900,-161.3],[1708,1,0,12350,0],[1117,1,0,15900,0],[154,1,0,18350,0],[1659,1,0,16500,0],[1514,1,0,19500,-963.8]]],["s","S",6820,0,"18:56:51","معرض سكة تلة (حساب خاص)",171120,171120,{},[[1180,1,0,11640,0],[1638,1,0,6035,0],[1127,1,0,11380,0],[1181,1,0,13830,0],[1562,1,0,10815,0],[1403,1,0,11205,2.25],[1474,1,0,3900,0],[1641,1,0,9600,-600],[1589,1,0,12150,-335],[1668,1,0,10050,-899],[546,1,0,16425,1.7],[1126,1,0,12115,0],[1142,1,0,11200,18.7],[765,1,0,3775,11.77],[1204,1,0,16500,500],[1720,1,0,10500,0]]],["s","S",6912,0,"18:45:32","معرض عبد المنعم الغربى (حساب خاص)",6616.99,6616.99,{},[[1730,1,0,893.29,13.5],[1731,1,0,893.29,13.5],[1732,1,0,926.38,14.0],[1733,1,0,926.38,14.0],[1734,1,0,661.7,10.0],[1735,1,0,661.7,10.0],[1736,2,0,1654.25,25.0]]],["s","S",6819,0,"18:29:46","علاء الراعى",36000,36000,{},[[66,2,0,36000,-89.99]]],["s","S",6818,0,"17:11:26","معرض عبد المنعم الغربى (حساب خاص)",14200,14200,{},[[1113,1,0,14200,85.47]]],["s","S",6817,0,"16:32:52","معرض سكة تلة (حساب خاص)",8800,8800,{},[[735,1,0,8800,-215]]],["s","S",7016,0,"15:49:29","معرض سكة تلة (حساب خاص)",5080,5080,{},[[1053,2,0,600,0],[1143,1,0,3000,0],[1256,1,0,1480,-9]]],["s","S",6816,0,"15:10:12","الرضا جروب",19600,19600,{},[[1264,1,0,10800,90],[735,1,0,8800,-215]]],["s","S",6815,0,"13:45:08","احمد جمال لوكس",5150,5150,{},[[1711,1,0,5150,0]]],["s","P",3393,0,"22:48:57","مايكل ثروت سمالوط",26200,26200,{},[[63,2,0,0,26200]]],["s","P",3392,0,"19:10:26","حسن علاء ابوضيف",25800,25800,{},[[63,2,0,0,25800]]],["s","P",3436,0,"18:41:07","شركة راش برش",6516.98,6516.98,{},[[1730,1,13.5,0,879.79],[1731,1,13.5,0,879.79],[1732,1,14.0,0,912.38],[1733,1,14.0,0,912.38],[1734,1,10.0,0,651.7],[1735,1,10.0,0,651.7],[1736,2,25.0,0,1629.25]]],["s","SR",474,6695,"21:26:15","اسحاق المحبة",-115500,-115500,{},[[765,30,0,-115500,-2603.11]]],["s","SR",473,6579,"19:21:20","معرض عبد المنعم الغربى (حساب خاص)",-9110,-9110,{},[[1614,1,0,-9110,0]]],["s","SR",472,6162,"19:18:35","معرض عبد المنعم الغربى (حساب خاص)",-20990,-20990,{},[[1349,1,0,-20990,0]]],["s","SR",471,6811,"19:17:02","معرض عبد المنعم الغربى (حساب خاص)",-14500,-14500,{},[[1390,1,0,-14500,3878.75]]],["s","SR",538,6246,"18:05:23","معرض عبد المنعم الغربى (حساب خاص)",-14000,-14000,{},[[971,1,0,-14000,-200]]],["s","SR",470,6792,"13:44:09","معرض عبد المنعم الغربى (حساب خاص)",-5150,-5150,{},[[1711,1,0,-5150,0]]],["a","S",768,0,"21:39:06","احمد محمد محمد",15000,0,{"c":15000},[[1113,1,0,15000,800]]],["a","S",766,0,"19:54:31","مجدى محمد حافظ",4750,4750,{},[[1118,1,250,4750,317]]],["a","S",767,0,"19:21:01","المهندس ناصر",8400,0,{"c":8400},[[469,1,0,8400,300]]],["a","P",318,0,"19:29:07","مورد عام",8000,0,{"c":8000},[[469,1,0,0,8000]]],["a","P",337,0,"18:45:03","المخزن الرئيسي",6616.99,6616.99,{},[[1730,1,0,0,893.29],[1731,1,0,0,893.29],[1732,1,0,0,926.38],[1733,1,0,0,926.38],[1734,1,0,0,661.7],[1735,1,0,0,661.7],[1736,2,0,0,1654.25]]],["a","P",319,0,"17:11:05","المخزن الرئيسي",14200,14200,{},[[1113,1,0,0,14200]]],["a","PR",289,277,"19:21:07","المخزن الرئيسي",-9110,-9110,{},[[1614,1,0,0,-9110]]],["a","PR",288,186,"19:18:22","المخزن الرئيسي",-20990,-20990,{},[[1349,1,0,0,-20990]]],["a","PR",287,317,"19:17:17","المخزن الرئيسي",-14500,-14500,{},[[1390,1,0,0,-14500]]],["a","PR",323,209,"18:05:41","المخزن الرئيسي",-14000,-14000,{},[[971,1,0,0,-14000]]],["a","PR",286,313,"13:44:18","المخزن الرئيسي",-5150,-5150,{},[[1711,1,0,0,-5150]]]]$j$),
('V', $j$[["s","R",7367,"22:44:26",0,20000,"","البيت (الحاج ناصر)","فودافون كاش","ايجار معرض عبدالمنعم عن شهر 1/2026"],["s","R",7073,"21:01:28",0,3000,"","محمد طه المحاسب","درج النقدية","سداد"],["s","R",7071,"20:02:36",0,50000,"","يسري ابو صالح الحواصلية","درج النقدية",""],["s","R",7070,"18:34:16",0,123,"عمولة بنك / فودافون كاش","","فودافون كاش","عمولة فودافون كاش 1500 + 5000 + 5800 علاء الراعي"],["s","R",8802,"18:31:05",0,84901.23,"","معرض عبد المنعم الغربى (حساب خاص)","انستاباي / ح البنك الاهلي للشركة","تصفير الخزينة مع المخزن"],["s","R",7069,"18:27:05",0,5742,"","علاء الراعى","فودافون كاش","خط رقم 2"],["s","R",7067,"13:58:54",0,4950,"","علاء الراعى","فودافون كاش","خط رقم 2 خصم 1% عمولة"],["s","R",7066,"13:57:42",0,1485,"","علاء الراعى","فودافون كاش","خط رقم 2 خصم 1% عمولة"],["s","R",7065,"13:51:13",1,40000,"","","الخزينة",""],["s","R",7064,"13:50:44",1,200000,"","","الخزينة",""],["s","R",7062,"13:47:23",0,43850,"","احمد جمال لوكس","درج النقدية",""],["s","R",7061,"13:46:56",0,9200,"","مدحت طوخ","فودافون كاش","علي خط محمود علاء"],["s","R",7058,"13:45:51",0,35400,"","ياسر المحمدي","درج النقدية",""],["s","R",8277,"00:18:40",1,2190000,"","","خصومات / عروض الشركات","تم سحبها من راس المال الحاج ناصر (لشراء عقار )"],["s","Y",10913,"23:06:35",0,300,"12- رواتب العمال","","درج النقدية","سلفة محمد هيثم العامل"],["s","Y",10910,"22:51:49",0,650,"2- (النقل) عربية ربع نقل","","درج النقدية","عم بكر مشوار سمالوط"],["s","Y",13214,"22:42:31",0,20000,"","معرض عبد المنعم الغربى (حساب خاص)","فودافون كاش","الايجار"],["s","Y",10909,"22:13:44",0,50,"9- اكراميات العمال","","درج النقدية","عامل شنودة"],["s","Y",10908,"21:39:42",0,1,"24-عمولة بنك / فودافون كاش","","فودافون كاش","عمولة تحويل 10000 ج حسن علاء خط رقم 1"],["s","Y",10907,"21:38:40",0,1,"24-عمولة بنك / فودافون كاش","","فودافون كاش","مصاريف تحويل 7000 م / احمد ناصر"],["s","Y",10906,"21:38:02",0,7000,"","البيت (الحاج ناصر)","فودافون كاش","مصاريف محاماة (الشقة)"],["s","Y",10901,"20:41:11",0,1,"24-عمولة بنك / فودافون كاش","","فودافون كاش","عمولة تحويل 12500 محمود سعد خط رقم 1"],["s","Y",10899,"20:14:29",0,60,"6- اكل","","درج النقدية","العاملين"],["s","Y",10897,"19:48:16",0,1890,"","أ/ محمود علاء ابوضيف","درج النقدية","سلفة"],["s","Y",10896,"19:47:43",0,550,"","التشطيبات","درج النقدية","فرق كهرباء"],["s","Y",10895,"19:47:21",0,80,"","التشطيبات","درج النقدية","بلاستر"],["s","Y",10894,"19:46:53",0,100,"6- اكل","التشطيبات","درج النقدية","اكل للعمال"],["s","Y",10893,"19:46:26",0,100,"4- بنزين تروسيكل","","درج النقدية",""],["s","Y",10892,"19:45:31",0,95,"","التشطيبات","درج النقدية","مسامير وفيشر"],["s","Y",10890,"19:43:48",0,20,"","التشطيبات","درج النقدية","غراء"],["s","Y",10889,"19:43:06",0,130,"","التشطيبات","درج النقدية","ادوات نظافة"],["s","Y",10888,"19:42:35",0,35,"","التشطيبات","درج النقدية","فوط"],["s","Y",10887,"19:42:12",0,100,"6- اكل","التشطيبات","درج النقدية","فطار للعمال"],["s","Y",10886,"19:41:26",0,50,"","التشطيبات","درج النقدية","حوامل"],["s","Y",10885,"19:40:57",0,20,"","التشطيبات","درج النقدية","ورد"],["s","Y",10884,"19:40:30",0,2450,"","التشطيبات","درج النقدية","طلبات كهرباء برضه"],["s","Y",10883,"19:39:41",0,1350,"","التشطيبات","درج النقدية","طلبات كهرباء بيد محمود"],["s","Y",10882,"19:34:28",0,12500,"","محمود سعد صفط","فودافون كاش","خط رم 1"],["s","Y",10881,"19:33:56",0,10000,"","حسن علاء ابوضيف","فودافون كاش","خط رقم1"],["s","Y",11206,"18:16:09",0,100,"24-عمولة بنك / فودافون كاش","","انستاباي / ح البنك الاهلي للشركة","مصاريف كشف حساب بنكي"],["s","Y",10875,"13:51:13",1,40000,"","","درج النقدية",""],["s","Y",10874,"13:50:44",1,200000,"","","درج النقدية",""],["s","Y",13213,"13:34:01",0,16558.08,"","معرض عبد المنعم الغربى (حساب خاص)","فودافون كاش","تسوية الخزينة وتصفيرها"],["s","Y",12429,"00:18:40",1,2190000,"","","الخزينة","تم سحبها من راس المال الحاج ناصر (لشراء عقار )"],["a","R",903,"22:42:59",0,20000,"","المخزن الرئيسي","فودافون كاش","الايجار"],["a","R",907,"16:33:04",0,16558.08,"","المخزن الرئيسي","فودافون كاش","تسوية الخزينة و تصفيرها"],["a","Y",1297,"22:43:23",0,20000,"15-ايجارات","","فودافون كاش","ايجار المعرض عن شهر 1/2026"],["a","Y",1167,"21:47:25",0,10000,"","المخزن الرئيسي","درج النقدية","تحويل من المعرض اليء المخزن الرئيسي وتم استلامها م/احمد ناصر"],["a","Y",1166,"21:40:45",0,200,"2- توكتوك","","درج النقدية","اجرة توكتوك ديب كريازي"],["a","Y",1163,"21:22:01",0,50,"2- توكتوك","","درج النقدية","اجرة توكتوك الديب"]]$j$),
('S', '[["s",63,15,13061.3],["s",66,5,18044.993],["s",154,2,18350],["s",219,2,15359.6],["s",546,2,16423.3],["s",735,10,9015],["s",744,1,25795.31],["s",756,108,7530.747],["s",765,25,3763.23],["s",1053,2,300],["s",1113,2,14114.533],["s",1117,2,15900],["s",1126,2,12115],["s",1127,4,11380],["s",1142,2,11181.3],["s",1143,1,3000],["s",1180,3,11640],["s",1181,3,13830],["s",1204,1,16000],["s",1256,9,1489],["s",1264,1,10710],["s",1403,2,11202.75],["s",1474,4,3900],["s",1514,1,20463.8],["s",1562,3,10815],["s",1589,1,12485],["s",1638,1,6035],["s",1641,1,10200],["s",1659,2,16500],["s",1668,3,10949],["s",1699,13,11286],["s",1700,8,12771],["s",1708,6,12350],["s",1720,2,10500],["a",971,1,14000],["a",1118,2,4433],["a",1349,1,20990],["a",1390,1,14750],["a",1614,1,9110],["a",1711,1,5150],["a",1730,0,0],["a",1731,0,0],["a",1732,0,0],["a",1733,0,0],["a",1734,0,0],["a",1735,0,0],["a",1736,0,0]]')
ON CONFLICT (k) DO NOTHING;

CREATE OR REPLACE FUNCTION sahl_import.rebase_0101(p_apply boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $d$
DECLARE
  D jsonb := (SELECT j FROM sahl_import.rebase_raw WHERE k = 'D'); V jsonb := (SELECT j FROM sahl_import.rebase_raw WHERE k = 'V'); S jsonb := (SELECT j FROM sahl_import.rebase_raw WHERE k = 'S');
  v_owner uuid := sahl_import.ctx(); v_t uuid; o sahl_import.ops; v_res jsonb; x jsonb; r record; v_ids bigint[] := '{}'; v_id bigint;
  v_cont jsonb; v_val numeric; v_pid uuid; v_b uuid; v_bt record; v_key uuid; n_ok int := 0; v_msg text := ''; v_pids uuid[]; v_cids uuid[];
  v_at timestamptz := ('2026-01-01'::date + time '00:00') AT TIME ZONE 'Africa/Cairo'; v_old numeric; v_dq int; br text; v_m jsonb := '{"c":"cash","i":"instapay","j":"instapay","v":"vodafone","p":"paymob"}';
BEGIN
  SELECT tenant_id INTO v_t FROM public.branches WHERE code = 'FR-005';
  IF EXISTS (SELECT 1 FROM sahl_import.ops WHERE day = '2026-01-01' AND branch IN ('shalaby','abdelmonem') AND kind IN ('sale','voucher')) THEN RAISE EXCEPTION 'already done'; END IF;

  -- ===== items of the 1/1 documents that had no code / no product row in the branch =====
  INSERT INTO sahl_import.prod (sku, name, unit3) VALUES
    ('1264', 'بوتاجاز ريال تك دراجون غرف 60*90سم غرف مروحة كاست كود 902304', false),
    ('1711', 'مبرد مياه 3 حنفية كابينة اسود شبح FW-16VCB2', false),
    ('469', 'ديب فريزر الاسكا أفقي 135 لتر - ST لون ابيض CH140', false)
  ON CONFLICT DO NOTHING;
  FOR r IN SELECT DISTINCT CASE x2->>0 WHEN 's' THEN 'shalaby' ELSE 'abdelmonem' END AS b, it->>0 AS code
             FROM jsonb_array_elements(D) x2, jsonb_array_elements(x2->9) it LOOP
    IF NOT EXISTS (SELECT 1 FROM sahl_import.code_map m WHERE m.branch = r.b AND m.code = r.code) THEN
      INSERT INTO sahl_import.code_map (branch, code, sku, name) SELECT r.b, r.code, p.sku, p.name FROM sahl_import.prod p WHERE p.sku = r.code;
      IF NOT FOUND THEN RAISE EXCEPTION 'item % has no product', r.code; END IF;
    END IF;
    IF sahl_import.pid(r.b, (SELECT m.sku FROM sahl_import.code_map m WHERE m.branch = r.b AND m.code = r.code)) IS NULL THEN
      PERFORM public.create_product_with_opening_stock(jsonb_build_object('branch_id', sahl_import.bid(r.b),
        'name', (SELECT p.name FROM sahl_import.prod p WHERE p.sku = r.code), 'sku', r.code, 'cost_price', 0, 'selling_price', 0,
        'market_price', 0, 'quantity', 0, 'low_stock_alert', 0), '2026-01-01');
      v_msg := v_msg || 'product created: ' || r.b || ' ' || r.code || E'\n';
    END IF;
  END LOOP;

  -- ===== ops of 1/1 =====
  FOR x IN SELECT * FROM jsonb_array_elements(D) LOOP
    br := CASE x->>0 WHEN 's' THEN 'shalaby' ELSE 'abdelmonem' END;
    INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload)
    SELECT br, '2026-01-01', (x->>4)::time, CASE x->>1 WHEN 'P' THEN 1 WHEN 'S' THEN 2 ELSE 3 END,
           CASE x->>1 WHEN 'S' THEN 'sale' WHEN 'P' THEN 'purchase' WHEN 'SR' THEN 'prior_sale_return' ELSE 'prior_purchase_return' END,
           k.ar, (x->>2)::int,
           jsonb_build_object('contact', x->>5,
             'lines', sahl_import.lines(br, (SELECT jsonb_agg(jsonb_build_object('رقم الصنف', it->>0, 'كمية', it->1, 'الخصم', it->2,
                         'النهائى', CASE WHEN x->>1 IN ('P','PR') THEN it->4 ELSE it->3 END,
                         'ربح', CASE WHEN x->>1 IN ('S','SR') THEN it->4 END)) FROM jsonb_array_elements(x->9) it), k.ar),
             'pays', (SELECT coalesce(jsonb_agg(jsonb_build_object('method', v_m->>t.key, 'amount', abs(t.value::numeric))), '[]'::jsonb) FROM jsonb_each_text(x->8) t),
             'total', abs((x->>6)::numeric), 'credit', (x->>7)::numeric)
           || CASE WHEN x->>1 IN ('SR','PR') THEN jsonb_build_object('inv_no', (x->>3)::int) ELSE '{}'::jsonb END
           || jsonb_build_object('notes', 'سهل — ' || c.label || ' — ' || CASE x->>1 WHEN 'S' THEN 'فاتورة ' WHEN 'P' THEN 'فاتورة شراء ' WHEN 'SR' THEN 'مرتجع ' ELSE 'مرتجع شراء ' END || (x->>2)
                      || CASE WHEN x->>1 IN ('SR','PR') THEN ' على فاتورة ' || (x->>3) ELSE '' END)
      FROM (SELECT CASE x->>1 WHEN 'S' THEN 'بيع' WHEN 'P' THEN 'شراء' WHEN 'SR' THEN 'مرتجع بيع' ELSE 'مرتجع شراء' END AS ar) k,
           sahl_import.cfg_branch c WHERE c.branch = br
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(V) LOOP
    br := CASE x->>0 WHEN 's' THEN 'shalaby' ELSE 'abdelmonem' END;
    IF (x->>4)::int = 0 THEN
      INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload)
      SELECT br, '2026-01-01', (x->>3)::time, 4, 'voucher', CASE x->>1 WHEN 'R' THEN 'قبض' ELSE 'صرف' END, (x->>2)::int,
             jsonb_build_object('type', CASE x->>1 WHEN 'R' THEN 'receipt' ELSE 'payment' END, 'contact', nullif(x->>7, ''), 'item', nullif(x->>6, ''),
               'method', (SELECT t.method FROM sahl_import.cfg_till t WHERE t.name = x->>8), 'till', x->>8, 'amount', (x->>5)::numeric,
               'notes', concat_ws(' — ', nullif(x->>9, ''), 'سهل ' || c.label || ' — سند ' || CASE x->>1 WHEN 'R' THEN 'قبض' ELSE 'صرف' END || ' ' || (x->>2)))
        FROM sahl_import.cfg_branch c WHERE c.branch = br
      RETURNING id INTO v_id;
      v_ids := v_ids || v_id;
    ELSIF x->>1 = 'Y' THEN
      INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload)
      SELECT br, '2026-01-01', (x->>3)::time, 4, 'vtransfer', 'صرف', (x->>2)::int,
             jsonb_build_object('from', (SELECT t.method FROM sahl_import.cfg_till t WHERE t.name = x->>8),
               'to', (SELECT t.method FROM sahl_import.cfg_till t WHERE t.name = i->>8), 'amount', (x->>5)::numeric, 'in_no', (i->>2)::int,
               'notes', concat_ws(' — ', nullif(x->>9, ''), 'سهل ' || c.label || ' — تحويل ' || (x->>2) || ' / ' || (i->>2)))
        FROM sahl_import.cfg_branch c, jsonb_array_elements(V) i
       WHERE c.branch = br AND i->>0 = x->>0 AND i->>1 = 'R' AND (i->>4)::int = 1 AND i->>3 = x->>3 AND i->>5 = x->>5
      RETURNING id INTO v_id;
      v_ids := v_ids || v_id;
    END IF;
  END LOOP;

  -- ===== snapshots before =====
  SELECT array_agg(DISTINCT sahl_import.cid(branch, payload->>'contact')) INTO v_cids FROM sahl_import.ops WHERE id = ANY (v_ids) AND payload->>'contact' IS NOT NULL;
  SELECT array_agg(DISTINCT sahl_import.pid(o2.branch, l->>'sku')) INTO v_pids FROM sahl_import.ops o2, jsonb_array_elements(o2.payload->'lines') l WHERE o2.id = ANY (v_ids);
  IF array_position(v_cids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'accounts not found: %', (SELECT string_agg(DISTINCT branch || ':' || (payload->>'contact'), ', ') FROM sahl_import.ops WHERE id = ANY (v_ids) AND payload->>'contact' IS NOT NULL AND sahl_import.cid(branch, payload->>'contact') IS NULL);
  END IF;
  IF array_position(v_pids, NULL) IS NOT NULL OR EXISTS (SELECT 1 FROM public.products WHERE id = ANY (v_pids) AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'products missing or archived'; END IF;
  CREATE TEMP TABLE _cb ON COMMIT DROP AS SELECT * FROM public.contact_side_balances(v_cids, NULL);
  CREATE TEMP TABLE _pb ON COMMIT DROP AS SELECT id, quantity, avg_cost FROM public.products WHERE id = ANY (v_pids);
  CREATE TEMP TABLE _wb ON COMMIT DROP AS SELECT b.code, to_jsonb(w) w FROM public.branches b, LATERAL public.get_branch_wallet_balances(b.id) w WHERE b.code IN ('FR-004','FR-005');

  -- ===== contacts' opening: back to 31/12 (opening − what the 1/1 documents add) =====
  CREATE TEMP TABLE _dl ON COMMIT DROP AS
    SELECT sahl_import.cid(o2.branch, o2.payload->>'contact') cid,
           sum(CASE o2.kind WHEN 'sale' THEN (o2.payload->>'credit')::numeric WHEN 'prior_sale_return' THEN (o2.payload->>'credit')::numeric
                            WHEN 'purchase' THEN -(o2.payload->>'credit')::numeric WHEN 'prior_purchase_return' THEN -(o2.payload->>'credit')::numeric
                            WHEN 'voucher' THEN CASE o2.payload->>'type' WHEN 'receipt' THEN -(o2.payload->>'amount')::numeric ELSE (o2.payload->>'amount')::numeric END END) d
      FROM sahl_import.ops o2 WHERE o2.id = ANY (v_ids) AND o2.payload->>'contact' IS NOT NULL GROUP BY 1;
  SELECT jsonb_agg(jsonb_build_object('contact_id', c.id, 'amount', round(coalesce(c.opening_balance, 0) - coalesce(dl.d, 0), 2))) INTO v_cont
    FROM public.contacts c LEFT JOIN _dl dl ON dl.cid = c.id
   WHERE c.tenant_id = v_t AND (coalesce(c.opening_balance, 0) <> 0 OR coalesce(dl.d, 0) <> 0);
  v_res := public.post_opening_balances('2026-01-01', NULL, v_cont, NULL);
  v_msg := v_msg || 'opening contacts: ' || v_res::text || E'\n';

  -- ===== stock opening: back to 31/12 =====
  FOR br IN SELECT unnest(ARRAY['shalaby','abdelmonem']) LOOP
    v_val := 0; v_b := sahl_import.bid(br); v_key := gen_random_uuid();
    FOR x IN SELECT * FROM jsonb_array_elements(S) WHERE (value->>0) = left(br, 1) LOOP
      v_pid := sahl_import.pid(br, (SELECT m.sku FROM sahl_import.code_map m WHERE m.branch = br AND m.code = x->>1));
      IF v_pid IS NULL THEN RAISE EXCEPTION 'stock item % % not found', br, x->>1; END IF;
      IF EXISTS (SELECT 1 FROM sahl_import.cfg_unit3 u JOIN public.products p ON p.sku = u.sku WHERE p.id = v_pid) THEN RAISE EXCEPTION 'unit3 item in list'; END IF;
      v_bt := NULL;
      SELECT b.id, b.quantity_purchased q, b.cost_price c INTO v_bt FROM public.product_batches b WHERE b.product_id = v_pid AND b.batch_type = 'opening' ORDER BY b.created_at LIMIT 1;
      v_old := coalesce(v_bt.q, 0);
      v_dq := (x->>2)::int - v_old::int;
      IF v_bt.id IS NOT NULL THEN
        UPDATE public.product_batches SET quantity_purchased = (x->>2)::int, quantity_remaining = greatest(quantity_remaining + v_dq, 0),
               cost_price = CASE WHEN (x->>2)::int > 0 THEN round((x->>3)::numeric, 2) ELSE cost_price END,
               base_purchase_price = CASE WHEN (x->>2)::int > 0 THEN round((x->>3)::numeric, 2) ELSE base_purchase_price END,
               true_unit_cost = CASE WHEN (x->>2)::int > 0 THEN round((x->>3)::numeric, 2) ELSE true_unit_cost END
         WHERE id = v_bt.id;
        v_val := v_val + (x->>2)::int * round((x->>3)::numeric, 2) - v_old * v_bt.c;
      ELSE
        INSERT INTO public.product_batches (tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining, cost_price,
                                            base_purchase_price, shipping_cost_per_unit, true_unit_cost, batch_type, effective_at)
        VALUES (v_t, v_b, v_pid, (x->>2)::int, 0, round((x->>3)::numeric, 2), round((x->>3)::numeric, 2), 0, round((x->>3)::numeric, 2), 'opening', v_at)
        RETURNING id, 0::numeric, 0::numeric INTO v_bt;
        v_val := v_val + (x->>2)::int * round((x->>3)::numeric, 2);
      END IF;
      PERFORM public.stock_mv_ctx('adjustment', 'opening_balance', v_bt.id, v_pid, v_at);
      UPDATE public.products SET quantity = quantity + v_dq WHERE id = v_pid;
    END LOOP;
    v_val := round(v_val, 2);
    IF v_val <> 0 THEN
      PERFORM public.post_journal(v_t, '2026-01-01', 'تصحيح رصيد افتتاحي — مخزون ' || (SELECT label FROM sahl_import.cfg_branch WHERE branch = br) || ': رجوع لجرد 31/12/2025 (مستندات 1/1 اتسجلت)',
        'opening_stock_correction', v_key,
        jsonb_build_array(jsonb_build_object('account_code', '1300', 'debit', greatest(v_val, 0), 'credit', greatest(-v_val, 0), 'description', 'تصحيح رصيد افتتاحي - مخزون'),
                          jsonb_build_object('account_code', '3950', 'debit', greatest(-v_val, 0), 'credit', greatest(v_val, 0), 'description', 'تصحيح رصيد افتتاحي - مخزون')));
    END IF;
    v_msg := v_msg || 'opening stock ' || br || ': ' || v_val || E'\n';
  END LOOP;

  -- ===== run the 1/1 documents =====
  FOR o IN SELECT * FROM sahl_import.ops WHERE id = ANY (v_ids) AND status = 'todo' ORDER BY tm NULLS FIRST, ord, id LOOP
    BEGIN
      v_res := sahl_import.do_op(o);
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'op % % no %: %', o.branch, o.kind, o.no, SQLERRM; END;
    UPDATE sahl_import.ops SET status = 'done', new_id = nullif(v_res->>'id', '')::uuid, new_no = v_res->>'no', done_at = now() WHERE id = o.id;
    n_ok := n_ok + 1;
  END LOOP;
  v_msg := v_msg || 'ops done: ' || n_ok || ' of ' || cardinality(v_ids) || E'\n';

  -- ===== finish: ledgers, costs =====
  FOR r IN SELECT unnest(v_cids) AS c LOOP PERFORM public.ledger_sync_safe(r.c, NULL, 'rebase_0101'); END LOOP;
  PERFORM public.recost_product_sales(v_pids, '2026-01-01 00:00+02');
  UPDATE public.products SET cost_price = round(avg_cost, 2) WHERE id = ANY (v_pids) AND coalesce(avg_cost, 0) > 0 AND cost_price IS DISTINCT FROM round(avg_cost, 2);

  -- ===== report =====
  v_msg := v_msg || 'contacts whose balance moved: ' || coalesce((SELECT string_agg(c.name || ' c ' || coalesce(b.customer_balance,0) || '→' || coalesce(a.customer_balance,0) || ' s ' || coalesce(b.supplier_balance,0) || '→' || coalesce(a.supplier_balance,0), ' ; ')
      FROM _cb b JOIN public.contact_side_balances(v_cids, NULL) a ON a.contact_id = b.contact_id JOIN public.contacts c ON c.id = b.contact_id
     WHERE (coalesce(a.customer_balance,0) - coalesce(a.supplier_balance,0)) <> (coalesce(b.customer_balance,0) - coalesce(b.supplier_balance,0))), 'none') || E'\n';
  v_msg := v_msg || 'products whose quantity moved: ' || coalesce((SELECT string_agg(p.sku || ' ' || b.quantity || '→' || p.quantity, ' ; ') FROM _pb b JOIN public.products p ON p.id = b.id WHERE p.quantity <> b.quantity), 'none') || E'\n';
  v_msg := v_msg || 'wallets before: ' || (SELECT string_agg(code || ' ' || w::text, ' | ') FROM _wb) || E'\n';
  v_msg := v_msg || 'wallets after: ' || (SELECT string_agg(b.code || ' ' || to_jsonb(w)::text, ' | ') FROM public.branches b, LATERAL public.get_branch_wallet_balances(b.id) w WHERE b.code IN ('FR-004','FR-005')) || E'\n';
  v_msg := v_msg || 'gl: ' || (SELECT jsonb_build_object('opening', g->'opening', 'branches', g->'branches', 'cust_adv', g->'customer_advances', 'sup_adv', g->'supplier_advances', 'not_posted', g->'not_posted')::text FROM (SELECT to_jsonb(z) g FROM public.ledger_gl_reconciliation() z) q) || E'\n';
  v_msg := v_msg || 'ledger unexplained: ' || (SELECT coalesce(sum(abs(unexplained)), 0) FROM public.ledger_reconciliation());
  IF NOT p_apply THEN RAISE EXCEPTION E'DRY\n%', v_msg; END IF;
  RETURN v_msg;
END $d$;
REVOKE ALL ON FUNCTION sahl_import.rebase_0101(boolean) FROM PUBLIC, anon, authenticated;

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sahl_import.ops WHERE day = '2026-01-01' AND branch IN ('shalaby', 'abdelmonem') AND kind IN ('sale', 'voucher')) THEN
    PERFORM sahl_import.rebase_0101(true);
  END IF;
END
$mig$;
