CREATE OR REPLACE FUNCTION public.normalize_search_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT lower(btrim(translate(
    regexp_replace(coalesce(p,''), '[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g'),
    'إأآىة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    'ااايه01234567890123456789')))
$$;

-- Unified contact lookup for every document picker (sales, purchases, returns, vouchers, quotes, pre-orders).
-- Eligible = same tenant, not archived, type matches kind (or 'both'), and
-- (created in the branch OR general entity with no branch OR has documents in this branch).
-- SECURITY INVOKER: RLS on contacts still applies.
CREATE OR REPLACE FUNCTION public.search_branch_contacts(
  p_branch_id uuid,
  p_kind text DEFAULT 'any',
  p_query text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(id uuid, name text, phone text, type text, branch_id uuid)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH toks AS (
    SELECT array_remove(regexp_split_to_array(public.normalize_search_text(p_query), '\s+'), '') AS t
  )
  SELECT c.id, c.name, c.phone, c.type::text, c.branch_id
  FROM contacts c, toks
  WHERE c.tenant_id = public.current_tenant_id()
    AND (
      p_ids IS NOT NULL AND c.id = ANY(p_ids)
      OR p_ids IS NULL AND c.is_archived = false
      AND (p_kind = 'any' OR c.type::text IN (p_kind, 'both'))
      AND (
        c.branch_id = p_branch_id OR c.branch_id IS NULL
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.contact_id = c.id AND i.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM shipments s WHERE s.contact_id = c.id AND s.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM purchase_returns pr WHERE pr.contact_id = c.id AND pr.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.contact_id = c.id AND sp.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM vouchers v WHERE v.party_id = c.id AND v.branch_id = p_branch_id)
      )
      AND (
        coalesce(cardinality(toks.t), 0) = 0
        OR NOT EXISTS (
          SELECT 1 FROM unnest(toks.t) tk
          WHERE public.normalize_search_text(coalesce(c.name,'') || ' ' || coalesce(c.phone,'') || ' ' || coalesce(c.contact_person,'')) NOT LIKE '%' || tk || '%'
        )
      )
    )
  ORDER BY (c.branch_id = p_branch_id) DESC NULLS LAST, c.name
  LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200)
$$;

REVOKE ALL ON FUNCTION public.search_branch_contacts(uuid, text, text, int, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.search_branch_contacts(uuid, text, text, int, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_search_text(text) TO authenticated, service_role;