-- 0125: «تحويل الى الخزينة (نظام قديم)» is an internal move of money, not income / expense (owner «موافق», 2026-10-28)
--
-- 80 receipt vouchers (684,627.39) were posted Dr 1100 / Cr 4200 «Other Income» and 53 payment vouchers (413,563.00)
-- Dr 5500 «Operating Expenses» / Cr 1100: the books' profit carried +271,064.39 that is money moved between the old
-- system and the tills (e.g. RV-1158 100,000 «تحويل الي ا/فادي… سلفة علاء ضيف»). The card «هل بنكسب؟» never counted
-- them. Now both sides go to a clearing account 1950 «تحويلات النظام القديم (حساب وسيط)»: profit is untouched by
-- them, the tills (1100) stay exactly as they were, and 1950 shows what came in / went out through the old system.
-- Only the account of those lines changes (same entries, numbers, dates, amounts); new vouchers of the two
-- categories post to 1950 through voucher_categories.gl_account_code.

DO $mig$
DECLARE
  t record; v_acct uuid; v_cats uuid[]; v_n int;
BEGIN
  FOR t IN SELECT DISTINCT vc.tenant_id FROM public.voucher_categories vc WHERE vc.name = 'تحويل الى الخزينة (نظام قديم)' LOOP
    SELECT id INTO v_acct FROM public.chart_of_accounts WHERE tenant_id = t.tenant_id AND code = '1950';
    IF v_acct IS NULL THEN
      INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system, description)
      VALUES (t.tenant_id, '1950', 'Old-system transfers (clearing)', 'تحويلات النظام القديم (حساب وسيط)', 'asset', 'debit', true,
              'فلوس دخلت أو خرجت من الخزن عن طريق النظام القديم — نقل داخلي، مش إيراد ولا مصروف (0125)')
      RETURNING id INTO v_acct;
    END IF;

    SELECT array_agg(id) INTO v_cats FROM public.voucher_categories
     WHERE tenant_id = t.tenant_id AND name = 'تحويل الى الخزينة (نظام قديم)';
    UPDATE public.voucher_categories SET gl_account_code = '1950', is_deductible_from_profit = false, is_added_to_profit = false
     WHERE id = ANY (v_cats);

    UPDATE public.journal_entry_lines l
       SET account_id = v_acct
      FROM public.journal_entries je, public.vouchers v, public.chart_of_accounts a
     WHERE l.entry_id = je.id AND je.source_id = v.id AND je.source_type IN ('voucher', 'voucher_reversal')
       AND v.category_id = ANY (v_cats) AND a.id = l.account_id AND a.code IN ('4200', '5500');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE '0125 tenant %: % lines moved to 1950', t.tenant_id, v_n;
  END LOOP;
END
$mig$;
