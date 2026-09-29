import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";

export const ALL_FINANCIAL_BRANCHES = "all";

export type FinancialBranch = {
  id: string;
  name: string;
  code: string | null;
  is_system: boolean;
};

export type BranchFinancialSnapshot = FinancialBranch & {
  receivables: number;
  payables: number;
  cash: number;
};

type ContactBalance = { contact_id: string; type: string; total_balance: number; credit_balance: number };

export function useAdminFinancialBranchMetrics() {
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<FinancialBranch[]>([]);
  const [distribution, setDistribution] = useState<BranchFinancialSnapshot[]>([]);
  const [companyReceivables, setCompanyReceivables] = useState(0);
  const [companyPayables, setCompanyPayables] = useState(0);
  const [managementCredit, setManagementCredit] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchRows, contactRows] = await Promise.all([
        fetchAllRows<FinancialBranch>(() => supabase
          .from("branches")
          .select("id, name, code, is_system")
          .eq("is_active", true)
          .or("is_system.eq.false,code.eq.MAIN-TREASURY")
          .order("is_system")
          .order("name")
          .order("id")),
        fetchAllRows<ContactBalance>(() => supabase
          .from("v_contact_balances" as any)
          .select("contact_id, type, total_balance, credit_balance")
          .order("contact_id")),
      ]);

      const visibleBranches = branchRows.filter((branch) => !branch.is_system || branch.code === "MAIN-TREASURY");
      const operational = visibleBranches.filter((branch) => !branch.is_system);
      const mainTreasury = visibleBranches.find((branch) => branch.code === "MAIN-TREASURY");

      let receivables = 0;
      let payables = 0;
      let credit = 0;
      for (const contact of contactRows) {
        const balance = Number(contact.total_balance ?? 0);
        const type = String(contact.type ?? "");
        if ((type === "customer" || type === "both") && balance > 0) receivables += balance;
        if ((type === "supplier" || type === "both") && balance < 0) payables += -balance;
        credit += Math.max(-Number(contact.credit_balance ?? 0), 0);
      }

      const operationalRows = await Promise.all(operational.map(async (branch) => {
        const [balancesRes, walletRes] = await Promise.all([
          supabase.rpc("contact_branch_balances" as any, { p_branch_id: branch.id }),
          supabase.rpc("get_branch_wallet_balances", { p_branch_id: branch.id }),
        ]);
        if (balancesRes.error) throw balancesRes.error;
        if (walletRes.error) throw walletRes.error;
        let branchReceivables = 0;
        let branchPayables = 0;
        for (const row of (balancesRes.data ?? []) as any[]) {
          const balance = Number(row.balance ?? 0);
          const contact = contactRows.find((item) => item.contact_id === row.contact_id);
          const type = String(contact?.type ?? "");
          if ((type === "customer" || type === "both") && balance > 0) branchReceivables += balance;
          if ((type === "supplier" || type === "both") && balance < 0) branchPayables += -balance;
        }
        const wallet = Array.isArray(walletRes.data) ? walletRes.data[0] : null;
        return { ...branch, receivables: branchReceivables, payables: branchPayables, cash: Number((wallet as any)?.total_balance ?? 0) };
      }));

      let mainRow: BranchFinancialSnapshot | null = null;
      if (mainTreasury) {
        const walletRes = await supabase.rpc("get_branch_wallet_balances", { p_branch_id: mainTreasury.id });
        if (walletRes.error) throw walletRes.error;
        const wallet = Array.isArray(walletRes.data) ? walletRes.data[0] : null;
        mainRow = { ...mainTreasury, receivables: 0, payables: 0, cash: Number((wallet as any)?.total_balance ?? 0) };
      }

      setBranches(mainRow ? [...operational, mainTreasury] : operational);
      setDistribution(mainRow ? [...operationalRows, mainRow] : operationalRows);
      setCompanyReceivables(receivables);
      setCompanyPayables(payables);
      setManagementCredit(credit);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalCash = useMemo(() => distribution.reduce((sum, row) => sum + row.cash, 0), [distribution]);

  return { loading, branches, distribution, companyReceivables, companyPayables, managementCredit, totalCash, reload: load };
}