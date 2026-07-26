
-- ============================================================
-- STEP 1: Fix trg_partner_tx_journal — skip if RPC already posted a journal
-- (partner_withdraw_from_distribution posts its own journal with source_id=NEW.id)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_partner_tx_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lines JSONB; v_exists boolean;
BEGIN
  IF TG_OP <> 'INSERT' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;

  -- Skip if any RPC already created a journal for this partner_transaction
  SELECT EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_id = NEW.id
      AND source_type IN ('partner_withdrawal','partner_transaction','partner_contribution')
  ) INTO v_exists;
  IF v_exists THEN RETURN NEW; END IF;

  IF NEW.transaction_type ILIKE 'contribution%' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1100','debit',NEW.amount,'credit',0,'description','Partner contribution'),
      jsonb_build_object('account_code','3100','debit',0,'credit',NEW.amount,'description',COALESCE(NEW.description,'Contribution'))
    );
  ELSIF NEW.transaction_type ILIKE 'drawing%' OR NEW.transaction_type ILIKE 'withdraw%' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','3200','debit',NEW.amount,'credit',0,'description',COALESCE(NEW.description,'Drawing')),
      jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount,'description','Partner drawing')
    );
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.post_journal(NEW.tenant_id, CURRENT_DATE,
    'Partner '||NEW.transaction_type, 'partner_transaction', NEW.id, v_lines);
  RETURN NEW;
END $function$;

-- ============================================================
-- STEP 2: Add treasury insert to trg_partner_advance_journal
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_partner_advance_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lines JSONB;
  v_branch_id UUID;
BEGIN
  IF TG_OP = 'INSERT' AND COALESCE(NEW.amount,0) > 0 THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1400','debit',NEW.amount,'credit',0,'description','Advance to partner'),
      jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount,'description',COALESCE(NEW.reason,'Partner advance'))
    );
    PERFORM public.post_journal(NEW.tenant_id, NEW.advance_date,
      'Partner advance disbursement', 'partner_advance', NEW.id, v_lines);

    -- Mirror cash-out into the partner treasury so treasury table stays consistent with GL
    SELECT id INTO v_branch_id FROM public.branches
     WHERE tenant_id = NEW.tenant_id AND code = 'PARTNER-CASH' LIMIT 1;
    IF v_branch_id IS NOT NULL THEN
      INSERT INTO public.treasury (
        tenant_id, branch_id, type, category, amount, description,
        reference_id, payment_method, created_by
      ) VALUES (
        NEW.tenant_id, v_branch_id, 'expense', 'partner_advance', NEW.amount,
        COALESCE(NEW.reason,'Partner advance disbursement'),
        NEW.id, 'cash', COALESCE(NEW.created_by, auth.uid())
      );
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ============================================================
-- STEP 3: Backfill — remove duplicate drawing GL entries
-- Where a partner_withdrawal journal already exists for the same partner_transactions.id
-- ============================================================
WITH dupes AS (
  SELECT je_dup.id AS dup_id
  FROM public.journal_entries je_dup
  JOIN public.journal_entries je_orig
    ON je_orig.source_id = je_dup.source_id
   AND je_orig.source_type = 'partner_withdrawal'
   AND je_orig.id <> je_dup.id
  WHERE je_dup.source_type = 'partner_transaction'
)
DELETE FROM public.journal_entry_lines WHERE entry_id IN (SELECT dup_id FROM dupes);

WITH dupes AS (
  SELECT je_dup.id AS dup_id
  FROM public.journal_entries je_dup
  JOIN public.journal_entries je_orig
    ON je_orig.source_id = je_dup.source_id
   AND je_orig.source_type = 'partner_withdrawal'
   AND je_orig.id <> je_dup.id
  WHERE je_dup.source_type = 'partner_transaction'
)
DELETE FROM public.journal_entries WHERE id IN (SELECT dup_id FROM dupes);

-- ============================================================
-- STEP 4: Backfill — insert missing treasury rows for existing partner advances
-- ============================================================
INSERT INTO public.treasury (
  tenant_id, branch_id, type, category, amount, description,
  reference_id, payment_method, created_by, created_at
)
SELECT
  pa.tenant_id,
  b.id,
  'expense'::treasury_type,
  'partner_advance',
  pa.amount,
  COALESCE(pa.reason,'Partner advance disbursement (backfill)'),
  pa.id,
  'cash',
  COALESCE(pa.created_by, t.owner_user_id),
  pa.created_at
FROM public.partner_advances pa
JOIN public.branches b
  ON b.tenant_id = pa.tenant_id AND b.code = 'PARTNER-CASH'
JOIN public.tenants t ON t.id = pa.tenant_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.treasury t
  WHERE t.reference_id = pa.id AND t.category = 'partner_advance'
);
