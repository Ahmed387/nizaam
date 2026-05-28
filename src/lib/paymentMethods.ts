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
}

export interface PaymentMethodOption {
  value: string;          // key stored in DB
  label: string;          // display label
  is_builtin: boolean;
  is_enabled: boolean;
  fee_type?: "percentage" | "fixed";
  fee_value?: number;
}

let _feesCache: TransferFee[] | null = null;
let _feesCacheAt = 0;

export async function loadTransferFees(force = false): Promise<TransferFee[]> {
  const now = Date.now();
  if (!force && _feesCache && now - _feesCacheAt < 60_000) return _feesCache;
  const { data } = await supabase.from("transfer_fees").select("payment_method,label,fee_type,fee_value,is_enabled");
  _feesCache = (data ?? []) as TransferFee[];
  _feesCacheAt = now;
  return _feesCache;
}

/** Full list of payment methods (cash + all rows in transfer_fees). */
export async function loadAllPaymentMethods(force = false): Promise<PaymentMethodOption[]> {
  const fees = await loadTransferFees(force);
  const list: PaymentMethodOption[] = [
    { value: "cash", label: BUILTIN_LABELS.cash, is_builtin: true, is_enabled: true },
  ];
  for (const f of fees) {
    const isBuiltin = (["vodafone", "instapay", "bank"] as string[]).includes(f.payment_method);
    list.push({
      value: f.payment_method,
      label: f.label || BUILTIN_LABELS[f.payment_method as BuiltinPaymentMethod] || f.payment_method,
      is_builtin: isBuiltin,
      is_enabled: f.is_enabled !== false,
      fee_type: f.fee_type,
      fee_value: Number(f.fee_value) || 0,
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
  if (!f) return 0;
  const v = Number(f.fee_value) || 0;
  if (f.fee_type === "percentage") return Math.round((amount * v) / 100 * 100) / 100;
  return v;
}

export function methodRequiresReference(method: string): boolean {
  return method !== "cash";
}

export function methodAccountLabel(method: string): string {
  switch (method) {
    case "vodafone": return "رقم التليفون المُحوَّل إليه";
    case "instapay": return "حساب الانستاباي المُحوَّل إليه";
    case "bank": return "رقم الحساب البنكي المُحوَّل إليه";
    default: return "حُول على / المرجع";
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
