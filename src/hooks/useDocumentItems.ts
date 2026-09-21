import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DocumentItemsDocType = "shipment" | "sale_return" | "purchase_return";

export type DocumentItem = {
  id: string;
  product_name: string;
  attributes: string;
  quantity: number;
  unit_price: number | null;
  discount: number;
  total: number;
};

export const documentItemsQueryKey = (
  docType: DocumentItemsDocType,
  tenantId: string | null | undefined,
  branchId: string | null | undefined,
  docId: string | null | undefined,
) => ["document-items", docType, tenantId ?? "", branchId ?? "", docId ?? ""] as const;

const buildAttributes = (item: any): string =>
  [item.brand, item.model, item.color, item.size, item.capacity, item.product_type]
    .filter(Boolean)
    .join(" · ");

/**
 * Lazy line-item loader for purchase invoices, sale returns and purchase returns.
 * Fetches exclusively when `enabled` (row expansion) — never preloaded.
 * Strictly isolated cache keys: ['document-items', docType, tenantId, branchId, docId].
 * Tenant/branch scoping is enforced through the parent document join, never trust the row alone.
 */
export function useDocumentItems(
  docType: DocumentItemsDocType,
  tenantId: string | null | undefined,
  branchId: string | null | undefined,
  docId: string | null | undefined,
  enabled: boolean,
) {
  const active = Boolean(enabled && tenantId && branchId && docId);

  return useQuery({
    queryKey: documentItemsQueryKey(docType, tenantId, branchId, docId),
    enabled: active,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DocumentItem[]> => {
      if (docType === "shipment") {
        const { data, error } = await supabase
          .from("shipment_items")
          .select(
            "id, product_name, quantity, cost_price, discount_amount, total, brand, model, color, size, capacity, product_type, shipments!inner(branch_id, tenant_id)",
          )
          .eq("shipment_id", docId!)
          .eq("tenant_id", tenantId!)
          .eq("shipments.branch_id", branchId!)
          .eq("shipments.tenant_id", tenantId!);
        if (error) throw error;
        return (data ?? []).map(({ shipments: _shipments, ...it }: any) => ({
          id: it.id,
          product_name: it.product_name ?? "—",
          attributes: buildAttributes(it),
          quantity: Number(it.quantity || 0),
          unit_price: it.cost_price != null ? Number(it.cost_price) : null,
          discount: Number(it.discount_amount || 0),
          total: Number(it.total || 0),
        }));
      }

      if (docType === "sale_return") {
        const { data, error } = await supabase
          .from("return_items")
          .select(
            "id, quantity, refund, brand, model, color, size, capacity, product_type, products(name), returns!inner(branch_id, tenant_id)",
          )
          .eq("return_id", docId!)
          .eq("tenant_id", tenantId!)
          .eq("returns.branch_id", branchId!)
          .eq("returns.tenant_id", tenantId!);
        if (error) throw error;
        return (data ?? []).map(({ returns: _returns, products, ...it }: any) => ({
          id: it.id,
          product_name: products?.name ?? "—",
          attributes: buildAttributes(it),
          quantity: Number(it.quantity || 0),
          unit_price: null, // sale-return items carry only the refunded amount
          discount: 0,
          total: Number(it.refund || 0),
        }));
      }

      // purchase_return
      const { data, error } = await supabase
        .from("purchase_return_items")
        .select(
          "id, product_name, quantity, unit_cost, total, brand, model, color, size, capacity, product_type, purchase_returns!inner(branch_id, tenant_id)",
        )
        .eq("purchase_return_id", docId!)
        .eq("purchase_returns.branch_id", branchId!)
        .eq("purchase_returns.tenant_id", tenantId!);
      if (error) throw error;
      return (data ?? []).map(({ purchase_returns: _returns, ...it }: any) => ({
        id: it.id,
        product_name: it.product_name ?? "—",
        attributes: buildAttributes(it),
        quantity: Number(it.quantity || 0),
        unit_price: it.unit_cost != null ? Number(it.unit_cost) : null,
        discount: 0,
        total: Number(it.total || 0),
      }));
    },
  });
}
