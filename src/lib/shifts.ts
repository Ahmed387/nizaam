import { supabase } from "@/integrations/supabase/client";

export interface CashierShift {
  id: string;
  tenant_id: string;
  branch_id: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  cash_sales: number | null;
  variance: number | null;
  status: "open" | "closed" | "auto_closed";
  open_notes: string | null;
  close_notes: string | null;
}

export async function getOpenShift(branchId: string): Promise<CashierShift | null> {
  const { data, error } = await supabase.rpc("get_open_shift" as any, { p_branch_id: branchId });
  if (error) throw error;
  // rpc returning a single row-typed value comes back as an object (or null)
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row && (row as any).id) ? (row as CashierShift) : null;
}

export async function openShift(branchId: string, openingCash: number, notes?: string) {
  const { data, error } = await supabase.rpc("open_cashier_shift" as any, {
    p_branch_id: branchId,
    p_opening_cash: openingCash,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as CashierShift;
}

export async function closeShift(shiftId: string, closingCash: number, notes?: string) {
  const { data, error } = await supabase.rpc("close_cashier_shift" as any, {
    p_shift_id: shiftId,
    p_closing_cash: closingCash,
    p_notes: notes ?? null,
    p_auto: false,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as CashierShift;
}

export async function shiftCashSales(shiftId: string): Promise<number> {
  const { data, error } = await supabase.rpc("shift_cash_sales" as any, { p_shift_id: shiftId });
  if (error) throw error;
  return Number(data ?? 0);
}
