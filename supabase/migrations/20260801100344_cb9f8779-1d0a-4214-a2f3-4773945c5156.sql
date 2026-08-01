CREATE OR REPLACE FUNCTION public.trg_invoice_payment_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB;
  v_acct text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.voided_at IS NULL AND COALESCE(NEW.amount,0) > 0 THEN
    v_acct := CASE WHEN LOWER(COALESCE(NEW.payment_method,'cash')) = 'cash' THEN '1100' ELSE '1110' END;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code',v_acct,'debit',NEW.amount,'credit',0,'description','Payment received'),
      jsonb_build_object('account_code','1200','debit',0,'credit',NEW.amount,'description','AR settlement')
    );
    PERFORM public.post_journal(NEW.tenant_id, CURRENT_DATE, 'Invoice payment',
      'invoice_payment', NEW.id, v_lines);
  ELSIF TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'invoice_payment', NEW.id, 'Payment voided');
  END IF;
  RETURN NEW;
END
$$;