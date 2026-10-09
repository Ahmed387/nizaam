-- =============================================================================================
-- Step 6A — unified ledger schema: money_movements + payment_allocations + accounts 2150/1460/1910
-- No behaviour change: nothing writes to these tables yet (6B adds capture, backfill and the
-- allocation engine) and nothing posts to the new accounts yet (6D, with Phase 5).
--
--   1. money_movements      one row per money / credit event of a contact, on ONE side
--                           (customer or supplier). Sides never meet: there is no netting kind.
--   2. payment_allocations  which settling movement paid which debt (invoice, purchase invoice or a
--                           charge movement), direct or FIFO, with its branch pair for clearing.
--   3. Guards               validation, immutability (correction = cancel / supersede, never delete),
--                           invariants (never allocate more than a movement or a debt holds).
--   4. Access               read per branch through RLS; no browser writes.
--   5. Accounts             2150 Customer Advances, 1460 Supplier Advances, 1910 Inter-Branch
--                           Current Account — for every existing company and every new one.
--
-- Vocabulary
--   side    customer | supplier            which ledger of the contact
--   effect  settle   reduces what is open on that side (payment, deposit, return credit, opening advance)
--           charge   adds to what is open, like a document (refund paid back, opening debt)
--   kind    payment | deposit | refund | return_credit | opening
--   Debts that allocations settle: sale invoices (customer), purchase invoices (supplier) and
--   charge movements. Credits: settle movements. Whatever is left unallocated is the advance:
--   2150 for a customer, 1460 for a supplier.
-- =============================================================================================

-- =============================================================================================
-- 1. money_movements
-- =============================================================================================
CREATE TABLE IF NOT EXISTS public.money_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
  branch_id       uuid NOT NULL REFERENCES public.branches(id),      -- where it happened (till / bank of that branch)
  contact_id      uuid REFERENCES public.contacts(id),               -- NULL only for a walk-in sale payment
  side            text NOT NULL CHECK (side IN ('customer', 'supplier')),
  kind            text NOT NULL CHECK (kind IN ('payment', 'deposit', 'refund', 'return_credit', 'opening')),
  effect          text NOT NULL CHECK (effect IN ('settle', 'charge')),
  is_cash         boolean GENERATED ALWAYS AS (kind IN ('payment', 'deposit', 'refund')) STORED,
  direction       text GENERATED ALWAYS AS (
                    CASE WHEN kind IN ('return_credit', 'opening') THEN NULL
                         WHEN (side = 'customer') = (kind IN ('payment', 'deposit')) THEN 'in'
                         ELSE 'out' END) STORED,                  -- money into / out of the company
  method          text,                                              -- cash, instapay, bank … (NULL when not cash)
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  movement_date   date NOT NULL,                                     -- accounting date (Cairo)
  target_doc_type text CHECK (target_doc_type IN ('invoice', 'shipment')),
  target_doc_id   uuid,                                              -- set = direct allocation to that document
  source_table    text NOT NULL,                                     -- the one origin row of this event
  source_id       uuid NOT NULL,
  treasury_id     uuid REFERENCES public.treasury(id),
  notes           text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  cancel_reason   text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mm_kind_effect CHECK (
       (kind IN ('payment', 'deposit', 'return_credit') AND effect = 'settle')
    OR (kind = 'refund' AND effect = 'charge')
    OR (kind = 'opening')),
  CONSTRAINT mm_cash_method CHECK ((kind IN ('payment', 'deposit', 'refund')) = (method IS NOT NULL)),
  CONSTRAINT mm_target_pair CHECK ((target_doc_type IS NULL) = (target_doc_id IS NULL)),
  CONSTRAINT mm_target_side CHECK (
       target_doc_type IS NULL
    OR (effect = 'settle' AND ((target_doc_type = 'invoice' AND side = 'customer')
                            OR (target_doc_type = 'shipment' AND side = 'supplier')))),
  CONSTRAINT mm_contact_required CHECK (contact_id IS NOT NULL OR (side = 'customer' AND target_doc_type IS NOT DISTINCT FROM 'invoice')),
  CONSTRAINT mm_cancel_fields CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT mm_source_unique UNIQUE (source_table, source_id, kind)
);
COMMENT ON TABLE public.money_movements IS
  'Unified movement ledger (Step 6A). One row per money/credit event of a contact on one side. No netting: customer and supplier sides never settle each other. Written only by server functions; never deleted (cancel only).';

