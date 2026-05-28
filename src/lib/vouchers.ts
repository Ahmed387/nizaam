import { supabase } from "@/integrations/supabase/client";

export type VoucherType = "receipt" | "payment";
export type VoucherSource = "manual" | "system";
export type VoucherStatus = "active" | "cancelled";
export type VoucherPartyType = "customer" | "supplier" | "employee" | "other";

export interface VoucherCategory {
  id: string;
  tenant_id: string;
  name: string;
  type: VoucherType;
  is_system: boolean;
  is_active: boolean;
  parent_id: string | null;
  system_key: string | null;
}

export interface Voucher {
  id: string;
  tenant_id: string;
  branch_id: string;
  voucher_number: string;
  type: VoucherType;
  source: VoucherSource;
  source_type: string | null;
  source_id: string | null;
  treasury_id: string | null;
  category_id: string;
  amount: number;
  payment_method: "cash" | "vodafone" | "instapay" | "bank";
  fee_amount: number;
  reference_number: string | null;
  transferred_to: string | null;
  party_type: VoucherPartyType | null;
  party_id: string | null;
  party_name: string | null;
  description: string | null;
  voucher_date: string;
  status: VoucherStatus;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
}

export const VOUCHER_TYPE_LABEL: Record<VoucherType, string> = {
  receipt: "قبض",
  payment: "صرف",
};

export const PARTY_TYPE_LABEL: Record<VoucherPartyType, string> = {
  customer: "عميل",
  supplier: "مورد",
  employee: "موظف",
  other: "أخرى",
};

export async function fetchVoucherCategories(type?: VoucherType, onlyActive = false) {
  let q = supabase.from("voucher_categories" as any).select("*").order("is_system", { ascending: false }).order("name");
  if (type) q = q.eq("type", type);
  if (onlyActive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as VoucherCategory[];
}
