
-- Add quantity snapshot to price audit log
ALTER TABLE public.price_audit_log
  ADD COLUMN IF NOT EXISTS quantity_at_change numeric;

-- Update _audit_write to accept quantity
CREATE OR REPLACE FUNCTION public._audit_write(
  _tenant uuid,
  _etype text, _eid uuid, _ename text,
  _ptype text, _old numeric, _new numeric,
  _branch uuid, _reason text, _source text,
  _qty numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  uinfo record;
  hr int := EXTRACT(HOUR FROM (now() AT TIME ZONE 'Africa/Cairo'))::int;
  admins uuid[];
  cur_cost numeric;
  qty numeric := _qty;
BEGIN
  SELECT * INTO uinfo FROM public._audit_user_info(uid);

  -- Resolve qty from product if entity is a product and qty not supplied
  IF qty IS NULL AND _etype = 'product' AND _eid IS NOT NULL THEN
    SELECT quantity INTO qty FROM public.products WHERE id = _eid;
  ELSIF qty IS NULL AND _etype = 'product_batch' AND _eid IS NOT NULL THEN
    SELECT quantity INTO qty FROM public.products WHERE id = _eid;
  END IF;

  INSERT INTO public.price_audit_log(
    tenant_id, entity_type, entity_id, entity_name, price_type,
    old_value, new_value, changed_by, changed_by_name, changed_by_role,
    branch_id, change_reason, source, quantity_at_change
  ) VALUES (
    _tenant, _etype, _eid, _ename, _ptype,
    _old, _new, uid, uinfo.uname, uinfo.urole,
    _branch, _reason, _source, qty
  );

  IF _source = 'manual' AND _etype = 'product' AND _ptype = 'selling_price' AND _old IS NOT NULL AND _new IS NOT NULL THEN
    SELECT ARRAY(SELECT ur.user_id FROM public.user_roles ur
                 JOIN public.profiles p ON p.id = ur.user_id
                 WHERE p.tenant_id = _tenant AND ur.role::text IN ('admin','super_admin'))
      INTO admins;

    IF _old > 0 AND _new < _old AND ((_old - _new) / _old) > 0.20 THEN
      INSERT INTO public.notifications(user_id, title, body, type)
      SELECT u, '⚠️ تخفيض كبير في السعر',
        'المنتج: '||COALESCE(_ename,'')||' من '||_old||' إلى '||_new||' بواسطة '||uinfo.uname,
        'general'
      FROM unnest(admins) u;
    END IF;

    SELECT cost_price INTO cur_cost FROM public.products WHERE id = _eid;
    IF cur_cost IS NOT NULL AND _new < cur_cost THEN
      INSERT INTO public.notifications(user_id, title, body, type)
      SELECT u, '🔴 سعر البيع أقل من التكلفة',
        'المنتج: '||COALESCE(_ename,'')||' — سعر البيع: '||_new||' — التكلفة: '||cur_cost,
        'general'
      FROM unnest(admins) u;
    END IF;

    IF hr < 8 OR hr >= 22 THEN
      INSERT INTO public.notifications(user_id, title, body, type)
      SELECT u, '⚠️ تعديل سعر خارج أوقات العمل',
        'المنتج: '||COALESCE(_ename,'')||' بواسطة '||uinfo.uname||' الساعة '||hr||':00',
        'general'
      FROM unnest(admins) u;
    END IF;
  END IF;
END $$;
