import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type InvoiceItemSummary = {
  id: string;
  product_name: string;
  quantity: number;
  selling_price: number;
  line_discount: number;
  total: number;
};

export const invoiceItemsQueryKey = (tenantId: string, branchId: string, invoiceId: string) =>
  ["invoice-items", tenantId, branchId, invoiceId] as const;

export function useInvoiceItems(
  tenantId: string | null | undefined,
  branchId: string | null | undefined,
  invoiceId: string | null | undefined,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const active = Boolean(enabled && tenantId && branchId && invoiceId);

  const query = useQuery({
    queryKey: invoiceItemsQueryKey(tenantId ?? "", branchId ?? "", invoiceId ?? ""),
    enabled: active,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_items")
        .select("id, product_name, quantity, selling_price, line_discount, total, invoices!inner(branch_id, tenant_id)")
        .eq("invoice_id", invoiceId!)
        .eq("tenant_id", tenantId!)
        .eq("invoices.branch_id", branchId!)
        .eq("invoices.tenant_id", tenantId!);

      if (error) throw error;
      return (data ?? []).map(({ invoices: _invoices, ...item }: any) => item) as InvoiceItemSummary[];
    },
  });

  useEffect(() => {
    if (!active) return;
    const key = invoiceItemsQueryKey(tenantId!, branchId!, invoiceId!);
    const channel = supabase
      .channel(`invoice-items-${invoiceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoice_items", filter: `invoice_id=eq.${invoiceId}` },
        () => queryClient.invalidateQueries({ queryKey: key }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [active, branchId, invoiceId, queryClient, tenantId]);

  return query;
}