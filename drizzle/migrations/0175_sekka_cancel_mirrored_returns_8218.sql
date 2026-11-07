-- 0175: owner 2026-11-07 «نلغي مرتجعات الشراء الخمسة في سكة … نفذ». شلبى's sale 8218 (27/8, 195,005) billed سكة for
-- 13 items; سكة recorded the same delivery as purchase 683 (120,375) WITHOUT five of them (ثلاجة ميديا 1942,
-- غسالة توشيبا 4, ديب فريزر 292, غسالة زانوسي 1477, غسالة ميديا 1977 = 74,630). شلبى corrected its bill with sale returns
-- 1168 / 1170 / 1172 / 1173 / 1174 on 2–3/9, and the import (rule «9 و10») copied them into سكة as purchase returns
-- PR09489 / PR09490 / PR09492 / PR09493 / PR09494 — returns of goods سكة never had: the items went to −1 and سكة's
-- account with شلبى was 74,630 below شلبى's. They are cancelled through `cancel_purchase_return` (on account, no till
-- row). Dry-run: سكة 1942 / 4 / 1477 / 1977 −1 → 0, 292 1 → 2 (شلبى's 8298 and 8484 to سكة), tills unchanged.
DO $mig$
DECLARE v_owner uuid; r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE code = 'FR-003') THEN RETURN; END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  FOR r IN SELECT pr.id FROM public.purchase_returns pr JOIN public.branches b ON b.id = pr.branch_id
            WHERE b.code = 'FR-003' AND pr.status = 'active'
              AND pr.return_number IN ('PR09489', 'PR09490', 'PR09492', 'PR09493', 'PR09494')
              AND pr.notes LIKE 'من سجل شلبى: مرتجع بيع 11%' LOOP
    PERFORM public.cancel_purchase_return(r.id,
      'المالك 2026-11-07: شلبى رجّعت أصناف فاتورة 8218 اللي ما وصلتش سكة أصلاً (سكة سجّلت 683 من غيرها) — المرتجع ده ملوش وجود في سكة');
  END LOOP;
END
$mig$;
