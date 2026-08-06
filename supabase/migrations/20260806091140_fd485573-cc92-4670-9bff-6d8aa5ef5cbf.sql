DO $$
DECLARE cids uuid[]; inv uuid[]; shp uuid[]; emps uuid[]; refs uuid[];
BEGIN
  SELECT array_agg(id) INTO cids FROM contacts WHERE name ILIKE '%TESTX%' OR name ILIKE '%ZZTEST%';
  IF cids IS NULL THEN RETURN; END IF;

  SELECT array_agg(id) INTO inv FROM invoices WHERE contact_id = ANY(cids);
  SELECT array_agg(id) INTO shp FROM shipments WHERE contact_id = ANY(cids);
  refs := coalesce(inv,'{}'::uuid[]) || coalesce(shp,'{}'::uuid[]);

  DELETE FROM payment_installments WHERE payment_plan_id IN (SELECT id FROM payment_plans WHERE reference_id = ANY(refs) OR entity_id = ANY(cids));
  DELETE FROM payment_plans WHERE reference_id = ANY(refs) OR entity_id = ANY(cids);

  IF inv IS NOT NULL THEN
    DELETE FROM invoice_payments WHERE invoice_id = ANY(inv);
    DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE invoice_id = ANY(inv));
    DELETE FROM returns WHERE invoice_id = ANY(inv);
    DELETE FROM invoice_items WHERE invoice_id = ANY(inv);
    DELETE FROM payment_transactions WHERE invoice_id = ANY(inv);
    DELETE FROM invoices WHERE id = ANY(inv);
  END IF;

  DELETE FROM purchase_return_items WHERE purchase_return_id IN (SELECT id FROM purchase_returns WHERE contact_id = ANY(cids));
  DELETE FROM purchase_returns WHERE contact_id = ANY(cids);

  IF shp IS NOT NULL THEN
    DELETE FROM shipment_items WHERE shipment_id = ANY(shp);
    DELETE FROM shipments WHERE id = ANY(shp);
  END IF;

  IF array_length(refs,1) IS NOT NULL THEN
    DELETE FROM treasury WHERE reference_id = ANY(refs);
    DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_id = ANY(refs));
    DELETE FROM journal_entries WHERE source_id = ANY(refs);
  END IF;

  DELETE FROM supplier_payments WHERE contact_id = ANY(cids);
  DELETE FROM customer_credit_log WHERE contact_id = ANY(cids);
  DELETE FROM vouchers WHERE party_id = ANY(cids);
  DELETE FROM contacts WHERE id = ANY(cids);

  SELECT array_agg(id) INTO emps FROM employees WHERE name ILIKE '%TESTX%' OR name ILIKE '%ZZTEST%';
  IF emps IS NOT NULL THEN
    DELETE FROM attendance WHERE employee_id = ANY(emps);
    DELETE FROM salaries WHERE employee_id = ANY(emps);
    DELETE FROM advances WHERE employee_id = ANY(emps);
    DELETE FROM employees WHERE id = ANY(emps);
  END IF;
END $$;