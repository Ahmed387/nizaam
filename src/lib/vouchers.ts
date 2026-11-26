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
  is_deductible_from_profit?: boolean;
  is_added_to_profit?: boolean;
  gl_account_code?: string | null;

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
  transferred_from: string | null;
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

/**
 * تصنيفات محجوزة لشاشات مخصّصة (مبيعات/مرتجعات/تحويلات) — ممنوع إنشاء سند يدوي بها
 * لأنها تؤثر على المخزون أو تُنشأ آلياً من مسارات أخرى.
 */
export const RESERVED_CATEGORY_KEYS = new Set([
  "cash_sale",
  "customer_return",
  "branch_transfer_in",
  "branch_transfer_out",
  // 0294: «تسوية الوعاء» books these itself
  "vessel_short_loss",
  "vessel_short_prior",
  "vessel_over_gain",
  "vessel_over_prior",
]);

const RESERVED_CATEGORY_NAMES = ["مبيعات نقدية", "مرتجعات للعملاء", "تحويلات بين الفروع"];

/** هل التصنيف محجوز لعمليات آلية (مبيعات/مرتجعات/تحويلات) أو تصنيف اختبار؟ */
export function isReservedVoucherCategory(c: VoucherCategory): boolean {
  if (c.system_key && RESERVED_CATEGORY_KEYS.has(c.system_key)) return true;
  const name = (c.name ?? "").trim();
  if (RESERVED_CATEGORY_NAMES.includes(name)) return true;
  if (/QA/i.test(name)) return true;
  return false;
}

/** هل التصنيف مسموح استخدامه في السندات اليدوية؟ (نشط + غير محجوز) */
export function isManualVoucherCategory(c: VoucherCategory): boolean {
  if (!c.is_active) return false;
  return !isReservedVoucherCategory(c);
}


/**
 * 0293 (owner 2026-11-26): who a hand-written voucher of this category must name — same rule as the server's
 * `voucher_category_party_rule`: on 1200 → a customer («تحصيل أقساط عملاء»، «مدفوعات لعملاء»), on 2100 → a supplier
 * («مدفوعات موردين»، «مقبوضات من موردين»), salaries / advances / advance repayments → an ACTIVE employee. A sub-item
 * follows the nearest parent that has a rule. null = the party is optional.
 */
export type PartyRule = "customer" | "supplier" | "employee" | null;
const EMPLOYEE_KEYS = new Set(["salary", "advance", "advance_repayment"]);
export function categoryPartyRule(categoryId: string | null | undefined, cats: VoucherCategory[]): PartyRule {
  let c = cats.find((x) => x.id === categoryId);
  for (let i = 0; c && i < 6; i++) {
    if (c.gl_account_code === "1200") return "customer";
    if (c.gl_account_code === "2100") return "supplier";
    if ((c.system_key && EMPLOYEE_KEYS.has(c.system_key)) || c.gl_account_code === "1450" || c.gl_account_code === "5200") return "employee";
    c = c.parent_id ? cats.find((x) => x.id === c!.parent_id) : undefined;
  }
  return null;
}

/** 0294: the employee kind of a category (walks up to its parents) — like the DB's `voucher_category_employee_kind`. */
export type EmployeeKind = "salary" | "advance" | "advance_repayment" | null;
export function categoryEmployeeKind(categoryId: string | null | undefined, cats: VoucherCategory[]): EmployeeKind {
  let c = cats.find((x) => x.id === categoryId);
  for (let i = 0; c && i < 6; i++) {
    if (c.system_key && EMPLOYEE_KEYS.has(c.system_key)) return c.system_key as EmployeeKind;
    c = c.parent_id ? cats.find((x) => x.id === c!.parent_id) : undefined;
  }
  return null;
}

/** 0294: a salary voucher for a month the payroll already paid — the warning text (null = no payroll that month). */
export function salaryDuplicateWarning(employeeName: string, month: string, paid: { net_salary: number | null }[]): string | null {
  if (!paid.length) return null;
  const total = paid.reduce((s, r) => s + Number(r.net_salary || 0), 0);
  return `${employeeName || "الموظف"} اتصرفله مرتب شهر ${month} من المرتبات قبل كده (${total.toLocaleString("en-US")} ج.م). لو السند ده نفس المرتب هيتحسب مرتين.`;
}

/** The message when the party the category needs is missing (null = fine). */
export function partyRuleProblem(rule: PartyRule, categoryName: string, partyType: string, partyId: string): string | null {
  if (!rule) return null;
  if (partyType === rule && partyId) return null;
  return rule === "employee"
    ? `التصنيف «${categoryName}» لازم تختار الموظف من الموظفين الشغالين`
    : `التصنيف «${categoryName}» لازم تختار له ${rule === "customer" ? "العميل" : "المورد"}`;
}
