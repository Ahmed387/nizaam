
-- Fix double-booking: system-generated vouchers from treasury rows whose
-- originating domain event already posts to GL should NOT post again.
CREATE OR REPLACE FUNCTION public.trg_voucher_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cat_code TEXT;
  v_lines JSONB;
  v_treasury_category TEXT;
  v_skip_categories TEXT[] := ARRAY[
    'sales',                  -- initial invoice payment (booked by trg_invoices_journal + trg_invoice_payments_journal)
    'sales_extra_payment',    -- extra invoice payment (booked by trg_invoice_payments_journal)
    'payment_in',             -- invoice payment (booked by trg_invoice_payments_journal)
    'payment_edit_new',       -- payment edit (booked by trg_invoice_payments_journal)
    'payment_edit_reversal',  -- payment edit reversal (booked by trg_invoice_payments_journal)
    'payment_in_void',        -- payment void (booked by trg_invoice_payments_journal)
    'purchase_return',        -- purchase return (booked by shipments/supplier flows)
    'purchase_shipment_payment',
    'supplier_payment',
    'partner_advance',
    'partner_advance_repayment',
    'partner_contribution',
    'partner_withdrawal',
    'branch_transfer_out',
    'branch_transfer_in'
  ];
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' AND COALESCE(NEW.amount,0) > 0 THEN
    -- If this voucher was auto-generated from a treasury row whose category is
    -- already booked upstream, skip posting to avoid double-entry.
    IF NEW.source = 'system' AND NEW.source_type = 'treasury' AND NEW.treasury_id IS NOT NULL THEN
      SELECT category INTO v_treasury_category FROM public.treasury WHERE id = NEW.treasury_id;
      IF v_treasury_category = ANY(v_skip_categories) THEN
        RETURN NEW;
      END IF;
    END IF;

    SELECT gl_account_code INTO v_cat_code FROM public.voucher_categories WHERE id = NEW.category_id;

    IF NEW.type = 'receipt' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1100','debit',NEW.amount,'credit',0,'description','Receipt '||NEW.voucher_number),
        jsonb_build_object('account_code',COALESCE(v_cat_code,'4200'),'debit',0,'credit',NEW.amount,'description',COALESCE(NEW.description,'Receipt'))
      );
    ELSIF NEW.type = 'payment' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code',COALESCE(v_cat_code,'5500'),'debit',NEW.amount,'credit',0,'description',COALESCE(NEW.description,'Payment')),
        jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount,'description','Payment '||NEW.voucher_number)
      );
    ELSE
      RETURN NEW;
    END IF;

    PERFORM public.post_journal(NEW.tenant_id, NEW.voucher_date, NEW.type::text||' voucher '||NEW.voucher_number,
      'voucher', NEW.id, v_lines);

  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'voucher', NEW.id,
      'Voucher '||NEW.voucher_number||' cancelled');
  END IF;
  RETURN NEW;
END $function$;
