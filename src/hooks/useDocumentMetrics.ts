import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { applyCairoRange, cairoTodayDay } from "@/lib/cairoDate";
import { aggregateFacts, docFacts, enrichSettled, METRIC_SELECT, type DocKind, type DocMetricsResult } from "@/lib/documentMetrics";
import { fetchDocumentStatus } from "@/lib/ledger";
import { emptyBuckets, r2, type CollectionBucket } from "@/hooks/useSalesInvoices";

/** Query factory shared with the table: same filters, only the projection differs. */
export type DocQueryBuilder = (select: string, withCount: boolean) => Promise<{ qb: any }>;

/** One side of the «نقدي / آجل» split: how many documents, their total, and how they were paid. */
export interface PaySplit {
  count: number;
  total: number;
  /** how these documents were settled: money by method, `account` = «من تحت حسابه», `other` = «من مرتجع» */
  byBucket: Record<CollectionBucket, number>;
  /** still open on them (credit side only) */
  remaining: number;
}

export interface DocMetrics extends DocMetricsResult {
  /** Purchases only: supplier payments recorded in the same branch and period. */
  supplierPaid?: number;
  supplierDue?: number;
  /** Sale / purchase: fully paid documents («نقدي») vs documents still open («آجل»). */
  split?: { cash: PaySplit; credit: PaySplit };
}

/**
 * Unified metrics for the six document screens. Reads ALL rows of the exact query the
 * table uses (branch-scoped, same filters, document date), so cards and table never diverge.
 */
export function useDocumentMetrics(
  kind: DocKind | null,
  buildQuery: DocQueryBuilder,
  ctx: { branchId?: string; from: string; to: string },
  refreshKey: number,
) {
  const [metrics, setMetrics] = useState<DocMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!kind || !ctx.branchId) { setMetrics(null); return; }
    const ctrl = new AbortController();
    let cancelled = false;
    // a period that ended before today: paid / open as of its last day (not as of today)
    const asOf = ctx.to && ctx.to < cairoTodayDay() ? ctx.to : null;
    setLoading(true);
    (async () => {
      try {
        const rows: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { qb } = await buildQuery(METRIC_SELECT[kind], false);
          const { data, error } = await qb.order("id").range(from, from + 999).abortSignal(ctrl.signal);
          if (error) throw error;
          rows.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }
        // Inner joins (payment filter) can repeat a document — one row per id.
        const seen = new Set<string>();
        let unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

        if (kind === "sale" || kind === "purchase") {
          // paid / open from the unified ledger (as of the period's last day for a past period),
          // «التصنيف» and how each document was settled from its settlement row (0083, embedded by the query)
          const live = unique.filter((r) => r.status !== "cancelled");
          const st = await fetchDocumentStatus(kind === "sale" ? "invoice" : "shipment", live.map((r) => r.id), ctrl.signal, asOf);
          unique = unique.map((r) => enrichSettled(r, kind === "sale" ? r.total : r.total_cost, st.get(r.id)));
        }
        const result: DocMetrics = aggregateFacts(unique.map((r) => docFacts(kind, r)));

        if (kind === "sale" || kind === "purchase") {
          // «نقدي» / «آجل» by the document's class; under each card: how its money came (and, آجل, what is still open)
          const mk = (): PaySplit => ({ count: 0, total: 0, byBucket: emptyBuckets(), remaining: 0 });
          const split = { cash: mk(), credit: mk() };
          for (const r of unique) {
            if (r.status === "cancelled") continue;
            const side = r.__class === "cash" ? split.cash : split.credit;
            side.count += 1;
            side.total += Number(kind === "sale" ? r.total : r.total_cost) || 0;
            side.remaining += Number(r.__remaining) || 0;
            (Object.keys(side.byBucket) as CollectionBucket[]).forEach((k) => { side.byBucket[k] += Number(r.__byBucket?.[k]) || 0; });
          }
          for (const s of [split.cash, split.credit]) {
            s.total = r2(s.total); s.remaining = r2(s.remaining);
            (Object.keys(s.byBucket) as CollectionBucket[]).forEach((k) => { s.byBucket[k] = r2(s.byBucket[k]); });
          }
          result.split = split;
        }
        if (kind === "purchase") {
          // «المسدد للموردين» = money allocated to these purchase invoices; purchase-return credit is not money.
          result.supplierPaid = r2(unique.reduce((s, r) => s + (Number(r.__paid_money) || 0), 0));
          result.supplierDue = r2(result.values.supplierDue ?? 0);
          result.counts.supplierPaid = unique.filter((r) => r.status !== "cancelled" && r.__remaining <= 0.01).length;
          result.counts.supplierDue = unique.filter((r) => r.status !== "cancelled" && r.__remaining > 0.01).length;
        }
        if (!cancelled) setMetrics(result);
      } catch (e) {
        if (!cancelled && (e as { name?: string })?.name !== "AbortError") setMetrics(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [kind, buildQuery, ctx.branchId, ctx.from, ctx.to, refreshKey]);

  return { metrics, loading };
}
