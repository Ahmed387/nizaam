import { useEffect, useMemo, useState } from "react";
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

export interface SalesMetrics {
  count: number;
  activeCount: number;
  cancelledCount: number;
  cancelledTotal: number;
  totalSales: number;
  collected: number;
  remaining: number;
  byBucket: Record<CollectionBucket, number>;
}

interface PaymentRow {
  invoice_id: string;
  amount: number | string | null;
  payment_method: string | null;
  voided_at: string | null;
  reverses_payment_id: string | null;
}

interface InvoiceTotalRow {
  id: string;
  total: number | string | null;
  status: string;
}

/** Query factory shared with the table: same filters, only the projection differs. */
export type SalesQueryBuilder = (select: string, withCount: boolean) => Promise<{ qb: any }>;

const emptyBuckets = (): Record<CollectionBucket, number> => ({ cash: 0, instapay: 0, wallet: 0, bank: 0, other: 0 });

export function bucketOf(method: string | null | undefined): CollectionBucket {
  switch (method) {
    case "cash": return "cash";
    case "instapay": return "instapay";
    case "vodafone":
    case "wallet": return "wallet";
    case "bank": return "bank";
    default: return "other";
  }
}

export const BUCKET_LABELS: Record<CollectionBucket, string> = {
  cash: "نقدي",
  instapay: "انستاباي",
  wallet: "محفظة",
  bank: "بنكي",
  other: "أخرى",
};

/** Stored payment_method keys that belong to a collection bucket (used by the payment filter). */
export function methodsForFilter(method: string): string[] {
  const b = bucketOf(method);
  if (b === "wallet") return ["vodafone", "wallet"];
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

const r2 = (n: number) => Math.round(n * 100) / 100;

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

/**
 * Metrics for the sale tab. Reads ALL rows matching the exact same query the
 * table uses (not just the visible page), so cards and table never diverge.
 */
export function useSalesMetrics(buildQuery: SalesQueryBuilder, enabled: boolean, refreshKey: number) {
  const [metrics, setMetrics] = useState<SalesMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) { setMetrics(null); return; }
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Same filtered query as the table, paged in 1,000-row batches (never limited to the visible page).
        const invoices: InvoiceTotalRow[] = [];
        for (let from = 0; ; from += 1000) {
          const { qb } = await buildQuery("id, total, status", false);
          const { data, error } = await qb.order("id").range(from, from + 999).abortSignal(ctrl.signal);
          if (error) throw error;
          invoices.push(...((data ?? []) as InvoiceTotalRow[]));
          if (!data || data.length < 1000) break;
        }
        // The payment-method filter uses an inner join that can repeat an invoice per matching payment — dedupe by id.
        const seen = new Set<string>();
        const unique = invoices.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
        const activeRows = unique.filter((i) => i.status === "active");
        const pays = await fetchPaymentSummaries(activeRows.map((i) => i.id), ctrl.signal);
        const cancelledRows = unique.filter((i) => i.status !== "active");
        const cancelledTotal = r2(cancelledRows.reduce((a, i) => a + (Number(i.total) || 0), 0));
        let totalSales = 0, collected = 0, remaining = 0;
        const byBucket = emptyBuckets();
        for (const inv of activeRows) {
          const total = Number(inv.total) || 0;
          const s = pays.get(inv.id);
          const paid = s?.paid ?? 0;
          totalSales += total;
          collected += paid;
          remaining += Math.max(0, total - paid);
          if (s) (Object.keys(byBucket) as CollectionBucket[]).forEach((k) => { byBucket[k] += s.byBucket[k]; });
        }
        (Object.keys(byBucket) as CollectionBucket[]).forEach((k) => { byBucket[k] = r2(byBucket[k]); });
        if (!cancelled) setMetrics({ count: unique.length, activeCount: activeRows.length, cancelledCount: cancelledRows.length, cancelledTotal, totalSales: r2(totalSales), collected: r2(collected), remaining: r2(remaining), byBucket });
      } catch (e) {
        if (!cancelled && (e as { name?: string })?.name !== "AbortError") setMetrics(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [buildQuery, enabled, refreshKey]);

  return { metrics, loading };
}
