import { supabase } from "@/integrations/supabase/client";

export type PaymentMethod = "cash" | "vodafone" | "instapay" | "bank";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "💵 نقدي",
  vodafone: "📱 فودافون كاش",
  instapay: "💳 انستاباي",
  bank: "🏦 حساب بنكي",
};

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: PAYMENT_METHOD_LABELS.cash },
  { value: "vodafone", label: PAYMENT_METHOD_LABELS.vodafone },
  { value: "instapay", label: PAYMENT_METHOD_LABELS.instapay },
  { value: "bank", label: PAYMENT_METHOD_LABELS.bank },
];

export interface TransferFee {
  payment_method: Exclude<PaymentMethod, "cash">;
  fee_type: "percentage" | "fixed";
  fee_value: number;
}

let _feesCache: TransferFee[] | null = null;
let _feesCacheAt = 0;

export async function loadTransferFees(force = false): Promise<TransferFee[]> {
  const now = Date.now();
  if (!force && _feesCache && now - _feesCacheAt < 60_000) return _feesCache;
  const { data } = await supabase.from("transfer_fees").select("payment_method,fee_type,fee_value");
  _feesCache = (data ?? []) as TransferFee[];
  _feesCacheAt = now;
  return _feesCache;
}

export function calculateFee(method: PaymentMethod, amount: number, fees: TransferFee[]): number {
  if (method === "cash") return 0;
  const f = fees.find((x) => x.payment_method === method);
  if (!f) return 0;
  const v = Number(f.fee_value) || 0;
  if (f.fee_type === "percentage") return Math.round((amount * v) / 100 * 100) / 100;
  return v;
}

export function methodRequiresReference(method: PaymentMethod): boolean {
  return method !== "cash";
}

export function methodAccountLabel(method: PaymentMethod): string {
  switch (method) {
    case "vodafone": return "رقم التليفون المُحوَّل إليه";
    case "instapay": return "حساب الانستاباي المُحوَّل إليه";
    case "bank": return "رقم الحساب البنكي المُحوَّل إليه";
    default: return "حُول على";
  }
}
