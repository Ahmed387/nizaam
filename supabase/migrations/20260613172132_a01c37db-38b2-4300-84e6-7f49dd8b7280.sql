
CREATE OR REPLACE FUNCTION public.generate_alerts()
RETURNS TABLE(low_stock_notifs int, overdue_notifs int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  admins AS (
    SELECT pr.id AS user_id, pr.tenant_id
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.id
    WHERE ur.role IN ('admin','supervisor')
  ),
  pairs AS (
    SELECT a.user_id, a.tenant_id, l.id AS product_id, l.name, l.quantity, l.low_stock_alert, l.branch_name
    FROM admins a JOIN low l ON l.tenant_id = a.tenant_id
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
    SELECT a.user_id, a.tenant_id, o.id AS inst_id, o.entity_name, o.amount_due, o.due_date, o.branch_name
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
$$;
