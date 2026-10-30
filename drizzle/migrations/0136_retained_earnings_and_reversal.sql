-- 0136: one «الأرباح المحتجزة» account + cancelling a profit distribution takes it back ONCE (owner «نفذ», 2026-10-30)
--
-- 1) The books had two accounts named «الأرباح المحتجزة»: 3300 (active, empty) and 3800 (renamed «مكرر - معطل» and
--    switched off). Every function writes to 3800: opening stock (1,973,816 already there), the profit distribution and
--    the year-end closing. Instead of moving the code, 3800 becomes the official account again and the empty 3300 is
--    switched off. No entry moves; only names and the active flag change. A company whose 3300 already has entries is
--    left alone.
-- 2) reverse_profit_distribution voided the partner's «profit_share» row (−35,945 on his balance) AND added a
--    «capital_adjustment» of −35,945 → he lost the share twice. Now the void alone takes it back.
--    It also DELETED the rows «this advance was settled by this distribution»; now they are kept and marked cancelled.

UPDATE public.chart_of_accounts c
   SET is_active = true, name = 'Retained Earnings', name_ar = 'الأرباح المحتجزة'
 WHERE c.code = '3800'
   AND NOT EXISTS (SELECT 1 FROM public.journal_entry_lines l JOIN public.chart_of_accounts c3 ON c3.id = l.account_id
                    WHERE c3.tenant_id = c.tenant_id AND c3.code = '3300');

UPDATE public.chart_of_accounts c
   SET is_active = false, name = 'Retained Earnings (old, unused)', name_ar = 'أرباح محتجزة (قديم - غير مستخدم)'
 WHERE c.code = '3300'
   AND NOT EXISTS (SELECT 1 FROM public.journal_entry_lines l WHERE l.account_id = c.id);

ALTER TABLE public.partner_advance_payments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE OR REPLACE FUNCTION public.reverse_profit_distribution(p_tenant_id uuid, p_distribution_id uuid, p_reason text DEFAULT 'Reversal'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dist RECORD; v_line RECORD; v_adv RECORD;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF p_tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'غير مصرح'; END IF;

  SELECT * INTO v_dist FROM public.profit_distributions
   WHERE id = p_distribution_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التوزيع غير موجود'; END IF;
  IF v_dist.status = 'reversed' THEN RAISE EXCEPTION 'التوزيع سبق عكسه'; END IF;

  -- Reverse (not delete) the journal entry -> preserves audit trail
  PERFORM public.reverse_journal_for_source(
    p_tenant_id, 'profit_distribution', p_distribution_id, COALESCE(p_reason, 'Reversal')
  );

  -- 0136: voiding the share is the whole reversal (no extra «capital_adjustment» — it took the share twice)
  FOR v_line IN
    SELECT * FROM public.profit_distribution_lines WHERE distribution_id = p_distribution_id
  LOOP
    IF v_line.partner_transaction_id IS NOT NULL THEN
      UPDATE public.partner_transactions
        SET is_void = TRUE,
            description = COALESCE(description,'') || ' [ملغي: عكس توزيع ' || COALESCE(p_reason,'') || ']'
      WHERE id = v_line.partner_transaction_id;
    END IF;
  END LOOP;

  -- Restore partner advances that were settled by this distribution
  FOR v_adv IN
    SELECT pap.advance_id AS advance_id, SUM(pap.amount) AS total
      FROM public.partner_advance_payments pap
     WHERE pap.reference_type = 'profit_distribution'
       AND pap.reference_id = p_distribution_id
       AND pap.status = 'active'
     GROUP BY pap.advance_id
  LOOP
    UPDATE public.partner_advances pa
       SET remaining_amount = LEAST(pa.amount, COALESCE(pa.remaining_amount,0) + v_adv.total),
           status = CASE WHEN pa.status = 'cancelled' THEN pa.status ELSE 'active' END,
           updated_at = now()
     WHERE pa.id = v_adv.advance_id
       AND pa.tenant_id = p_tenant_id;

    UPDATE public.partner_advance_installments pai
       SET status = 'pending'
     WHERE pai.advance_id = v_adv.advance_id
       AND pai.id IN (
         SELECT installment_id FROM public.partner_advance_payments
          WHERE reference_type = 'profit_distribution' AND reference_id = p_distribution_id
            AND installment_id IS NOT NULL AND status = 'active'
       );
  END LOOP;

  -- 0136: keep the rows, mark them cancelled (no delete)
  UPDATE public.partner_advance_payments
     SET status = 'cancelled', cancelled_at = now()
   WHERE reference_type = 'profit_distribution' AND reference_id = p_distribution_id AND status = 'active';

  UPDATE public.profit_distributions
    SET status = 'reversed',
        notes = COALESCE(notes,'') || E'\n[REVERSED] ' || COALESCE(p_reason,'')
  WHERE id = p_distribution_id;
END $function$;

-- the FiscalClosing page and the guards still say 3800; the label is right again
COMMENT ON FUNCTION public.reverse_profit_distribution(uuid, uuid, text) IS
  '0136: voids the distribution''s profit_share rows (once), reverses its journal entry, re-opens advances it settled; never deletes';
