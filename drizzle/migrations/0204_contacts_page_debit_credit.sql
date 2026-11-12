-- 0204: owner 2026-11-12 «حسابات الموردين والعملاء بنظام الحساب الجاري (الدائن والمدين) … إلغاء نظام الفواتير المقفولة والمفتوحة».
-- contacts_page: balance filters «debit / credit / zero» on the account's ONE net balance (customer side − supplier side;
-- > 0 = مدين لنا عنده، < 0 = دائن علينا له) and the totals debit_total / credit_total (+ counts) for the three cards.
-- The old filters and totals stay in the function (other screens still read them). Shown sign on screen: دائن +، مدين −.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.contacts_page(uuid,text,text,text[],integer,integer)'::regprocedure);
  IF position('debit_total' in d) = 0 THEN
    d := replace(d, $a$OR ('owe_us' = ANY (p_balance) AND customer_open > 0.005)$a$,
      $a$OR ('debit' = ANY (p_balance) AND customer_balance - supplier_balance > 0.005)
        OR ('credit' = ANY (p_balance) AND customer_balance - supplier_balance < -0.005)
        OR ('zero' = ANY (p_balance) AND abs(customer_balance - supplier_balance) <= 0.005)
        OR ('owe_us' = ANY (p_balance) AND customer_open > 0.005)$a$);
    d := replace(d, $a$'customers_open', COALESCE(round(sum(customer_open), 2), 0),$a$,
      $a$'debit_total', COALESCE(round(sum(GREATEST(customer_balance - supplier_balance, 0)), 2), 0),
        'debit_count', count(*) FILTER (WHERE customer_balance - supplier_balance > 0.005),
        'credit_total', COALESCE(round(sum(GREATEST(supplier_balance - customer_balance, 0)), 2), 0),
        'credit_count', count(*) FILTER (WHERE customer_balance - supplier_balance < -0.005),
        'customers_open', COALESCE(round(sum(customer_open), 2), 0),$a$);
    IF position('debit_total' in d) = 0 OR position($a$'debit' = ANY$a$ in d) = 0 THEN RAISE EXCEPTION '0204: contacts_page not patched'; END IF;
    EXECUTE d;
  END IF;
END
$mig$;
NOTIFY pgrst, 'reload schema';
