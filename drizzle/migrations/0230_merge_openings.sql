-- 0230 — «دمج حسابين» when BOTH accounts carry an opening balance (owner 2026-11-15 «نفذ الاقتراح، نجمعهم في افتتاحي واحد»).
--
-- The account that goes away KEEPS its own opening row (contacts.opening_balance / opening_branch_id, archived with
-- merged_into) — so the books' opening entries (one per branch, read from contacts) never change. The ledger now gives
-- a merged account the openings of every account merged into it (`contact_merge_members`, the whole chain):
--   * ONE opening movement per BRANCH = Σ the openings sitting on that branch (same branch → added into one);
--   * an account merged into another has no opening movement of its own any more.
-- The opening is a NET figure (+ he owes us / − we owe him) on every account type, so the sum keeps the account's
-- balance in every branch. merge_contacts no longer refuses an opening on the account that goes away, and checks
-- the NET balance per branch (an opening may move from the supplier side to the customer side of a «عميل ومورد»).
-- `contact_opening_total(contact)` = what the old reconciliation reads as the account's opening.

CREATE OR REPLACE FUNCTION public.contact_merge_members(p_contact uuid)
 RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  WITH RECURSIVE r(id, depth) AS (
    SELECT p_contact, 0
    UNION ALL
    SELECT c.id, r.depth + 1 FROM public.contacts c JOIN r ON c.merged_into = r.id WHERE r.depth < 50
  )
  SELECT DISTINCT r.id FROM r
