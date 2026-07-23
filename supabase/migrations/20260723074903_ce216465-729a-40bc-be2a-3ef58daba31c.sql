
CREATE OR REPLACE FUNCTION public.reverse_profit_distribution(
  p_tenant_id uuid,
  p_distribution_id uuid,
  p_reason text DEFAULT 'Reversal'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dist RECORD;
  v_line RECORD;
BEGIN
  SELECT * INTO v_dist FROM public.profit_distributions
   WHERE id = p_distribution_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التوزيع غير موجود'; END IF;
  IF v_dist.status = 'reversed' THEN RAISE EXCEPTION 'التوزيع سبق عكسه'; END IF;

  -- 1) Reverse the GL journal entry (creates a mirrored posted entry)
  PERFORM public.reverse_journal_for_source(
    p_tenant_id, 'profit_distribution', p_distribution_id,
    COALESCE(p_reason, 'Reversal')
  );

  -- 2) Insert compensating partner_transactions and void the originals
  FOR v_line IN
    SELECT * FROM public.profit_distribution_lines WHERE distribution_id = p_distribution_id
  LOOP
    -- Void original transaction (does not auto-adjust balance)
    IF v_line.partner_transaction_id IS NOT NULL THEN
      UPDATE public.partner_transactions
        SET is_void = TRUE, description = COALESCE(description,'') || ' [REVERSED]'
      WHERE id = v_line.partner_transaction_id;
    END IF;

    -- Compensating capital_adjustment with negative amount (trigger applies +amount)
    INSERT INTO public.partner_transactions(
      tenant_id, partner_id, transaction_type, amount, description, month_year, created_by
    ) VALUES (
      p_tenant_id, v_line.partner_id, 'capital_adjustment',
      -v_line.amount,
      'عكس توزيع أرباح #' || substr(p_distribution_id::text,1,8) || ' — ' || COALESCE(p_reason,''),
      to_char(CURRENT_DATE,'YYYY-MM'),
      auth.uid()
    );
    -- Restore total_profit_share counter
    UPDATE public.equity_partners
      SET total_profit_share = GREATEST(0, total_profit_share - v_line.amount)
    WHERE id = v_line.partner_id;
  END LOOP;

  -- 3) Remove advance offset payments created by this distribution (restores advance balances)
  DELETE FROM public.partner_advance_payments
   WHERE reference_type = 'profit_distribution'
     AND reference_id = p_distribution_id;

  -- 4) Mark distribution as reversed
  UPDATE public.profit_distributions
    SET status = 'reversed',
        notes = COALESCE(notes,'') || E'\n[REVERSED] ' || COALESCE(p_reason,'')
  WHERE id = p_distribution_id;
END $$;

GRANT EXECUTE ON FUNCTION public.reverse_profit_distribution(uuid, uuid, text) TO authenticated;
