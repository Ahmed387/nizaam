-- 0144: «فرع داخلي» — a customer / supplier account that is really one of our branches (owner «نفذ», 2026-10-30)
--
-- The old system's files keep inter-branch documents as they are (a sale is a sale, a purchase a purchase — owner rule),
-- with the other branch as the customer / supplier: «معرض سكة تلة (حساب خاص)», «معرض عبد المنعم الغربى (حساب خاص)» in
-- شلبى and «المخزن الرئيسي» (= شلبى) in عبدالمنعم and سكة. Tagging the account changes NO document and NO branch figure;
-- the company-wide reports add a line «منها بين الفروع» and keep it out of the real customers' / suppliers' debts.
--   Example: شلبى sells to عبدالمنعم 75,500 → شلبى's card: sales 75,500 as before; company card: sales 155,500,
--   «منها بين الفروع 75,500»; company debts: «عبدالمنعم مدين لشلبى» is shown apart, not as a customer debt.
-- Set by the owner / admin only (`set_contact_internal_branch`); «تجار من بره» like «معرض سوق الجملة» stay untagged.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS internal_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.contacts.internal_branch_id IS '0144: this account is one of our branches («فرع داخلي») — reports show it apart';

CREATE OR REPLACE FUNCTION public.set_contact_internal_branch(p_contact uuid, p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'تعليم «فرع داخلي» للمالك أو المدير بس' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact AND tenant_id = v_t) THEN RAISE EXCEPTION 'الحساب غير موجود'; END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch AND tenant_id = v_t AND coalesce(is_system, false) = false) THEN
    RAISE EXCEPTION 'الفرع غير موجود';
  END IF;
  PERFORM set_config('app.contact_internal_tag', '1', true);
  UPDATE public.contacts SET internal_branch_id = p_branch WHERE id = p_contact;
  PERFORM set_config('app.contact_internal_tag', '', true);
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), v_t, 'UPDATE', 'contact', p_contact::text,
          jsonb_build_object('internal_branch_id', p_branch));
END $function$;
REVOKE ALL ON FUNCTION public.set_contact_internal_branch(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contact_internal_branch(uuid, uuid) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('set_contact_internal_branch', '0144', 'owner / admin: tag a contact as one of our branches («فرع داخلي»)')
ON CONFLICT DO NOTHING;

-- the card: «منها بين الفروع» for sales (without VAT, like the statement) and for what is still open
DO $mig$
DECLARE d text := pg_get_functiondef('public.owner_business_snapshot(date,date,uuid)'::regprocedure);
  o1 text := $o$inv AS (SELECT i.branch_id, count(*) AS n, sum(coalesce(public.ledger_doc_open('invoice', i.id), 0)) AS open_credit
      FROM public.invoices i WHERE i.tenant_id = v_t AND i.status = 'active' AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to GROUP BY 1),$o$;
  n1 text := $n$inv AS (SELECT i.branch_id, count(*) AS n, sum(coalesce(public.ledger_doc_open('invoice', i.id), 0)) AS open_credit,
             -- 0144: sold to one of our own branches («فرع داخلي»)
             sum(i.total - coalesce(i.vat_amount, 0)) FILTER (WHERE c.internal_branch_id IS NOT NULL) AS internal_sales,
             sum(coalesce(public.ledger_doc_open('invoice', i.id), 0)) FILTER (WHERE c.internal_branch_id IS NOT NULL) AS internal_open
      FROM public.invoices i LEFT JOIN public.contacts c ON c.id = i.contact_id
     WHERE i.tenant_id = v_t AND i.status = 'active' AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to GROUP BY 1),$n$;
  o2 text := $o$'open_credit', round(coalesce(inv.open_credit, 0), 2),$o$;
  n2 text := $n$'open_credit', round(coalesce(inv.open_credit, 0), 2),
           'internal_sales', round(coalesce(inv.internal_sales, 0), 2), 'internal_open', round(coalesce(inv.internal_open, 0), 2),$n$;
  o3 text := $o$'collected', coalesce(sum((x->>'collected')::numeric), 0), 'open_credit', coalesce(sum((x->>'open_credit')::numeric), 0),$o$;
  n3 text := $n$'collected', coalesce(sum((x->>'collected')::numeric), 0), 'open_credit', coalesce(sum((x->>'open_credit')::numeric), 0),
       'internal_sales', coalesce(sum((x->>'internal_sales')::numeric), 0), 'internal_open', coalesce(sum((x->>'internal_open')::numeric), 0),$n$;
BEGIN
  IF position('internal_sales' IN d) > 0 THEN RETURN; END IF;
  IF position(o1 IN d) = 0 OR position(o2 IN d) = 0 OR position(o3 IN d) = 0 THEN
    RAISE EXCEPTION '0144: owner_business_snapshot not the expected version';
  END IF;
  EXECUTE replace(replace(replace(d, o1, n1), o2, n2), o3, n3);
END
$mig$;

-- the company position: what our branches owe each other is shown apart («منها بين الفروع»)
DO $mig$
DECLARE d text := pg_get_functiondef('public.ledger_position(uuid)'::regprocedure); s text;
BEGIN
  IF position('internal_open' IN d) > 0 THEN RETURN; END IF;
  FOREACH s IN ARRAY ARRAY['customer', 'supplier'] LOOP
    IF position(format($f$'open', COALESCE((SELECT round(sum(open_remaining), 2) FROM sb WHERE side = '%s'), 0),$f$, s) IN d) = 0 THEN
      RAISE EXCEPTION '0144: ledger_position not the expected version (%)', s;
    END IF;
    d := replace(d, format($f$'open', COALESCE((SELECT round(sum(open_remaining), 2) FROM sb WHERE side = '%s'), 0),$f$, s),
      format($f$'open', COALESCE((SELECT round(sum(open_remaining), 2) FROM sb WHERE side = '%s'), 0),
            'internal_open', COALESCE((SELECT round(sum(sb.open_remaining), 2) FROM sb JOIN public.contacts ic ON ic.id = sb.contact_id
                                        WHERE sb.side = '%s' AND ic.internal_branch_id IS NOT NULL), 0),$f$, s, s));
  END LOOP;
  EXECUTE d;
END
$mig$;