$f$;
REVOKE ALL ON FUNCTION public.contact_merge_members(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_opening_total(p_contact uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT CASE WHEN (SELECT merged_into FROM public.contacts WHERE id = p_contact) IS NOT NULL THEN 0
              ELSE coalesce((SELECT sum(coalesce(c.opening_balance, 0)) FROM public.contacts c
                              WHERE c.id IN (SELECT m.id FROM public.contact_merge_members(p_contact) m)), 0) END
$f$;
REVOKE ALL ON FUNCTION public.contact_opening_total(uuid) FROM PUBLIC, anon, authenticated;

-- the opening on one side, the way the ledger books it (per branch, a «عميل ومورد» splits by each branch's sign)
CREATE OR REPLACE FUNCTION public.contact_opening_side(p_contact uuid, p_side text)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT CASE WHEN k.merged_into IS NOT NULL THEN 0 ELSE coalesce((
    SELECT sum(CASE WHEN p_side = 'customer'
                    THEN CASE k.type::text WHEN 'customer' THEN g.ob WHEN 'both' THEN greatest(g.ob, 0) ELSE 0 END
                    ELSE CASE k.type::text WHEN 'supplier' THEN -g.ob WHEN 'both' THEN greatest(-g.ob, 0) ELSE 0 END END)
      FROM (SELECT public.ledger_opening_branch(k.tenant_id, m.id) AS br, sum(coalesce(m.opening_balance, 0)) AS ob
              FROM public.contacts m WHERE m.id IN (SELECT mm.id FROM public.contact_merge_members(k.id) mm)
             GROUP BY 1) g), 0) END
    FROM public.contacts k WHERE k.id = p_contact
$f$;
REVOKE ALL ON FUNCTION public.contact_opening_side(uuid, text) FROM PUBLIC, anon, authenticated;

-- 1) the ledger: openings of the merge chain, one movement per branch
DO $m$
DECLARE d text; d0 text; a int; b int; old_part text; new_part text;
BEGIN
  d := pg_get_functiondef('public.ledger_desired_movements(uuid)'::regprocedure);
  d0 := d;
  a := position('  SELECT ''contacts'', c.id, ''opening'', o.sd,' IN d);
  b := position('WHERE abs(c.ob) > 0.005;' IN d);
  IF a = 0 OR b = 0 OR b < a THEN RAISE EXCEPTION '0230: opening part of ledger_desired_movements not found'; END IF;
  old_part := substring(d FROM a FOR b - a + length('WHERE abs(c.ob) > 0.005;'));
  new_part := $p$  SELECT 'contacts', g.src, 'opening', o.sd,
         CASE WHEN o.amt > 0 THEN 'charge' ELSE 'settle' END,
         g.br, NULL, round(abs(o.amt), 2), v_cut,
         NULL, NULL, NULL, g.fb
    FROM (SELECT public.ledger_opening_branch(c.tenant_id, m.id) AS br,
                 (array_agg(m.id ORDER BY (m.id = c.id) DESC, m.id))[1] AS src,
                 bool_or(public.ledger_opening_branch_is_fallback(c.tenant_id, m.id)) AS fb,
                 sum(COALESCE(m.opening_balance, 0)) AS ob
            FROM contacts m
           WHERE m.id IN (SELECT mm.id FROM public.contact_merge_members(c.id) mm)
             AND NOT EXISTS (SELECT 1 FROM contacts x WHERE x.id = c.id AND x.merged_into IS NOT NULL)
             AND abs(COALESCE(m.opening_balance, 0)) > 0.005
           GROUP BY 1) g
    CROSS JOIN LATERAL (
          SELECT CASE WHEN c.type = 'supplier' THEN 'supplier'
                      WHEN c.type = 'customer' THEN 'customer'
                      WHEN g.ob > 0 THEN 'customer' ELSE 'supplier' END AS sd,
                 CASE WHEN c.type = 'supplier' THEN -g.ob
                      WHEN c.type = 'customer' THEN g.ob
                      WHEN g.ob > 0 THEN g.ob ELSE -g.ob END AS amt) o
   WHERE abs(g.ob) > 0.005;$p$;
  d := replace(d, old_part, new_part);
  IF d = d0 THEN RAISE EXCEPTION '0230: ledger_desired_movements unchanged'; END IF;
  EXECUTE d;
END
$m$;

-- 2) the old reconciliation reads the chain's opening on the kept account (and none on a merged one)
DO $m$
DECLARE d text; d0 text;
BEGIN
  d := pg_get_functiondef('public.ledger_reconciliation(uuid)'::regprocedure);
  d0 := d;
  d := replace(d, 'COALESCE(c.opening_balance, 0) AS ob', 'public.contact_opening_total(c.id) AS ob');
  d := replace(d, 'CASE WHEN s.type = ''customer'' THEN s.ob WHEN s.type = ''both'' THEN GREATEST(s.ob, 0) ELSE 0 END',
                  'public.contact_opening_side(s.id, ''customer'')');
  d := replace(d, 'CASE WHEN s.type = ''supplier'' THEN -s.ob WHEN s.type = ''both'' THEN GREATEST(-s.ob, 0) ELSE 0 END',
                  'public.contact_opening_side(s.id, ''supplier'')');
  IF d = d0 OR position('contact_opening_side(s.id, ''customer'')' IN d) = 0 OR position('contact_opening_side(s.id, ''supplier'')' IN d) = 0 THEN
    RAISE EXCEPTION '0230: ledger_reconciliation text not found';
  END IF;
  EXECUTE d;
END
$m$;

-- 3) merge_contacts: an opening on the account that goes away is allowed; the check is the NET balance per branch
DO $m$
DECLARE d text; d0 text;
BEGIN
  d := pg_get_functiondef('public.merge_contacts(uuid,uuid,boolean,text,uuid)'::regprocedure);
  d0 := d;
  d := replace(d, $o$  IF coalesce(f.opening_balance, 0) <> 0 THEN
    RAISE EXCEPTION 'الحساب «%» عليه رصيد افتتاحي (%). خليه هو الحساب الباقي وادمج التاني فيه.', f.name, f.opening_balance;
  END IF;
$o$, '');
  -- the account that goes away keeps its opening on the branch it was on
  d := replace(d, $o$    UPDATE public.contacts SET is_archived = true, merged_into = p_into,
$o$, $o$    UPDATE public.contacts SET is_archived = true, merged_into = p_into,
           opening_branch_id = CASE WHEN coalesce(opening_balance, 0) <> 0 AND opening_branch_id IS NULL THEN branch_id ELSE opening_branch_id END,
$o$);
  d := replace(d, $o$    IF abs(v_c_after - v_c_before) >= 0.01 OR abs(v_s_after - v_s_before) >= 0.01 THEN v_ok := false; END IF;$o$,
                  $o$    IF abs((v_c_after - v_s_after) - (v_c_before - v_s_before)) >= 0.01 THEN v_ok := false; END IF;$o$);
  d := replace(d, $o$      IF abs(v_ca - v_cb) >= 0.01 OR abs(v_sa - v_sb) >= 0.01 THEN v_ok := false; END IF;$o$,
                  $o$      IF abs((v_ca - v_sa) - (v_cb - v_sb)) >= 0.01 THEN v_ok := false; END IF;$o$);
  IF position('عليه رصيد افتتاحي' IN d) > 0 OR position('(v_ca - v_sa) - (v_cb - v_sb)' IN d) = 0
     OR position('(v_c_after - v_s_after) - (v_c_before - v_s_before)' IN d) = 0
     OR position('THEN branch_id ELSE opening_branch_id END' IN d) = 0 THEN
    RAISE EXCEPTION '0230: merge_contacts text not found';
  END IF;
  EXECUTE d;
END
$m$;
