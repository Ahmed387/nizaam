import { supabase } from "@/integrations/supabase/client";

// Built-in payment method keys (stable, used for icons + legacy data)
export type BuiltinPaymentMethod = "cash" | "vodafone" | "instapay" | "bank";
export type PaymentMethod = string; // now dynamic — any key from transfer_fees + "cash"

export const BUILTIN_LABELS: Record<BuiltinPaymentMethod, string> = {
  cash: "💵 نقدي",
  vodafone: "📱 محفظة إلكترونية",
  instapay: "💳 انستاباي",
  bank: "🏦 حساب بنكي",
};

export interface TransferFee {
  payment_method: string;
  label?: string | null;
  fee_type: "percentage" | "fixed";
  fee_value: number;
  is_enabled?: boolean;
  /** 0139: «virtual» = a book vessel (no transfer number, no fee, may go below zero) */
  kind?: "wallet" | "virtual" | null;
}

export interface PaymentMethodOption {
  value: string;          // key stored in DB
  label: string;          // display label
  is_builtin: boolean;
  is_enabled: boolean;
  fee_type?: "percentage" | "fixed";
  fee_value?: number;
  kind?: "wallet" | "virtual";
}

let _feesCache: TransferFee[] | null = null;
let _feesCacheAt = 0;

export async function loadTransferFees(force = false): Promise<TransferFee[]> {
  const now = Date.now();
  if (!force && _feesCache && now - _feesCacheAt < 60_000) return _feesCache;
  const { data } = await supabase.from("transfer_fees").select("payment_method,label,fee_type,fee_value,is_enabled,kind" as any);
  _feesCache = ((data ?? []) as unknown) as TransferFee[];
  _feesCacheAt = now;
  return _feesCache;
}

/** Full list of payment methods (cash + built-ins + custom rows in transfer_fees). */
export async function loadAllPaymentMethods(force = false): Promise<PaymentMethodOption[]> {
  const fees = await loadTransferFees(force);
  const list: PaymentMethodOption[] = [
    { value: "cash", label: BUILTIN_LABELS.cash, is_builtin: true, is_enabled: true },
  ];
  // Built-ins always appear (enabled by default) even if no DB row exists yet
  const builtins: BuiltinPaymentMethod[] = ["vodafone", "instapay", "bank"];
  for (const b of builtins) {
    const f = fees.find((x) => x.payment_method === b);
    list.push({
      value: b,
      label: f?.label || BUILTIN_LABELS[b],
      is_builtin: true,
      is_enabled: f ? f.is_enabled !== false : true,
      fee_type: f?.fee_type,
      fee_value: f ? Number(f.fee_value) || 0 : 0,
    });
  }
  for (const f of fees) {
    if ((builtins as string[]).includes(f.payment_method)) continue;
    list.push({
      value: f.payment_method,
      label: f.label || f.payment_method,
      is_builtin: false,
      is_enabled: f.is_enabled !== false,
      fee_type: f.fee_type,
      fee_value: f.kind === "virtual" ? 0 : Number(f.fee_value) || 0,
      kind: f.kind === "virtual" ? "virtual" : "wallet",
    });
  }
  return list;
}

/** Keys of methods enabled for use in UI (cash always included). */
export async function loadEnabledPaymentMethods(force = false): Promise<string[]> {
  const all = await loadAllPaymentMethods(force);
  return all.filter((m) => m.is_enabled).map((m) => m.value);
}

export function calculateFee(method: string, amount: number, fees: TransferFee[]): number {
  if (method === "cash") return 0;
  const f = fees.find((x) => x.payment_method === method);
  if (!f || f.kind === "virtual") return 0;
  const v = Number(f.fee_value) || 0;
  if (f.fee_type === "percentage") return Math.round((amount * v) / 100 * 100) / 100;
  return v;
}

/** A book vessel (0139) is not a transfer: no number, no accounts, no fee. */
export function isVirtualMethod(method: string, fees: TransferFee[] | null = _feesCache): boolean {
  return !!fees?.some((f) => f.payment_method === method && f.kind === "virtual");
}

export function methodRequiresReference(method: string, fees: TransferFee[] | null = _feesCache): boolean {
  return method !== "cash" && !isVirtualMethod(method, fees);
}

/** The fee of a transfer between two vessels of one branch (same rule as `transfer_between_vessels`). */
export function vesselTransferFee(amount: number, mode: "none" | "fixed" | "percent", value: number): number {
  const a = Number(amount) || 0, v = Number(value) || 0;
  if (mode === "fixed") return Math.round(v * 100) / 100;
  if (mode === "percent") return Math.round(a * v) / 100;
  return 0;
}

/**
 * Unified validation for any electronic transfer payment.
 * Returns an error message (Arabic) when invalid, or null when ok.
 * Required fields for non-cash: reference_number, transfer_from_account, transfer_to_account.
 */
export function validateTransferPayment(pm: {
  method: string;
  reference_number?: string | null;
  transfer_from_account?: string | null;
  transfer_to_account?: string | null;
}): string | null {
  if (!methodRequiresReference(pm.method)) return null;
  if (!pm.reference_number?.toString().trim()) return "أدخل رقم العملية للتحويل";
  if (!pm.transfer_from_account?.toString().trim()) return "أدخل رقم/حساب المُحوَّل منه";
  if (!pm.transfer_to_account?.toString().trim()) return "أدخل رقم/حساب المُحوَّل إليه";
  return null;
}

export function methodAccountLabel(method: string): string {
  switch (method) {
    case "vodafone": return "رقم التليفون المُحوَّل إليه";
    case "instapay": return "حساب الانستاباي المُحوَّل إليه";
    case "bank": return "رقم الحساب البنكي المُحوَّل إليه";
    default: return "حُول على / المرجع";
  }
}

/** Label for the receiver account (the one money was transferred TO). */
export function methodReceiverLabel(method: string): string {
  switch (method) {
    case "vodafone": return "رقم التليفون المستلِم";
    case "instapay": return "حساب الانستاباي المستلِم";
    case "bank": return "رقم الحساب البنكي المستلِم";
    default: return "الحساب المستلِم";
  }
}

/** Label for the sender account (the one money was transferred FROM). */
export function methodSenderLabel(method: string): string {
  switch (method) {
    case "vodafone": return "رقم التليفون المُرسِل";
    case "instapay": return "حساب الانستاباي المُرسِل";
    case "bank": return "رقم الحساب البنكي المُرسِل";
    default: return "الحساب المُرسِل";
  }
}

// Backwards compat exports used elsewhere
export const PAYMENT_METHOD_LABELS = BUILTIN_LABELS;
export const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "cash", label: BUILTIN_LABELS.cash },
  { value: "vodafone", label: BUILTIN_LABELS.vodafone },
  { value: "instapay", label: BUILTIN_LABELS.instapay },
  { value: "bank", label: BUILTIN_LABELS.bank },
];
