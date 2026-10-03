-- Server-side Contacts page: search, type tab, balance filter, pagination, counts and totals in one call.
-- Returns jsonb so the PostgREST 1,000-row cap never truncates the result.
-- Scope: no search → contacts belonging to the branch (own branch / no branch / activity / non-zero balance);
-- with search → every non-archived tenant contact (prevents duplicate creation).
CREATE OR REPLACE FUNCTION public.contacts_page(
  p_branch_id uuid,
  p_type text DEFAULT 'all',
  p_query text DEFAULT NULL,
  p_balance text[] DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH toks AS (
    SELECT array_remove(regexp_split_to_array(public.normalize_search_text(p_query), '\s+'), '') AS t
  ),
  bal AS (SELECT * FROM public.contact_branch_balances(p_branch_id)),
  base AS (
    SELECT c.*, coalesce(b.balance, 0) AS balance, coalesce(b.overdue, 0) AS overdue,
      (c.branch_id = p_branch_id OR c.branch_id IS NULL
        OR abs(coalesce(b.balance,0)) > 0.01 OR abs(coalesce(b.overdue,0)) > 0.01
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.contact_id = c.id AND i.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM shipments s WHERE s.contact_id = c.id AND s.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM purchase_returns pr WHERE pr.contact_id = c.id AND pr.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.contact_id = c.id AND sp.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM vouchers v WHERE v.party_id = c.id AND v.branch_id = p_branch_id)
      ) AS in_branch
    FROM contacts c
    LEFT JOIN bal b ON b.contact_id = c.id
    WHERE c.tenant_id = public.current_tenant_id() AND c.is_archived = false
  ),
  scoped AS (
    SELECT base.* FROM base, toks
    WHERE CASE WHEN coalesce(cardinality(toks.t),0) = 0 THEN base.in_branch
      ELSE NOT EXISTS (
        SELECT 1 FROM unnest(toks.t) tk
        WHERE public.normalize_search_text(concat_ws(' ', base.name, base.phone, base.contact_person, base.email, base.address, base.notes)) NOT LIKE '%' || tk || '%'
      ) END
  ),
  typed AS (
    SELECT * FROM scoped
    WHERE p_type = 'all' OR (p_type = 'both' AND type::text = 'both') OR (p_type <> 'both' AND type::text IN (p_type, 'both'))
  ),
  filtered AS (
    SELECT * FROM typed
    WHERE p_balance IS NULL OR cardinality(p_balance) = 0
      OR ('owe_us' = ANY(p_balance) AND balance > 0.01)
      OR ('we_owe' = ANY(p_balance) AND balance < -0.01)
      OR ('settled' = ANY(p_balance) AND abs(balance) < 0.01)
  ),
  page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id
    LIMIT LEAST(GREATEST(coalesce(p_limit,50),1), 100000) OFFSET GREATEST(coalesce(p_offset,0),0)
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(page) - 'in_branch' ORDER BY page.created_at DESC, page.id) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'counts', (SELECT jsonb_build_object(
        'all', count(*),
        'customer', count(*) FILTER (WHERE type::text IN ('customer','both')),
        'supplier', count(*) FILTER (WHERE type::text IN ('supplier','both')),
        'both', count(*) FILTER (WHERE type::text = 'both')) FROM scoped),
    'totals', (SELECT jsonb_build_object(
        'owe_us', coalesce(sum(balance) FILTER (WHERE balance > 0), 0),
        'we_owe', coalesce(-sum(balance) FILTER (WHERE balance < 0), 0),
        'overdue', coalesce(sum(overdue), 0)) FROM filtered)
  )
$$;

REVOKE ALL ON FUNCTION public.contacts_page(uuid, text, text, text[], int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.contacts_page(uuid, text, text, text[], int, int) TO authenticated, service_role;