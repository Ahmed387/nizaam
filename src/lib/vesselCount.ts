import { supabase } from "@/integrations/supabase/client";

/**
 * «تسوية الوعاء» (migration 0294): someone counts the money really in a vessel; the difference with the system is booked
 * in that vessel on the count's day so the system equals the money in hand. The owner chooses how each time.
 */
export type VesselCountMode = "owner" | "approval";
export type Treatment = "loss" | "employee" | "prior_years" | "gain";
export type VesselCountStatus = "pending" | "applied" | "rejected" | "cancelled";

export interface BoardVessel { method: string; label: string; balance: number }
export interface VesselCountRow {
  id: string; number: string; method: string; label: string; date: string;
  system: number; actual: number; difference: number; status: VesselCountStatus; treatment: Treatment | null;
  employee: string | null; note: string | null; reason: string | null; cancel_reason: string | null;
  counted_by: string | null; counted_at: string; decided_by: string | null; voucher: string | null;
}
export interface VesselCountBoard { mode: VesselCountMode; is_owner: boolean; can_count: boolean; vessels: BoardVessel[]; counts: VesselCountRow[] }

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** actual − system: negative = shortage (عجز), positive = surplus (زيادة). */
export function countDifference(system: number, actual: number): number {
  return round2(actual - system);
}

export interface TreatmentOption { value: Treatment; title: string; effect: string }

/** The choices for a difference: a shortage has 3, a surplus 2, an equal count none. */
export function treatmentOptions(diff: number): TreatmentOption[] {
  if (Math.abs(diff) < 0.01) return [];
  if (diff < 0) return [
    { value: "loss", title: "خسارة على الشركة", effect: "مصروف «عجز خزنة» — بيقلل ربح الشهر ده" },
    { value: "employee", title: "على موظف", effect: "سلفة عليه — بتتخصم من مرتبه، ومش بتأثر على الربح" },
    { value: "prior_years", title: "على السنين اللي فاتت", effect: "تسوية من غير ما تأثر على ربح السنة دي (أرباح محتجزة)" },
  ];
  return [
    { value: "gain", title: "ربح", effect: "«إيرادات أخرى» — بتزوّد ربح الشهر ده" },
    { value: "prior_years", title: "على السنين اللي فاتت", effect: "تسوية من غير ما تأثر على ربح السنة دي (أرباح محتجزة)" },
  ];
}

export const TREATMENT_LABEL: Record<Treatment, string> = {
  loss: "خسارة (عجز خزنة)", employee: "على موظف (سلفة)", prior_years: "على السنين اللي فاتت", gain: "ربح (إيرادات أخرى)",
};
export const STATUS_LABEL: Record<VesselCountStatus, string> = {
  pending: "مستنية موافقة المالك", applied: "اتسوّت", rejected: "مرفوضة", cancelled: "ملغية",
};

/** The one line that says what the count does to the vessel. */
export function differenceText(diff: number, fmt: (n: number) => string): string {
  if (Math.abs(diff) < 0.01) return "مطابق — مفيش فرق";
  return diff < 0 ? `عجز ${fmt(Math.abs(diff))} — الوعاء هيقل بالمبلغ ده` : `زيادة ${fmt(diff)} — الوعاء هيزيد بالمبلغ ده`;
}

/** What blocks sending the count (null = ready). */
export function countProblem(o: {
  method: string; actual: string; isOwner: boolean; diff: number | null; treatment: Treatment | ""; employeeId: string; reason: string;
}): string | null {
  if (!o.method) return "اختار الوعاء";
  if (o.actual.trim() === "" || !(Number(o.actual) >= 0)) return "اكتب الفلوس اللي في الوعاء فعلاً (صفر أو أكتر)";
  if (!o.isOwner || o.diff === null || Math.abs(o.diff) < 0.01) return null;
  if (!o.treatment || !treatmentOptions(o.diff).some((t) => t.value === o.treatment)) return o.diff < 0 ? "اختار العجز هيتسجل إزاي" : "اختار الزيادة هتتسجل إزاي";
  if (o.treatment === "employee" && !o.employeeId) return "اختار الموظف اللي العجز عليه";
  if (!o.reason.trim()) return "اكتب سبب الفرق";
  return null;
}

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

export async function fetchVesselCountBoard(branchId: string): Promise<VesselCountBoard> {
  const { data, error } = await rpc("vessel_count_board", { p_branch: branchId });
  if (error) throw error;
  return data as VesselCountBoard;
}
export async function submitVesselCount(a: {
  branchId: string; method: string; actual: number; note?: string; date?: string | null; treatment?: Treatment | null; employeeId?: string | null; reason?: string;
}) {
  const { data, error } = await rpc("submit_vessel_count", {
    p_branch: a.branchId, p_method: a.method, p_actual: a.actual, p_note: a.note?.trim() || null, p_date: a.date || null,
    p_treatment: a.treatment || null, p_employee: a.employeeId || null, p_reason: a.reason?.trim() || null,
  });
  if (error) throw error;
  return data as { id: string; number: string; status: VesselCountStatus; difference: number; voucher?: string };
}
export async function decideVesselCount(a: { id: string; approve: boolean; treatment?: Treatment | null; employeeId?: string | null; reason: string }) {
  const { data, error } = await rpc("decide_vessel_count", {
    p_id: a.id, p_approve: a.approve, p_treatment: a.treatment || null, p_employee: a.employeeId || null, p_reason: a.reason.trim(),
  });
  if (error) throw error;
  return data as { number: string; status: VesselCountStatus; voucher?: string };
}
export async function cancelVesselCount(id: string, reason: string) {
  const { error } = await rpc("cancel_vessel_count", { p_id: id, p_reason: reason.trim() });
  if (error) throw error;
}
export async function fetchVesselCountMode(tenantId: string): Promise<VesselCountMode> {
  const { data } = await (supabase.from("settings") as any).select("value").eq("tenant_id", tenantId).eq("key", "vessel_count_mode").maybeSingle();
  return data?.value === "approval" ? "approval" : "owner";
}
export async function setVesselCountMode(mode: VesselCountMode) {
  const { error } = await rpc("set_vessel_count_mode", { p_mode: mode });
  if (error) throw error;
}
