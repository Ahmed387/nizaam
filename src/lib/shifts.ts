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
  schedule_id?: string | null;
  reported_opening_cash?: number | null;
  expected_opening_cash?: number | null;
  opening_status?: "accepted" | "rejected" | "pending_override";
  overridden_by?: string | null;
  soft_close_at?: string | null;
}

export interface ShiftSchedule {
  id: string;
  branch_id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  is_extra: boolean;
  shift_date: string | null;
  is_active: boolean;
}

export interface SaleGate {
  shift_id: string | null;
  allowed: boolean;
  reason: "no_shift" | "handover_pending" | "soft_close" | "ok";
  minutes_left: number | null;
  opening_status: string | null;
}

/** بوابة البيع: بتقول لو مسموح تصدر فاتورة دلوقتي ولا لأ */
export async function fetchSaleGate(branchId: string): Promise<SaleGate> {
  const { data, error } = await supabase.rpc("shift_sale_gate" as any, { p_branch_id: branchId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? { shift_id: null, allowed: false, reason: "no_shift", minutes_left: null, opening_status: null }) as SaleGate;
}

/** الرصيد الافتتاحي المتوقع = الرصيد الختامي لآخر وردية مقفولة في الفرع */
export async function fetchExpectedOpeningCash(branchId: string): Promise<number> {
  const { data, error } = await supabase.rpc("expected_opening_cash" as any, { p_branch_id: branchId });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function fetchCurrentSchedule(branchId: string): Promise<ShiftSchedule | null> {
  const { data, error } = await supabase.rpc("current_shift_schedule" as any, { p_branch_id: branchId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row && (row as any).id ? (row as ShiftSchedule) : null;
}

/** فتح وردية بإقرار عهدة — بيقارن المعدود بالمتوقع */
export async function openShiftSecure(branchId: string, reportedCash: number, notes?: string, autoAttendance = false) {
  const { data, error } = await supabase.rpc("open_cashier_shift_secure" as any, {
    p_branch_id: branchId,
    p_reported_cash: reportedCash,
    p_notes: notes ?? null,
    p_auto_attendance: autoAttendance,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as CashierShift;
}

/** اعتماد الأونر/مدير الفرع لفرق العهدة */
export async function overrideShiftOpening(shiftId: string, note?: string) {
  const { data, error } = await supabase.rpc("override_shift_opening" as any, {
    p_shift_id: shiftId,
    p_note: note ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as CashierShift;
}


export async function getOpenShift(branchId: string): Promise<CashierShift | null> {
  const { data, error } = await supabase.rpc("get_open_shift" as any, { p_branch_id: branchId });
  if (error) throw error;
  // rpc returning a single row-typed value comes back as an object (or null)
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row && (row as any).id) ? (row as CashierShift) : null;
}

export async function openShift(branchId: string, openingCash: number, notes?: string, autoAttendance = false) {
  const { data, error } = await supabase.rpc("open_cashier_shift" as any, {
    p_branch_id: branchId,
    p_opening_cash: openingCash,
    p_notes: notes ?? null,
    p_auto_attendance: autoAttendance,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as CashierShift;
}

/** الرسالة اللي بترجع من السيرفر لما الكاشير مسجلش حضور النهارده */
export function isMissingAttendanceError(e: any) {
  const msg = String(e?.message ?? "") + String(e?.hint ?? "");
  return msg.includes("لازم تسجل حضورك") || msg.includes("NO_ATTENDANCE");
}

export async function closeShift(shiftId: string, closingCash: number, notes?: string, autoCheckout = true) {
  const { data, error } = await supabase.rpc("close_cashier_shift" as any, {
    p_shift_id: shiftId,
    p_closing_cash: closingCash,
    p_notes: notes ?? null,
    p_auto: false,
    p_auto_checkout: autoCheckout,
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

export interface ShiftPaymentLine {
  payment_method: string;
  total: number;
  payments_count: number;
}

export async function shiftPaymentBreakdown(shiftId: string): Promise<ShiftPaymentLine[]> {
  const { data, error } = await supabase.rpc("shift_payment_breakdown" as any, { p_shift_id: shiftId });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    payment_method: r.payment_method,
    total: Number(r.total ?? 0),
    payments_count: Number(r.payments_count ?? 0),
  }));
}


export interface ShiftHandover {
  id: string;
  shift_id: string;
  amount: number;
  notes: string | null;
  occurred_at: string;
  from_cashier_id: string;
  cashier_name: string | null;
  to_manager_id: string;
  manager_name: string | null;
}

/** سجل تسليم العهدة الطارئ أثناء الوردية (مش مبيعات ولا مصروفات — إقرار تسليم بس) */
export async function fetchShiftHandovers(shiftId: string): Promise<ShiftHandover[]> {
  const { data, error } = await supabase.rpc("shift_handovers" as any, { p_shift_id: shiftId });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({ ...r, amount: Number(r.amount ?? 0) })) as ShiftHandover[];
}

/** مدير الفرع/الأونر بيسجل استلام عهدة من كاشير غادر طارئ — الوردية بتفضل مفتوحة */
export async function recordMidShiftHandover(shiftId: string, amountReceived: number, notes?: string, managerId?: string) {
  const { data, error } = await supabase.rpc("record_mid_shift_handover" as any, {
    p_shift_id: shiftId,
    p_manager_id: managerId ?? null,
    p_amount_received: amountReceived,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ShiftHandover;
}
