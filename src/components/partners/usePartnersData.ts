import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchPartnersOverview, fetchPayRules, profitShares, type PartnerCards, type PayRuleRow } from "@/lib/partners";

/** Every partner tab reads the same: the cards, each one's % of the profit, the monthly pay rules — reloaded together. */
export function usePartnersData() {
  const [rows, setRows] = useState<PartnerCards[]>([]);
  const [rules, setRules] = useState<PayRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([fetchPartnersOverview(), fetchPayRules().catch(() => [] as PayRuleRow[])]);
      setRows(r); setRules(p);
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ch = supabase.channel("partners-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_transactions" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  const active = useMemo(() => rows.filter((r) => r.partner.is_active), [rows]);
  const shares = useMemo(() => profitShares(rows), [rows]);
  return { rows, active, rules, shares, loading, load };
}
