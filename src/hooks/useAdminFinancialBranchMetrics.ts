import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { fetchNetTotals } from "@/lib/ledger";

export const ALL_FINANCIAL_BRANCHES = "all";

export type FinancialBranch = {
  id: string;
  name: string;
  code: string | null;
  is_system: boolean;
};

export type BranchFinancialSnapshot = FinancialBranch & {
  /** customers' open documents of this branch (customer side of the unified ledger) */
  receivables: number;
  /** suppliers' open purchase invoices of this branch (supplier side) */
  payables: number;
  customerAdvances: number;
  supplierAdvances: number;
  cash: number;
};

/**
 * Branch and company position from the unified ledger (Step 6C): customer and supplier sides are
 * separate — never netted — and every branch adds up to the company figure. Cash = the branch till
 * (treasury rows, opening cash included).
 */
export function useAdminFinancialBranchMetrics() {
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<FinancialBranch[]>([]);
  const [distribution, setDistribution] = useState<BranchFinancialSnapshot[]>([]);
  const [companyReceivables, setCompanyReceivables] = useState(0);
  const [companyPayables, setCompanyPayables] = useState(0);
  const [customerAdvances, setCustomerAdvances] = useState(0);
  const [supplierAdvances, setSupplierAdvances] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchRows, company] = await Promise.all([
        fetchAllRows<FinancialBranch>(() => supabase
          .from("branches")
          .select("id, name, code, is_system")
          .eq("is_active", true)
          .or("is_system.eq.false,code.eq.MAIN-TREASURY")
          .order("is_system")
          .order("name")
          .order("id")),
        fetchNetTotals(null).catch(() => null),
      ]);

      const visibleBranches = branchRows.filter((branch) => !branch.is_system || branch.code === "MAIN-TREASURY");
      const operational = visibleBranches.filter((branch) => !branch.is_system);
      const mainTreasury = visibleBranches.find((branch) => branch.code === "MAIN-TREASURY");
      const ordered = mainTreasury ? [...operational, mainTreasury] : operational;

      const rows = await Promise.all(ordered.map(async (branch) => {
        const [pos, walletRes] = await Promise.all([
          branch.is_system ? Promise.resolve({ debit: 0, credit: 0, debitCount: 0, creditCount: 0 }) : fetchNetTotals(branch.id),
          supabase.rpc("get_branch_wallet_balances", { p_branch_id: branch.id }),
        ]);
        if (walletRes.error) throw walletRes.error;
        const wallet = Array.isArray(walletRes.data) ? walletRes.data[0] : null;
        return {
          ...branch,
          // owner 2026-11-14: ONE net balance per account (مدين / دائن), never open invoices + advances
          receivables: pos.debit,
          payables: pos.credit,
          customerAdvances: 0,
          supplierAdvances: 0,
          cash: Number((wallet as any)?.total_balance ?? 0),
        } as BranchFinancialSnapshot;
      }));

      setBranches(ordered);
      setDistribution(rows);
      setCompanyReceivables(company ? company.debit : rows.reduce((s, r) => s + r.receivables, 0));
      setCompanyPayables(company ? company.credit : rows.reduce((s, r) => s + r.payables, 0));
      setCustomerAdvances(0);
      setSupplierAdvances(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(
    ["branches", "contacts", "invoices", "invoice_payments", "returns", "shipments", "supplier_payments", "purchase_returns", "vouchers", "treasury"],
    load,
  );

  const totalCash = useMemo(() => distribution.reduce((sum, row) => sum + row.cash, 0), [distribution]);

  return { loading, branches, distribution, companyReceivables, companyPayables, customerAdvances, supplierAdvances, totalCash, reload: load };
}