-- 0235 «بحث في السيستم كله» (Ctrl+K, owner 2026-11-16): one box on every page finds an invoice / purchase / return /
-- voucher by its number (system or «سهل» number), an account by name / phone / account number, an item by code / name.
-- SECURITY INVOKER: every row comes through the user's own RLS (branches, paused branches, hidden accounts), so the
-- search never shows what the screens would not. Read only. Up to p_limit hits per kind.
CREATE OR REPLACE FUNCTION public.global_search(p_q text, p_limit int DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  q   text := btrim(coalesce(p_q, ''));
  nq  text;
  w   text[];
  lim int := least(greatest(coalesce(p_limit, 6), 1), 20);
  num text;
  res jsonb := '[]'::jsonb;
BEGIN
  IF length(q) < 2 THEN RETURN res; END IF;
  nq  := public.normalize_search_text(q);
  w   := array_remove(regexp_split_to_array(nq, '\s+'), '');
  num := translate(q, '٠١٢٣٤٥٦٧٨٩', '0123456789');

  -- documents by number
  res := res || coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('kind','sale','id',i.id,'branch_id',i.branch_id,'branch',b.name,'title',i.invoice_number,
               'sub',coalesce(c.name,'عميل نقدي'),'amount',i.total,'day',i.invoice_date,'status',i.status) x
        FROM invoices i JOIN branches b ON b.id = i.branch_id LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.invoice_number ILIKE '%'||num||'%' OR i.legacy_number::text = num
       ORDER BY (i.invoice_number ILIKE num) DESC, i.invoice_date DESC LIMIT lim) s), '[]');
  res := res || coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('kind','purchase','id',s.id,'branch_id',s.branch_id,'branch',b.name,'title',s.shipment_number,
               'sub',c.name,'amount',s.total_cost,'day',s.invoice_date,'status',s.status) x
        FROM shipments s JOIN branches b ON b.id = s.branch_id LEFT JOIN contacts c ON c.id = s.contact_id
       WHERE s.shipment_number ILIKE '%'||num||'%' OR s.legacy_number::text = num
       ORDER BY (s.shipment_number ILIKE num) DESC, s.invoice_date DESC LIMIT lim) t), '[]');
  res := res || coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('kind','sale_return','id',r.id,'branch_id',r.branch_id,'branch',b.name,'title',r.return_number,
               'sub',null,'amount',r.total_refund,'day',r.invoice_date,'status',r.status) x
        FROM returns r JOIN branches b ON b.id = r.branch_id
       WHERE r.return_number ILIKE '%'||num||'%' OR r.legacy_number::text = num
       ORDER BY (r.return_number ILIKE num) DESC, r.invoice_date DESC LIMIT lim) t), '[]');
  res := res || coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('kind','purchase_return','id',r.id,'branch_id',r.branch_id,'branch',b.name,'title',r.return_number,
               'sub',c.name,'amount',r.total_amount,'day',r.invoice_date,'status',r.status) x
        FROM purchase_returns r JOIN branches b ON b.id = r.branch_id LEFT JOIN contacts c ON c.id = r.contact_id
       WHERE r.return_number ILIKE '%'||num||'%' OR r.legacy_number::text = num
       ORDER BY (r.return_number ILIKE num) DESC, r.invoice_date DESC LIMIT lim) t), '[]');
  res := res || coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('kind','voucher','id',v.id,'branch_id',v.branch_id,'branch',b.name,'title',v.voucher_number,
               'sub',v.party_name,'amount',null,'day',v.voucher_date,'status',v.status) x
        FROM vouchers v JOIN branches b ON b.id = v.branch_id
       WHERE v.voucher_number ILIKE '%'||num||'%'
       ORDER BY (v.voucher_number ILIKE num) DESC, v.voucher_date DESC LIMIT lim) t), '[]');

  -- accounts: every word of the query (system spelling rules) in the name, or the phone / account number
  res := res || coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('kind','contact','id',c.id,'branch_id',c.branch_id,'branch',b.name,'title',c.name,
               'sub',concat_ws(' • ', nullif(c.account_no::text,''), nullif(c.phone,'')),'amount',null,'day',null,'status',null) x
        FROM contacts c LEFT JOIN branches b ON b.id = c.branch_id
       WHERE NOT coalesce(c.is_archived, false)
         AND ( (SELECT bool_and(public.normalize_search_text(c.name) LIKE '%'||ww||'%') FROM unnest(w) ww)
               OR c.phone LIKE '%'||num||'%' OR c.account_no::text = num )
       ORDER BY (public.normalize_search_text(c.name) = nq) DESC, length(c.name) LIMIT lim) t), '[]');

  -- items: one hit per code, the exact code first
  res := res || coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('kind','product','id',p.id,'branch_id',p.branch_id,'branch',b.name,'title',p.name,
               'sub',p.sku,'amount',null,'day',null,'status',null) x
        FROM (SELECT DISTINCT ON (coalesce(p0.sku, p0.id::text)) p0.*
                FROM products p0
               WHERE p0.archived_at IS NULL
                 AND ( p0.sku ILIKE num OR p0.legacy_code::text = num
                       OR (SELECT bool_and(public.normalize_search_text(p0.name) LIKE '%'||ww||'%') FROM unnest(w) ww) )
               ORDER BY coalesce(p0.sku, p0.id::text), p0.branch_id) p
        JOIN branches b ON b.id = p.branch_id
       ORDER BY (p.sku ILIKE num) DESC, length(p.name) LIMIT lim) t), '[]');

  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.global_search(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.global_search(text, int) TO authenticated;
