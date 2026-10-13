import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";

/** Payment status of a sale invoice, derived from net (non-voided) invoice payments. */
export type SalePayState = "paid" | "partial" | "credit";

/** Money buckets + `account` = «من تحت حسابه» (used by choice) + `other` = «من مرتجع» (return credit, not money). */
export type CollectionBucket = "cash" | "instapay" | "wallet" | "bank" | "account" | "other";

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

export const emptyBuckets = (): Record<CollectionBucket, number> => ({ cash: 0, instapay: 0, wallet: 0, bank: 0, account: 0, other: 0 });

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
    case "credit_balance":
    case "credit_applied": return "account";
    default: return "other";
  }
}

export const BUCKET_LABELS: Record<CollectionBucket, string> = {
  cash: "كاش",
  instapay: "انستاباي",
  wallet: "محفظة",
  bank: "بنكي",
  account: "من تحت حسابه",
  other: "من مرتجع",
};

/** One row of invoice_settlement / shipment_settlement (migration 0083): how a sale / purchase invoice was settled. */
export interface DocSettlement {
  class: "cash" | "credit";
  state: "paid" | "partial" | "unpaid";
  at_sale: number; later_money: number; from_account: number; from_return: number;
  cash: number; instapay: number; wallet: number; bank: number; paid: number; remaining: number;
}
export const SETTLE_COLS = "class, state, at_sale, later_money, from_account, from_return, cash, instapay, wallet, bank, paid, remaining";

/** The payment columns of a document from its settlement row. */
export function settleBuckets(s: Partial<DocSettlement> | null | undefined): Record<CollectionBucket, number> {
  const n = (v: unknown) => Number(v) || 0;
  return { cash: n(s?.cash), instapay: n(s?.instapay), wallet: n(s?.wallet), bank: n(s?.bank), account: n(s?.from_account), other: n(s?.from_return) };
}

/** Stored payment_method keys that belong to a collection bucket (used by the payment filter). */
export function methodsForFilter(method: string): string[] {
  const b = bucketOf(method);
  if (b === "wallet") return ["vodafone", "vodafone_cash", "wallet"];
  if (b === "bank") return ["bank", "bank_transfer", "transfer", "card"];
  if (b === "account") return ["credit_balance", "credit_applied"];
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
