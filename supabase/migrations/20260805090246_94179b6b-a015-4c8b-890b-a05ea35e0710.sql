-- 1) Helper: real outstanding debt on a sales invoice
CREATE OR REPLACE FUNCTION public.invoice_outstanding_debt(_invoice_id uuid, _exclude_return_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(
    COALESCE((SELECT i.total FROM public.invoices i WHERE i.id = _invoice_id AND i.status = 'active'), 0)
    - COALESCE((SELECT SUM(ip.amount) FROM public.invoice_payments ip
                 WHERE ip.invoice_id = _invoice_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL), 0)
    - COALESCE((SELECT SUM(GREATEST(COALESCE(r.total_refund,0) - COALESCE(r.refund_cash_amount,0) - COALESCE(r.refund_transfer_amount,0), 0))
                  FROM public.returns r
                 WHERE r.invoice_id = _invoice_id
                   AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')
                   AND (_exclude_return_id IS NULL OR r.id <> _exclude_return_id)), 0)
  , 0);
$$;

-- 2) Helper: outstanding payable to a supplier (contact ledger)
CREATE OR REPLACE FUNCTION public.supplier_outstanding_payable(_contact_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(-COALESCE((SELECT v.ledger_balance FROM public.v_contact_balances v WHERE v.contact_id = _contact_id), 0), 0);
$$;

-- 3) Sales return: debt first, then cash. Also force active status.
CREATE OR REPLACE FUNCTION public.allocate_sale_return_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric := COALESCE(NEW.total_refund, 0);
  v_debt numeric := 0;
  v_bal numeric := 0;
  v_excess numeric := 0;
  v_method text := COALESCE(NULLIF(NEW.refund_method,''), 'cash');
  v_contact uuid;
BEGIN
  -- Draft returns are no longer allowed anywhere in the system
  IF COALESCE(NEW.status, 'active') = 'draft' THEN
    NEW.status := 'active';
  END IF;
  IF COALESCE(NEW.status, 'active') <> 'active' THEN
    RETURN NEW;
  END IF;
  NEW.status := 'active';

  SELECT i.contact_id INTO v_contact FROM public.invoices i WHERE i.id = NEW.invoice_id;

  IF v_contact IS NOT NULL THEN
    v_debt := public.invoice_outstanding_debt(NEW.invoice_id, NEW.id);
  END IF;

  v_bal := LEAST(v_total, v_debt);          -- never below zero debt (no negative/credit balance)
  v_excess := GREATEST(v_total - v_bal, 0); -- surplus is refunded as real money

  NEW.refund_balance_amount := v_bal;
  IF v_method IN ('cash', 'balance') THEN
    NEW.refund_cash_amount := v_excess;
    NEW.refund_transfer_amount := 0;
    IF v_excess > 0 AND v_method = 'balance' THEN NEW.refund_method := 'cash'; END IF;
    IF v_excess = 0 THEN NEW.refund_method := 'balance'; END IF;
  ELSE
    NEW.refund_cash_amount := 0;
    NEW.refund_transfer_amount := v_excess;
    IF v_excess = 0 THEN NEW.refund_method := 'balance'; END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_allocate_sale_return ON public.returns;
CREATE TRIGGER trg_allocate_sale_return
BEFORE INSERT ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.allocate_sale_return_settlement();

-- 4) Purchase return: supplier payable first, then cash back into treasury
CREATE OR REPLACE FUNCTION public.allocate_purchase_return_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric := COALESCE(NEW.total_amount, 0);
  v_debt numeric := 0;
  v_bal numeric := 0;
  v_excess numeric := 0;
  v_method text := COALESCE(NULLIF(NEW.refund_method,''), 'cash');
BEGIN
  IF COALESCE(NEW.status, 'active') = 'draft' THEN
    NEW.status := 'active';
  END IF;
  IF COALESCE(NEW.status, 'active') <> 'active' THEN
    RETURN NEW;
  END IF;
  NEW.status := 'active';

  IF NEW.contact_id IS NOT NULL THEN
    v_debt := public.supplier_outstanding_payable(NEW.contact_id);
  END IF;

  v_bal := LEAST(v_total, v_debt);
  v_excess := GREATEST(v_total - v_bal, 0);

  NEW.refund_balance_amount := v_bal;
  IF v_method IN ('cash', 'balance') THEN
    NEW.refund_cash_amount := v_excess;
    NEW.refund_transfer_amount := 0;
    IF v_excess > 0 AND v_method = 'balance' THEN NEW.refund_method := 'cash'; END IF;
    IF v_excess = 0 THEN NEW.refund_method := 'balance'; END IF;
  ELSE
    NEW.refund_cash_amount := 0;
    NEW.refund_transfer_amount := v_excess;
    IF v_excess = 0 THEN NEW.refund_method := 'balance'; END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_allocate_purchase_return ON public.purchase_returns;
CREATE TRIGGER trg_allocate_purchase_return
BEFORE INSERT ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.allocate_purchase_return_settlement();

-- 5) Block any attempt to move a return back to draft
CREATE OR REPLACE FUNCTION public.block_draft_returns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.status,'active') = 'draft' THEN
    RAISE EXCEPTION 'حالة المسودة لم تعد متاحة للمرتجعات — كل مرتجع بيتسجل نشط فورًا';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_draft_returns ON public.returns;
CREATE TRIGGER trg_block_draft_returns
BEFORE UPDATE ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.block_draft_returns();

DROP TRIGGER IF EXISTS trg_block_draft_purchase_returns ON public.purchase_returns;
CREATE TRIGGER trg_block_draft_purchase_returns
BEFORE UPDATE ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.block_draft_returns();