CREATE INDEX IF NOT EXISTS mm_contact_side_idx ON public.money_movements (tenant_id, contact_id, side) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS mm_branch_date_idx  ON public.money_movements (branch_id, movement_date);
CREATE INDEX IF NOT EXISTS mm_target_idx       ON public.money_movements (target_doc_type, target_doc_id) WHERE target_doc_id IS NOT NULL;

-- =============================================================================================
-- 2. payment_allocations
-- =============================================================================================
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
  contact_id          uuid REFERENCES public.contacts(id),
  side                text NOT NULL CHECK (side IN ('customer', 'supplier')),
  movement_id         uuid NOT NULL REFERENCES public.money_movements(id),   -- the settling movement
  movement_branch_id  uuid NOT NULL REFERENCES public.branches(id),
  debt_type           text NOT NULL CHECK (debt_type IN ('invoice', 'shipment', 'movement')),
  debt_id             uuid NOT NULL,                                          -- invoice / shipment / charge movement
  debt_branch_id      uuid NOT NULL REFERENCES public.branches(id),
  amount              numeric(18,2) NOT NULL CHECK (amount > 0),
  mode                text NOT NULL CHECK (mode IN ('direct', 'fifo')),
  effective_date      date NOT NULL,                                          -- later of movement date and debt date
  is_cross_branch     boolean GENERATED ALWAYS AS (movement_branch_id <> debt_branch_id) STORED,
  run_id              uuid NOT NULL,                                          -- allocation run that produced it
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  superseded_at       timestamptz,
  superseded_by_run   uuid,
  clearing_journal_id uuid REFERENCES public.journal_entries(id),            -- 1910 pair, posted in 6D
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pa_superseded_fields CHECK ((status = 'superseded') = (superseded_at IS NOT NULL)),
  CONSTRAINT pa_debt_side CHECK (
       debt_type = 'movement'
    OR (debt_type = 'invoice' AND side = 'customer')
    OR (debt_type = 'shipment' AND side = 'supplier'))
);
COMMENT ON TABLE public.payment_allocations IS
  'Which settling movement paid which debt (Step 6A). Direct allocations come from a movement''s target document; FIFO fills the oldest open debts company-wide. Rows are never deleted: a re-run marks changed rows superseded.';

