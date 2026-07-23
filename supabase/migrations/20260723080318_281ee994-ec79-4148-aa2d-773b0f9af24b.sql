
-- Phase 2.1: Make equity_partners balances derived from partner_transactions (source of truth).
-- Keeps existing columns to avoid breaking readers, but recomputes them idempotently from a view.

-- 1) Canonical view: balances derived from partner_transactions (ignores voided rows)
CREATE OR REPLACE VIEW public.v_partner_balances AS
SELECT
  p.id AS partner_id,
  p.tenant_id,
  COALESCE(SUM(CASE WHEN pt.transaction_type='contribution'      THEN pt.amount ELSE 0 END), 0) AS total_contributions,
  COALESCE(SUM(CASE WHEN pt.transaction_type='drawing'           THEN pt.amount ELSE 0 END), 0) AS total_drawings,
  COALESCE(SUM(CASE WHEN pt.transaction_type='profit_share'      THEN pt.amount ELSE 0 END), 0) AS total_profit_share,
  COALESCE(SUM(
    CASE pt.transaction_type
      WHEN 'contribution'        THEN  pt.amount
      WHEN 'drawing'             THEN -pt.amount
      WHEN 'profit_share'        THEN  pt.amount
      WHEN 'capital_adjustment'  THEN  pt.amount
      ELSE 0
    END
  ), 0) AS current_balance
FROM public.equity_partners p
LEFT JOIN public.partner_transactions pt
  ON pt.partner_id = p.id AND COALESCE(pt.is_void, false) = false
GROUP BY p.id, p.tenant_id;

GRANT SELECT ON public.v_partner_balances TO authenticated, service_role;

-- 2) Recompute helper — writes the mirror columns from the view for a single partner
CREATE OR REPLACE FUNCTION public.recompute_partner_balance(p_partner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.equity_partners ep
  SET total_contributions = v.total_contributions,
      total_drawings      = v.total_drawings,
      total_profit_share  = v.total_profit_share,
      current_balance     = v.current_balance,
      updated_at          = now()
  FROM public.v_partner_balances v
  WHERE v.partner_id = ep.id AND ep.id = p_partner_id;
END; $$;

-- 3) Tenant-wide recompute (for reconciliation button)
CREATE OR REPLACE FUNCTION public.recompute_all_partner_balances(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.equity_partners ep
  SET total_contributions = v.total_contributions,
      total_drawings      = v.total_drawings,
      total_profit_share  = v.total_profit_share,
      current_balance     = v.current_balance,
      updated_at          = now()
  FROM public.v_partner_balances v
  WHERE v.partner_id = ep.id AND ep.tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.recompute_partner_balance(uuid) FROM public;
REVOKE ALL ON FUNCTION public.recompute_all_partner_balances(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.recompute_partner_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_all_partner_balances(uuid) TO authenticated, service_role;

-- 4) Replace the fragile delta trigger with an idempotent full-recompute
CREATE OR REPLACE FUNCTION public.sync_partner_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_partner uuid;
BEGIN
  v_partner := COALESCE(NEW.partner_id, OLD.partner_id);
  IF v_partner IS NOT NULL THEN
    PERFORM public.recompute_partner_balance(v_partner);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

-- Ensure trigger fires on all mutations (was likely INSERT-only)
DROP TRIGGER IF EXISTS trg_sync_partner_balance ON public.partner_transactions;
CREATE TRIGGER trg_sync_partner_balance
AFTER INSERT OR UPDATE OR DELETE ON public.partner_transactions
FOR EACH ROW EXECUTE FUNCTION public.sync_partner_balance();

-- 5) One-time backfill: reconcile every partner to match the view (fixes any historical drift)
UPDATE public.equity_partners ep
SET total_contributions = v.total_contributions,
    total_drawings      = v.total_drawings,
    total_profit_share  = v.total_profit_share,
    current_balance     = v.current_balance,
    updated_at          = now()
FROM public.v_partner_balances v
WHERE v.partner_id = ep.id;