-- 6) Owner notification on every new return
CREATE OR REPLACE FUNCTION public.notify_owner_new_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text;
  v_amount numeric;
  v_docnum text;
  v_branch text;
  v_user text;
  v_link text;
BEGIN
  IF TG_TABLE_NAME = 'returns' THEN
    v_kind := 'مرتجع بيع';
    v_amount := COALESCE(NEW.total_refund, 0);
    SELECT i.invoice_number INTO v_docnum FROM public.invoices i WHERE i.id = NEW.invoice_id;
    v_link := '/branch/' || NEW.branch_id || '/invoices?tab=sale_return';
  ELSE
    v_kind := 'مرتجع شراء';
    v_amount := COALESCE(NEW.total_amount, 0);
    SELECT s.shipment_number INTO v_docnum FROM public.shipments s WHERE s.id = NEW.shipment_id;
    v_link := '/branch/' || NEW.branch_id || '/invoices?tab=purchase_return';
  END IF;

  SELECT b.name INTO v_branch FROM public.branches b WHERE b.id = NEW.branch_id;
  SELECT p.name INTO v_user FROM public.profiles p WHERE p.id = NEW.created_by;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
  SELECT NEW.tenant_id, ur.user_id,
         v_kind || ' جديد بقيمة ' || to_char(v_amount, 'FM999999990.00') || ' ج.م',
         'الفاتورة/الشحنة: ' || COALESCE(v_docnum, '—') ||
         ' • الفرع: ' || COALESCE(v_branch, '—') ||
         ' • بواسطة: ' || COALESCE(v_user, '—'),
         CASE WHEN TG_TABLE_NAME = 'returns' THEN 'sale_return_created' ELSE 'purchase_return_created' END,
         v_link,
         TG_TABLE_NAME,
         NEW.id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role = 'owner' AND p.tenant_id = NEW.tenant_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_owner_sale_return ON public.returns;
CREATE TRIGGER trg_notify_owner_sale_return
AFTER INSERT ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.notify_owner_new_return();

DROP TRIGGER IF EXISTS trg_notify_owner_purchase_return ON public.purchase_returns;
CREATE TRIGGER trg_notify_owner_purchase_return
AFTER INSERT ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.notify_owner_new_return();

-- 7) register_sale_return_full: always active, split recomputed by the trigger
CREATE OR REPLACE FUNCTION public.register_sale_return_full(_invoice_id uuid, _reason text, _notes text, _status text, _refund_method text, _refund_reference text, _refund_account text, _refund_cash_amount numeric, _refund_transfer_amount numeric, _refund_balance_amount numeric, _items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv record;
  uid uuid := auth.uid();
  rt_id uuid;
  rn text;
  it jsonb;
  v_pid uuid;
  v_qty int;
  v_refund numeric;
  v_total numeric := 0;
  v_already numeric;
  v_sold numeric;
  v_row record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF inv IS NULL THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة';
  END IF;
  IF NOT public.user_in_branch(uid, inv.branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF(it->>'product_id', '')::uuid;
    v_qty := COALESCE((it->>'quantity')::int, 0);
    v_refund := COALESCE((it->>'refund')::numeric, 0);
    IF v_pid IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'بيانات صنف المرتجع غير صحيحة';
    END IF;

    SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(returned_quantity), 0)
      INTO v_sold, v_already
    FROM public.invoice_items
    WHERE invoice_id = _invoice_id AND product_id = v_pid;

    IF v_sold <= 0 THEN
      RAISE EXCEPTION 'الصنف غير موجود في الفاتورة';
    END IF;
    IF (v_already + v_qty) > v_sold THEN
      RAISE EXCEPTION 'كمية المرتجع أكبر من المتاح للإرجاع';
    END IF;

    v_total := v_total + v_refund;
  END LOOP;

  rn := public.next_sale_return_number();

  INSERT INTO public.returns(
    invoice_id, branch_id, reason, notes, created_by, total_refund, status,
    refund_method, refund_reference, refund_account,
    refund_cash_amount, refund_transfer_amount, refund_balance_amount,
    return_number, tenant_id
  ) VALUES (
    _invoice_id, inv.branch_id, _reason, NULLIF(_notes, ''), uid, v_total, 'active',
    COALESCE(NULLIF(_refund_method,''), 'cash'), NULLIF(_refund_reference, ''), NULLIF(_refund_account, ''),
    0, 0, 0,
    rn, inv.tenant_id
  ) RETURNING id INTO rt_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.return_items(return_id, product_id, quantity, refund, tenant_id)
    VALUES (
      rt_id,
      NULLIF(it->>'product_id', '')::uuid,
      COALESCE((it->>'quantity')::int, 0),
      COALESCE((it->>'refund')::numeric, 0),
      inv.tenant_id
    );
  END LOOP;

  PERFORM public.apply_return_batch_tracking(
    _invoice_id,
    (SELECT jsonb_agg(jsonb_build_object('product_id', x->>'product_id', 'quantity', (x->>'quantity')::int)) FROM jsonb_array_elements(_items) AS x)
  );

  SELECT refund_balance_amount, refund_cash_amount, refund_transfer_amount, refund_method
    INTO v_row FROM public.returns WHERE id = rt_id;

  RETURN jsonb_build_object(
    'id', rt_id, 'return_number', rn, 'total_refund', v_total, 'status', 'active',
    'applied_to_debt', v_row.refund_balance_amount,
    'cash_refund', v_row.refund_cash_amount,
    'transfer_refund', v_row.refund_transfer_amount,
    'refund_method', v_row.refund_method
  );
END;
$function$;