-- 0215 — after 0212 the advance pools are empty and nothing posts to them: mark them like 3300 (same as 0136),
-- never deleted (old reversed entries still point at them). Refused if either still has a balance.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
              WHERE e.status = 'posted' AND a.code IN ('2150', '1460') GROUP BY a.tenant_id, a.code HAVING abs(sum(l.debit - l.credit)) > 0.005) THEN
    RAISE EXCEPTION '0215: a pool account still has a balance';
  END IF;
  UPDATE chart_of_accounts SET name_ar = 'دفعات العملاء المقدمة (قديم - غير مستخدم)', name = 'Customer Advances (old, unused)' WHERE code = '2150';
  UPDATE chart_of_accounts SET name_ar = 'دفعات الموردين المقدمة (قديم - غير مستخدم)', name = 'Supplier Advances (old, unused)' WHERE code = '1460';
END $$;
