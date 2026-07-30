DROP FUNCTION IF EXISTS public.generate_alerts();

CREATE OR REPLACE FUNCTION public.generate_alerts()
RETURNS TABLE(low_stock_count integer, overdue_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_low int := 0;
  v_ovd int := 0;
BEGIN
  PERFORM public.mark_overdue_installments();

  WITH low AS (
    SELECT p.id, p.name, p.quantity, p.low_stock_alert, p.branch_id, p.tenant_id, b.name AS branch_name
    FROM public.products p
    LEFT JOIN public.branches b ON b.id = p.branch_id
    WHERE p.quantity <= p.low_stock_alert
      AND COALESCE(p.low_stock_alert,0) > 0
  ),
  recipients AS (
    SELECT pr.id AS user_id, pr.tenant_id, NULL::uuid AS branch_id
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.id
    WHERE ur.role IN ('admin','supervisor','owner')
    UNION
    SELECT pr.id, pr.tenant_id, bu.branch_id
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.id
    JOIN public.branch_users bu ON bu.user_id = pr.id
    WHERE ur.role IN ('branch_manager','warehouse')
  ),
  pairs AS (
    SELECT DISTINCT r.user_id, r.tenant_id, l.id AS product_id, l.name, l.quantity, l.low_stock_alert, l.branch_name
    FROM recipients r
    JOIN low l ON l.tenant_id = r.tenant_id
     AND (r.branch_id IS NULL OR r.branch_id = l.branch_id)
  ),
  to_insert AS (
    SELECT p.* FROM pairs p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = p.user_id
        AND n.type = 'low_stock'
        AND n.related_entity_id = p.product_id
        AND n.created_at > now() - interval '24 hours'
    )
  ),
  ins AS (
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    SELECT user_id, tenant_id,
           'تنبيه مخزون منخفض: ' || name,
           'المتوفر ' || quantity || ' — الحد ' || low_stock_alert || COALESCE(' — فرع ' || branch_name, ''),
           'low_stock', 'product', product_id, '/admin/catalog?tab=inventory'
    FROM to_insert
    RETURNING 1
  )
  SELECT count(*) INTO v_low FROM ins;

  WITH ovd AS (
    SELECT i.id, (i.amount - i.paid_amount) AS amount_due, i.due_date, pl.entity_name, pl.branch_id, pl.tenant_id, b.name AS branch_name
    FROM public.payment_installments i
    JOIN public.payment_plans pl ON pl.id = i.payment_plan_id
    LEFT JOIN public.branches b ON b.id = pl.branch_id
    WHERE i.status IN ('overdue','pending')
      AND i.due_date < CURRENT_DATE
      AND (i.amount - i.paid_amount) > 0
  ),
  admins AS (
    SELECT pr.id AS user_id, pr.tenant_id
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.id
    WHERE ur.role IN ('admin','supervisor')
  ),
  pairs AS (
    SELECT DISTINCT a.user_id, a.tenant_id, o.id AS inst_id, o.entity_name, o.amount_due, o.due_date, o.branch_name
    FROM admins a JOIN ovd o ON o.tenant_id = a.tenant_id
  ),
  to_insert AS (
    SELECT p.* FROM pairs p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = p.user_id
        AND n.type = 'overdue_installment'
        AND n.related_entity_id = p.inst_id
        AND n.created_at > now() - interval '24 hours'
    )
  ),
  ins AS (
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    SELECT user_id, tenant_id,
           'قسط متأخر: ' || COALESCE(entity_name,'—'),
           'مستحق ' || amount_due::text || ' ج — تاريخ الاستحقاق ' || due_date::text || COALESCE(' — فرع ' || branch_name, ''),
           'overdue_installment', 'payment_installment', inst_id, '/admin/finance?tab=receivables'
    FROM to_insert
    RETURNING 1
  )
  SELECT count(*) INTO v_ovd FROM ins;

  RETURN QUERY SELECT v_low, v_ovd;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.notify_low_stock_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_branch_name text;
BEGIN
  IF COALESCE(NEW.low_stock_alert,0) <= 0 THEN RETURN NEW; END IF;
  IF NEW.quantity > NEW.low_stock_alert THEN RETURN NEW; END IF;
  IF COALESCE(OLD.quantity, -1) <= COALESCE(OLD.low_stock_alert, 0)
     AND COALESCE(OLD.low_stock_alert,0) > 0 THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_branch_name FROM public.branches WHERE id = NEW.branch_id;

  INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
  SELECT r.user_id, NEW.tenant_id,
         CASE WHEN NEW.quantity <= 0 THEN 'نفد المخزون: ' ELSE 'تنبيه مخزون منخفض: ' END || NEW.name,
         'المتوفر ' || NEW.quantity || ' — الحد ' || NEW.low_stock_alert || COALESCE(' — فرع ' || v_branch_name, ''),
         'low_stock', 'product', NEW.id, '/admin/catalog?tab=inventory'
  FROM (
    SELECT DISTINCT pr.id AS user_id
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.id
    LEFT JOIN public.branch_users bu ON bu.user_id = pr.id
    WHERE pr.tenant_id = NEW.tenant_id
      AND (
        ur.role IN ('admin','supervisor','owner')
        OR (ur.role IN ('branch_manager','warehouse') AND bu.branch_id = NEW.branch_id)
      )
  ) r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = r.user_id
      AND n.type = 'low_stock'
      AND n.related_entity_id = NEW.id
      AND n.created_at > now() - interval '6 hours'
  );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;
CREATE TRIGGER trg_notify_low_stock
AFTER UPDATE OF quantity, low_stock_alert ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.notify_low_stock_threshold();