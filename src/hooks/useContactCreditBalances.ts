import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { fetchAllRows } from "@/lib/fetchAll";

export type ContactCreditBalance = {
  contactId: string;
  name: string;
  type: string;
  availableBalance: number;
};

export function useContactCreditBalances(tenantId?: string | null) {
  const [contacts, setContacts] = useState<ContactCreditBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) {
      setContacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchAllRows<any>(() => supabase
        .from("v_contact_balances" as any)
        .select("contact_id,name,type,credit_balance")
        .eq("tenant_id", tenantId)
        .lt("credit_balance", -0.001)
        .order("contact_id"));
      setContacts(rows.flatMap((row) => row.contact_id ? [{
        contactId: String(row.contact_id),
        name: String(row.name ?? "—"),
        type: String(row.type ?? "customer"),
        availableBalance: Math.abs(Number(row.credit_balance ?? 0)),
      }] : []));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(["contacts", "customer_credit_log", "invoice_payments", "vouchers"], load);

  return {
    contacts,
    loading,
    total: contacts.reduce((sum, contact) => sum + contact.availableBalance, 0),
    reload: load,
  };
}