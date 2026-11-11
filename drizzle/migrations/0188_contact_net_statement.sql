-- 0188: owner 2026-11-11 «مش عاوز تخصيص، عاوز دائن ومدين ورصيد … العميل اللي هو مورد كمان — رصيد واحد صافي زي سهل نفذ».
-- `contact_net_statement(contact, branch, from, to)`: ONE statement per name the way «سهل» shows it — every movement of both
-- sides in date order with مدين / دائن and a running balance:
--   مدين (عليه)  = sale invoices and what the customer side adds  +  what we pay the supplier / his returns' credit
--   دائن (له)    = what he pays / his credits                      +  purchase invoices and what the supplier side adds
--   الرصيد       = running sum of (مدين − دائن) from the prior balance;  + = مدين (عليه),  − = دائن (له)
-- It only READS `ledger_contact_statement` of the two sides (same access rules, same numbers): prior balance = customer
-- side balance − supplier side balance before the period. Nothing is allocated or changed; the two-sided screens stay.
CREATE OR REPLACE FUNCTION public.contact_net_statement(p_contact uuid, p_branch_id uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(line_no integer, line_date date, line_type text, reference text, branch_name text, description text,
              debit numeric, credit numeric, balance numeric, doc_type text, doc_id uuid, branch_id uuid)
LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  WITH c AS (SELECT * FROM public.ledger_contact_statement(p_contact, 'customer', p_branch_id, p_from, p_to)),
       s AS (SELECT * FROM public.ledger_contact_statement(p_contact, 'supplier', p_branch_id, p_from, p_to)),
       o AS (SELECT coalesce((SELECT c.balance FROM c WHERE c.line_no = 0), 0) - coalesce((SELECT s.balance FROM s WHERE s.line_no = 0), 0) AS bal,
                    coalesce((SELECT c.line_date FROM c WHERE c.line_no = 0), (SELECT s.line_date FROM s WHERE s.line_no = 0)) AS d),
       m AS (SELECT 1 AS sd, c.line_no AS n, c.line_date, c.line_type, c.reference, c.branch_name, c.description, c.debit, c.credit, c.doc_type, c.doc_id, c.branch_id
               FROM c WHERE c.line_no > 0
             UNION ALL
             SELECT 2, s.line_no, s.line_date, s.line_type, s.reference, s.branch_name, s.description, s.credit, s.debit, s.doc_type, s.doc_id, s.branch_id
               FROM s WHERE s.line_no > 0),
       r AS (SELECT row_number() OVER (ORDER BY m.line_date, (m.line_type LIKE 'رصيد افتتاحي%') DESC, m.sd, m.n)::int AS rn, m.* FROM m)
  SELECT 0, o.d, 'رصيد أول المدة'::text, NULL::text, NULL::text, NULL::text, 0::numeric, 0::numeric, round(o.bal, 2), NULL::text, NULL::uuid, NULL::uuid FROM o
  UNION ALL
  SELECT r.rn, r.line_date, r.line_type, r.reference, r.branch_name, r.description, r.debit, r.credit,
         round((SELECT o.bal FROM o) + sum(r.debit - r.credit) OVER (ORDER BY r.rn), 2), r.doc_type, r.doc_id, r.branch_id
    FROM r
  ORDER BY 1
$fn$;
REVOKE ALL ON FUNCTION public.contact_net_statement(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_net_statement(uuid, uuid, date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
