CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
  VALUES
    (p_tenant_id,'1000','Assets','الأصول','asset','debit',true),
    (p_tenant_id,'1100','Cash / Treasury','الخزينة','asset','debit',true),
    (p_tenant_id,'1110','Bank','البنك','asset','debit',true),
    (p_tenant_id,'1200','Accounts Receivable','العملاء (مدينون)','asset','debit',true),
    (p_tenant_id,'1300','Inventory','المخزون','asset','debit',true),
    (p_tenant_id,'1400','Partner Advances Receivable','سلف الشركاء','asset','debit',true),
    (p_tenant_id,'1500','Fixed Assets','الأصول الثابتة','asset','debit',true),
    (p_tenant_id,'1590','Accumulated Depreciation','مجمع الإهلاك','asset','credit',true),
    (p_tenant_id,'2000','Liabilities','الخصوم','liability','credit',true),
    (p_tenant_id,'2100','Accounts Payable','الموردون (دائنون)','liability','credit',true),
    (p_tenant_id,'2200','VAT Payable','ضريبة القيمة المضافة المستحقة','liability','credit',true),
    (p_tenant_id,'2300','Accrued Expenses','مصروفات مستحقة','liability','credit',true),
    (p_tenant_id,'3000','Equity','حقوق الملكية','equity','credit',true),
    (p_tenant_id,'3100','Partner Capital','رأس مال الشركاء','equity','credit',true),
    (p_tenant_id,'3200','Partner Drawings','مسحوبات الشركاء','equity','debit',true),
    (p_tenant_id,'3300','Retained Earnings (Legacy)','أرباح محتجزة (قديم)','equity','credit',true),
    (p_tenant_id,'3800','Retained Earnings','الأرباح المحتجزة','equity','credit',true),
    (p_tenant_id,'3850','Profit Distributions Payable','مستحقات توزيع أرباح','liability','credit',true),
    (p_tenant_id,'3900','Income Summary','ملخص الدخل','equity','credit',true),
    (p_tenant_id,'4000','Revenue','الإيرادات','revenue','credit',true),
    (p_tenant_id,'4100','Sales Revenue','إيراد المبيعات','revenue','credit',true),
    (p_tenant_id,'4200','Other Income','إيرادات أخرى','revenue','credit',true),
    (p_tenant_id,'4900','Sales Returns','مردودات المبيعات','revenue','debit',true),
    (p_tenant_id,'5000','Expenses','المصروفات','expense','debit',true),
    (p_tenant_id,'5100','Cost of Goods Sold','تكلفة البضاعة المباعة','expense','debit',true),
    (p_tenant_id,'5200','Salaries Expense','الرواتب','expense','debit',true),
    (p_tenant_id,'5300','Rent Expense','الإيجارات','expense','debit',true),
    (p_tenant_id,'5400','Utilities Expense','المرافق','expense','debit',true),
    (p_tenant_id,'5500','Operating Expenses','مصروفات تشغيلية','expense','debit',true),
    (p_tenant_id,'5900','Other Expenses','مصروفات أخرى','expense','debit',true),
    (p_tenant_id,'6500','Depreciation Expense','مصروف الإهلاك','expense','debit',true),
    (p_tenant_id,'6900','Loss on Asset Disposal','خسائر بيع أصول','expense','debit',true)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END $function$;

-- Backfill missing accounts for existing tenants (idempotent)
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_default_chart_of_accounts(t.id);
  END LOOP;
END $$;