CREATE INDEX IF NOT EXISTS pa_debt_idx     ON public.payment_allocations (debt_type, debt_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS pa_movement_idx ON public.payment_allocations (movement_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS pa_contact_idx  ON public.payment_allocations (tenant_id, contact_id, side) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS pa_branch_idx   ON public.payment_allocations (debt_branch_id, effective_date) WHERE status = 'active';

-- =============================================================================================
-- 3. Guards
-- =============================================================================================
-- 3a. A movement belongs to its company: branch, contact and target document of the same tenant;
--     the target document belongs to the same contact.
CREATE OR REPLACE FUNCTION public.validate_money_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_t uuid; v_c uuid; v_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'money_movements: branch is not in the company';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'money_movements: contact is not in the company';
  END IF;
  IF NEW.target_doc_type = 'invoice' THEN
    SELECT tenant_id, contact_id INTO v_t, v_c FROM public.invoices WHERE id = NEW.target_doc_id;
  ELSIF NEW.target_doc_type = 'shipment' THEN
    SELECT tenant_id, contact_id INTO v_t, v_c FROM public.shipments WHERE id = NEW.target_doc_id;
  END IF;
  IF NEW.target_doc_type IS NOT NULL THEN
    IF v_t IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'money_movements: target document is not in the company';
    END IF;
    IF v_c IS DISTINCT FROM NEW.contact_id THEN
      RAISE EXCEPTION 'money_movements: target document belongs to another contact';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_validate_money_movement ON public.money_movements;
CREATE TRIGGER trg_validate_money_movement BEFORE INSERT ON public.money_movements
  FOR EACH ROW EXECUTE FUNCTION public.validate_money_movement();

-- 3b. A movement is immutable; only its cancellation fields change (once). Corrections are a cancel
--     plus a new movement, so history stays readable.
CREATE OR REPLACE FUNCTION public.guard_money_movement_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'money_movements: a cancelled movement is frozen';
  END IF;
  IF (NEW.tenant_id, NEW.branch_id, NEW.contact_id, NEW.side, NEW.kind, NEW.effect, NEW.method, NEW.amount,
      NEW.movement_date, NEW.target_doc_type, NEW.target_doc_id, NEW.source_table, NEW.source_id,
      NEW.treasury_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.branch_id, OLD.contact_id, OLD.side, OLD.kind, OLD.effect, OLD.method, OLD.amount,
      OLD.movement_date, OLD.target_doc_type, OLD.target_doc_id, OLD.source_table, OLD.source_id,
      OLD.treasury_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'money_movements: rows are immutable — cancel and record a new movement';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_guard_money_movement_update ON public.money_movements;
CREATE TRIGGER trg_guard_money_movement_update BEFORE UPDATE ON public.money_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_money_movement_update();

-- 3c. An allocation pairs a settling movement with a debt of the same company, contact and side.
CREATE OR REPLACE FUNCTION public.validate_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE m public.money_movements%ROWTYPE; v_t uuid; v_c uuid; v_b uuid; v_side text; v_effect text; v_status text;
BEGIN
  SELECT * INTO m FROM public.money_movements WHERE id = NEW.movement_id;
  IF m.effect <> 'settle' THEN RAISE EXCEPTION 'payment_allocations: the paying movement must be a settle movement'; END IF;
  IF m.status <> 'active' THEN RAISE EXCEPTION 'payment_allocations: the paying movement is cancelled'; END IF;
  IF m.tenant_id <> NEW.tenant_id OR m.side <> NEW.side OR m.contact_id IS DISTINCT FROM NEW.contact_id
     OR m.branch_id <> NEW.movement_branch_id THEN
    RAISE EXCEPTION 'payment_allocations: tenant, side, contact or branch differs from the movement';
  END IF;

  IF NEW.debt_type = 'invoice' THEN
    SELECT tenant_id, contact_id, branch_id, status INTO v_t, v_c, v_b, v_status FROM public.invoices WHERE id = NEW.debt_id;
    v_side := 'customer';
  ELSIF NEW.debt_type = 'shipment' THEN
    SELECT tenant_id, contact_id, branch_id, status INTO v_t, v_c, v_b, v_status FROM public.shipments WHERE id = NEW.debt_id;
    v_side := 'supplier';
  ELSE
    SELECT tenant_id, contact_id, branch_id, status, side, effect INTO v_t, v_c, v_b, v_status, v_side, v_effect
      FROM public.money_movements WHERE id = NEW.debt_id;
    IF v_effect IS DISTINCT FROM 'charge' THEN RAISE EXCEPTION 'payment_allocations: a movement debt must be a charge movement'; END IF;
  END IF;
  IF v_t IS NULL THEN RAISE EXCEPTION 'payment_allocations: debt not found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'payment_allocations: the debt is not active'; END IF;
  -- No netting: the debt is on the same side and the same contact as the money that pays it.
  IF v_t <> NEW.tenant_id OR v_side <> NEW.side OR v_c IS DISTINCT FROM NEW.contact_id OR v_b <> NEW.debt_branch_id THEN
    RAISE EXCEPTION 'payment_allocations: debt tenant, side, contact or branch differs';
  END IF;
  IF NEW.mode = 'direct' AND (m.target_doc_type IS DISTINCT FROM NEW.debt_type OR m.target_doc_id IS DISTINCT FROM NEW.debt_id) THEN
    RAISE EXCEPTION 'payment_allocations: a direct allocation must go to the movement''s target document';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_validate_payment_allocation ON public.payment_allocations;
CREATE TRIGGER trg_validate_payment_allocation BEFORE INSERT ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_allocation();

-- 3d. Allocations are immutable except for being superseded once (and the clearing link, 6D).
CREATE OR REPLACE FUNCTION public.guard_payment_allocation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF OLD.status = 'superseded' AND NEW.status = 'superseded'
     AND NEW.clearing_journal_id IS NOT DISTINCT FROM OLD.clearing_journal_id THEN
    RAISE EXCEPTION 'payment_allocations: a superseded allocation is frozen';
  END IF;
  IF NEW.status = 'active' AND OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'payment_allocations: a superseded allocation cannot be reactivated';
  END IF;
  IF (NEW.tenant_id, NEW.contact_id, NEW.side, NEW.movement_id, NEW.movement_branch_id, NEW.debt_type, NEW.debt_id,
      NEW.debt_branch_id, NEW.amount, NEW.mode, NEW.effective_date, NEW.run_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.contact_id, OLD.side, OLD.movement_id, OLD.movement_branch_id, OLD.debt_type, OLD.debt_id,
      OLD.debt_branch_id, OLD.amount, OLD.mode, OLD.effective_date, OLD.run_id, OLD.created_at) THEN
    RAISE EXCEPTION 'payment_allocations: rows are immutable — supersede and insert a new allocation';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_guard_payment_allocation_update ON public.payment_allocations;
CREATE TRIGGER trg_guard_payment_allocation_update BEFORE UPDATE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_allocation_update();

-- 3e. Invariants, checked at commit (a run may supersede and insert in any order):
--     Σ active allocations of a movement ≤ its amount; Σ active allocations of a debt ≤ the debt.
CREATE OR REPLACE FUNCTION public.check_allocation_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_alloc numeric; v_limit numeric;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v_alloc FROM public.payment_allocations
   WHERE movement_id = NEW.movement_id AND status = 'active';
  SELECT amount INTO v_limit FROM public.money_movements WHERE id = NEW.movement_id;
  IF v_alloc > v_limit + 0.005 THEN
    RAISE EXCEPTION 'payment_allocations: movement % allocated % of %', NEW.movement_id, v_alloc, v_limit;
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_alloc FROM public.payment_allocations
   WHERE debt_type = NEW.debt_type AND debt_id = NEW.debt_id AND status = 'active';
  v_limit := CASE NEW.debt_type
    WHEN 'invoice'  THEN (SELECT total      FROM public.invoices        WHERE id = NEW.debt_id)
    WHEN 'shipment' THEN (SELECT total_cost FROM public.shipments       WHERE id = NEW.debt_id)
    ELSE                 (SELECT amount     FROM public.money_movements WHERE id = NEW.debt_id) END;
  IF v_alloc > COALESCE(v_limit, 0) + 0.005 THEN
    RAISE EXCEPTION 'payment_allocations: % % paid % of %', NEW.debt_type, NEW.debt_id, v_alloc, v_limit;
  END IF;
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_check_allocation_limits ON public.payment_allocations;
CREATE CONSTRAINT TRIGGER trg_check_allocation_limits
  AFTER INSERT OR UPDATE ON public.payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_allocation_limits();

-- 3e-bis. A cancelled movement keeps no active allocation, as payer or as debt (checked at commit,
--     so the engine can cancel and supersede in one transaction).
CREATE OR REPLACE FUNCTION public.check_cancelled_movement_allocations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status = 'cancelled' AND EXISTS (
       SELECT 1 FROM public.payment_allocations a
        WHERE a.status = 'active'
          AND (a.movement_id = NEW.id OR (a.debt_type = 'movement' AND a.debt_id = NEW.id))) THEN
    RAISE EXCEPTION 'money_movements: movement % is cancelled but still has active allocations', NEW.id;
  END IF;
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_check_cancelled_movement_allocations ON public.money_movements;
CREATE CONSTRAINT TRIGGER trg_check_cancelled_movement_allocations
  AFTER UPDATE ON public.money_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'cancelled')
  EXECUTE FUNCTION public.check_cancelled_movement_allocations();

-- 3f. Never deleted (owner rule; same guard as the other money tables since 0051).
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.money_movements;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.money_movements
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.payment_allocations;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- =============================================================================================
-- 4. Access: read per branch (contact totals come later from a definer function); no browser writes
-- =============================================================================================
ALTER TABLE public.money_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mm_read ON public.money_movements;
CREATE POLICY mm_read ON public.money_movements FOR SELECT TO authenticated
  USING ((tenant_id = (SELECT public.current_tenant_id()) AND public.user_in_branch(auth.uid(), branch_id))
         OR (SELECT public.is_super_admin(auth.uid())));

DROP POLICY IF EXISTS pa_read ON public.payment_allocations;
CREATE POLICY pa_read ON public.payment_allocations FOR SELECT TO authenticated
  USING ((tenant_id = (SELECT public.current_tenant_id())
          AND (public.user_in_branch(auth.uid(), debt_branch_id) OR public.user_in_branch(auth.uid(), movement_branch_id)))
         OR (SELECT public.is_super_admin(auth.uid())));

REVOKE ALL ON public.money_movements, public.payment_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.money_movements, public.payment_allocations TO authenticated;
GRANT ALL ON public.money_movements, public.payment_allocations TO service_role;

REVOKE ALL ON FUNCTION public.validate_money_movement()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_money_movement_update()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_payment_allocation()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_payment_allocation_update()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_allocation_limits()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_cancelled_movement_allocations() FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 5. Accounts 2150 / 1460 / 1910 — existing companies now, new companies through the seed
--    (no posting to them until 6D)
-- =============================================================================================
INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system, is_active, description)
SELECT t.id, a.code, a.name, a.name_ar, a.typ::account_type, a.nb::normal_balance, true, true, a.descr
  FROM public.tenants t
 CROSS JOIN (VALUES
   ('2150', 'Customer Advances',            'دفعات العملاء المقدمة',      'liability', 'credit',
    'Money received from customers not yet allocated to an invoice (on-account deposits, overpayments).'),
   ('1460', 'Supplier Advances',            'دفعات الموردين المقدمة',     'asset',     'debit',
    'Money paid to suppliers not yet allocated to a purchase invoice.'),
   ('1910', 'Inter-Branch Current Account', 'الحساب الجاري بين الفروع',   'asset',     'debit',
    'Clearing between branches when money received in one branch pays a document of another. Company total is always zero.')
 ) AS a(code, name, name_ar, typ, nb, descr)
ON CONFLICT (tenant_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
  VALUES
    (p_tenant_id,'1000','Assets','الأصول','asset','debit',true),
    (p_tenant_id,'1100','Cash / Treasury','الخزينة','asset','debit',true),
    (p_tenant_id,'1110','Bank','البنك','asset','debit',true),
    (p_tenant_id,'1200','Accounts Receivable','العملاء (مدينون)','asset','debit',true),
    (p_tenant_id,'1300','Inventory','المخزون','asset','debit',true),
    (p_tenant_id,'1350','Input VAT (Purchases)','ضريبة القيمة المضافة على المشتريات','asset','debit',true),
    (p_tenant_id,'1400','Partner Advances Receivable','سلف الشركاء','asset','debit',true),
    (p_tenant_id,'1460','Supplier Advances','دفعات الموردين المقدمة','asset','debit',true),
    (p_tenant_id,'1500','Fixed Assets','الأصول الثابتة','asset','debit',true),
    (p_tenant_id,'1590','Accumulated Depreciation','مجمع الإهلاك','asset','credit',true),
    (p_tenant_id,'1910','Inter-Branch Current Account','الحساب الجاري بين الفروع','asset','debit',true),
    (p_tenant_id,'2000','Liabilities','الخصوم','liability','credit',true),
    (p_tenant_id,'2100','Accounts Payable','الموردون (دائنون)','liability','credit',true),
    (p_tenant_id,'2150','Customer Advances','دفعات العملاء المقدمة','liability','credit',true),
    (p_tenant_id,'2200','VAT Payable','ضريبة القيمة المضافة المستحقة','liability','credit',true),
    (p_tenant_id,'2300','Accrued Expenses','مصروفات مستحقة','liability','credit',true),
    (p_tenant_id,'3000','Equity','حقوق الملكية','equity','credit',true),
    (p_tenant_id,'3100','Partner Capital','رأس مال الشركاء','equity','credit',true),
    (p_tenant_id,'3200','Partner Drawings','مسحوبات الشركاء','equity','debit',true),
    (p_tenant_id,'3300','Retained Earnings (Legacy)','أرباح محتجزة (قديم)','equity','credit',true),
    (p_tenant_id,'3800','Retained Earnings','الأرباح المحتجزة','equity','credit',true),
    (p_tenant_id,'3850','Profit Distributions Payable','مستحقات توزيع أرباح','liability','credit',true),
    (p_tenant_id,'3900','Income Summary','ملخص الدخل','equity','credit',true),
    (p_tenant_id,'4000','Revenue','الإيرادات','revenue','credit',true),
    (p_tenant_id,'4100','Sales Revenue','إيراد المبيعات','revenue','credit',true),
    (p_tenant_id,'4200','Other Income','إيرادات أخرى','revenue','credit',true),
    (p_tenant_id,'4900','Sales Returns','مردودات المبيعات','revenue','debit',true),
    (p_tenant_id,'5000','Expenses','المصروفات','expense','debit',true),
    (p_tenant_id,'5100','Cost of Goods Sold','تكلفة البضاعة المباعة','expense','debit',true),
    (p_tenant_id,'5200','Salaries Expense','الرواتب','expense','debit',true),
    (p_tenant_id,'5300','Rent Expense','الإيجارات','expense','debit',true),
    (p_tenant_id,'5400','Utilities Expense','المرافق','expense','debit',true),
    (p_tenant_id,'5500','Operating Expenses','مصروفات تشغيلية','expense','debit',true),
    (p_tenant_id,'5900','Other Expenses','مصروفات أخرى','expense','debit',true),
    (p_tenant_id,'6500','Depreciation Expense','مصروف الإهلاك','expense','debit',true),
    (p_tenant_id,'6900','Loss on Asset Disposal','خسائر بيع أصول','expense','debit',true)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END
$fn$;
REVOKE ALL ON FUNCTION public.seed_default_chart_of_accounts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_chart_of_accounts(uuid) TO service_role;

-- =============================================================================================
-- Final checks
-- =============================================================================================
DO $check$
DECLARE v_list text; v_missing int;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 6A: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
  IF has_table_privilege('authenticated', 'public.money_movements', 'INSERT')
     OR has_table_privilege('authenticated', 'public.payment_allocations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.money_movements', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.payment_allocations', 'UPDATE') THEN
    RAISE EXCEPTION 'Step 6A: the browser can write to the ledger tables';
  END IF;
  SELECT count(*) INTO v_missing
    FROM public.tenants t CROSS JOIN (VALUES ('2150'), ('1460'), ('1910')) AS a(code)
   WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.id AND c.code = a.code);
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Step 6A: % company/account pairs missing', v_missing;
  END IF;
END
$check$;