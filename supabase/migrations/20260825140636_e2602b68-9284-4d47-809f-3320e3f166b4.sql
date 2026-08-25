CREATE OR REPLACE FUNCTION public.treasury_to_voucher_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type voucher_type;
  cat_id UUID;
  key TEXT;
  vnum TEXT;
  uname TEXT;
BEGIN
  IF current_setting('app.skip_treasury_voucher', true) = '1' THEN
    RETURN NEW;
  END IF;
  -- الأرصدة الافتتاحية بيتسجلها قيد «رصيد افتتاحي — نقدية الخزنة» مقابل حق الملكية الافتتاحي،
  -- فمينفعش تعمل كمان سند قبض (كان بيسجلها إيراد ويكرر النقدية)
  IF COALESCE(NEW.category, '') = 'رصيد افتتاحي' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM vouchers WHERE treasury_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  v_type := CASE WHEN NEW.type = 'income' THEN 'receipt'::voucher_type ELSE 'payment'::voucher_type END;
  key := map_treasury_to_category_key(NEW);
  cat_id := get_system_category(NEW.tenant_id, v_type, key);
  vnum := next_voucher_number(NEW.tenant_id, v_type);
  SELECT name INTO uname FROM profiles WHERE id = NEW.created_by;

  INSERT INTO vouchers (
    tenant_id, branch_id, voucher_number, type, source, source_type, source_id,
    treasury_id, category_id, amount, payment_method, reference_number,
    transferred_to, description, voucher_date, created_by, created_by_name
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, vnum, v_type, 'system',
    'treasury', NEW.reference_id, NEW.id, cat_id, NEW.amount,
    NEW.payment_method, NEW.reference_number, NEW.transfer_to_account,
    NEW.description, NEW.created_at::date, NEW.created_by, uname
  );
  RETURN NEW;
END;
$$;