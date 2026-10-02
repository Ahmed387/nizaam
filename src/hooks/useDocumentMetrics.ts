import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { applyCairoRange } from "@/lib/cairoDate";
import { aggregateFacts, docFacts, METRIC_SELECT, type DocKind, type DocMetricsResult } from "@/lib/documentMetrics";
import { fetchPurchaseAllocation } from "@/lib/purchaseAllocation";
import { bucketOf, emptyBuckets, fetchPaymentSummaries, r2 } from "@/hooks/useSalesInvoices";

/** Query factory shared with the table: same filters, only the projection differs. */
export type DocQueryBuilder = (select: string, withCount: boolean) => Promise<{ qb: any }>;

export interface DocMetrics extends DocMetricsResult {
  /** Purchases only: supplier payments recorded in the same branch and period. */
  supplierPaid?: number;
  supplierDue?: number;
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

        if (kind === "sale") {
          const pays = await fetchPaymentSummaries(unique.filter((r) => r.status === "active").map((r) => r.id), ctrl.signal);
          unique = unique.map((r) => {
            const s = pays.get(r.id);
            const paid = s?.paid ?? 0;
            return { ...r, __paid: paid, __remaining: Math.max(0, r2((Number(r.total) || 0) - paid)), __byBucket: s?.byBucket ?? emptyBuckets() };
          });
        }

        if (kind === "purchase") {
          const alloc = await fetchPurchaseAllocation(ctx.branchId!, unique.map((r) => r.contact_id), ctrl.signal);
          unique = unique.map((r) => ({ ...r, __paid: alloc.get(r.id)?.paid ?? 0, __remaining: alloc.get(r.id)?.remaining ?? (Number(r.total_cost) || 0) }));
        }
        const result: DocMetrics = aggregateFacts(unique.map((r) => docFacts(kind, r)));

        if (kind === "purchase") {
          // Supplier payments are account-level (not tied to one shipment): same branch + same period.
          const { data: cats } = await supabase.from("voucher_categories" as any).select("id").eq("system_key", "supplier_payment");
          const catIds = ((cats ?? []) as any[]).map((c) => c.id);
          const orExpr = ["party_type.eq.supplier", catIds.length ? `category_id.in.(${catIds.join(",")})` : null].filter(Boolean).join(",");
          const vouchers = await fetchAllRows<any>(() => {
            let q: any = supabase.from("vouchers" as any).select("id, amount, payment_method")
              .eq("branch_id", ctx.branchId!).eq("type", "payment").eq("status", "active").or(orExpr);
            q = applyCairoRange(q, "voucher_date", ctx.from, ctx.to, true);
            return q.order("id").abortSignal(ctrl.signal);
          });
          const byBucket = emptyBuckets();
          let paid = 0;
          for (const v of vouchers) { const a = Number(v.amount) || 0; paid += a; byBucket[bucketOf(v.payment_method)] += a; }
          (Object.keys(byBucket) as (keyof typeof byBucket)[]).forEach((b) => { byBucket[b] = r2(byBucket[b]); });
          result.byBucket = byBucket;
          result.supplierPaid = r2(result.values.supplierPaid ?? 0);
          result.supplierDue = r2(result.values.supplierDue ?? 0);
          result.counts.supplierPaid = unique.filter((r) => r.__remaining <= 0.01).length;
          result.counts.supplierDue = unique.filter((r) => r.__remaining > 0.01).length;
          void paid;
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
