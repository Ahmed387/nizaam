-- 0189: owner 2026-11-10/11 «وعاء عروض وخصومات ميضفش في الربحية غير لما اختار من التصنيف خصومات وعروض في سندات القبض … يضاف
-- للربحية ولا لا … ابنيها». Profit reads a receipt's CATEGORY (books: its account — 4200 «Other Income» is profit, 3800
-- «Retained Earnings» is not; screens: `is_added_to_profit`), so the choice is two receipt categories of the owner's company:
--   «خصومات وعروض — تضاف للربحية»      → 4200, is_added_to_profit = true
--   «خصومات وعروض — لا تضاف للربحية»   → 3800, is_added_to_profit = false
-- The user picks one when he writes the receipt. No old voucher is touched (the 25 old receipts into the «خصومات / عروض
-- الشركات» vessel under «إيرادات أخرى», 533,810.75, stay in profit until the owner decides about them).
INSERT INTO public.voucher_categories (tenant_id, name, type, parent_id, gl_account_code, is_active, is_system, is_deductible_from_profit, is_added_to_profit)
SELECT b.tenant_id, v.name, 'receipt'::voucher_type, NULL, v.gl, true, false, false, v.add
  FROM public.branches b, (VALUES ('خصومات وعروض — تضاف للربحية', '4200', true), ('خصومات وعروض — لا تضاف للربحية', '3800', false)) AS v(name, gl, add)
 WHERE b.code = 'FR-005'
   AND NOT EXISTS (SELECT 1 FROM public.voucher_categories x WHERE x.tenant_id = b.tenant_id AND x.type = 'receipt' AND x.name = v.name);
