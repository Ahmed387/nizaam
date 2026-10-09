import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";

/** Payment status of a sale invoice, derived from net (non-voided) invoice payments. */
export type SalePayState = "paid" | "partial" | "credit";

export type CollectionBucket = "cash" | "instapay" | "wallet" | "bank" | "other";

export interface InvoicePaymentSummary {
  paid: number;
  byBucket: Record<CollectionBucket, number>;
  methods: string[];
}

interface PaymentRow {
  invoice_id: string;
  amount: number | string | null;
  payment_method: string | null;
  voided_at: string | null;
  reverses_payment_id: string | null;
}

export const emptyBuckets = (): Record<CollectionBucket, number> => ({ cash: 0, instapay: 0, wallet: 0, bank: 0, other: 0 });

export function bucketOf(method: string | null | undefined): CollectionBucket {
  switch (method) {
    case "cash": return "cash";
    case "instapay": return "instapay";
    case "vodafone":
    case "vodafone_cash":
    case "wallet": return "wallet";
    case "bank":
    case "bank_transfer":
    case "transfer":
    case "card": return "bank";
    default: return "other";
  }
}

export const BUCKET_LABELS: Record<CollectionBucket, string> = {
  cash: "نقدي",
  instapay: "انستاباي",
  wallet: "محفظة",
  bank: "بنكي",
  other: "رصيد مسبق",
};

/** Stored payment_method keys that belong to a collection bucket (used by the payment filter). */
export function methodsForFilter(method: string): string[] {
  const b = bucketOf(method);
  if (b === "wallet") return ["vodafone", "vodafone_cash", "wallet"];
  if (b === "bank") return ["bank", "bank_transfer", "transfer", "card"];
  if (b === "other") return [method];
  return [b];
}

export interface EnrichedSaleFields {
  __paid: number;
  __remaining: number;
  __payState: SalePayState;
  __byBucket: Record<CollectionBucket, number>;
}

/** Memoized merge of page rows with their payment breakdown (recomputed only when inputs change). */
export function useEnrichedSaleRows<T extends { id: string; total?: number | string | null }>(
  rows: T[],
  pays: Map<string, InvoicePaymentSummary> | null,
): (T & Partial<EnrichedSaleFields>)[] {
  return useMemo(() => {
    if (!pays) return rows;
    return rows.map((x) => {
      const s = pays.get(x.id);
      const paid = s?.paid ?? 0;
      const total = Number(x.total) || 0;
      return { ...x, __paid: paid, __remaining: Math.max(0, r2(total - paid)), __payState: salePayState(total, paid), __byBucket: s?.byBucket ?? emptyBuckets() };
    });
  }, [rows, pays]);
}

export function salePayState(total: number, paid: number): SalePayState {
  if (paid <= 0.01) return "credit";
  if (paid >= total - 0.01) return "paid";
  return "partial";
}

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Net paid per invoice (excludes voided payments and reversal rows), grouped by collection bucket. */
export async function fetchPaymentSummaries(invoiceIds: string[], signal?: AbortSignal): Promise<Map<string, InvoicePaymentSummary>> {
  const out = new Map<string, InvoicePaymentSummary>();
  const CHUNK = 150;
  for (let i = 0; i < invoiceIds.length; i += CHUNK) {
    const ids = invoiceIds.slice(i, i + CHUNK);
    const rows = await fetchAllRows<PaymentRow>(() => {
      let q = supabase
        .from("invoice_payments")
        .select("id, invoice_id, amount, payment_method, voided_at, reverses_payment_id")
        .in("invoice_id", ids)
        .order("id");
      if (signal) q = q.abortSignal(signal);
      return q;
    });
    for (const p of rows) {
      if (p.voided_at || p.reverses_payment_id) continue;
      const amt = Number(p.amount) || 0;
      const s = out.get(p.invoice_id) ?? { paid: 0, byBucket: emptyBuckets(), methods: [] };
      s.paid = r2(s.paid + amt);
      const b = bucketOf(p.payment_method);
      s.byBucket[b] = r2(s.byBucket[b] + amt);
      if (p.payment_method && !s.methods.includes(p.payment_method)) s.methods.push(p.payment_method);
      out.set(p.invoice_id, s);
    }
  }
  return out;
}
