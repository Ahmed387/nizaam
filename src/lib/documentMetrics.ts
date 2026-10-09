import { bucketOf, emptyBuckets, r2, type CollectionBucket } from "@/hooks/useSalesInvoices";

/** The six document screens that share the unified metrics engine. */
export type DocKind = "sale" | "purchase" | "sale_return" | "purchase_return" | "income" | "expense";
export const DOC_KINDS: DocKind[] = ["sale", "purchase", "sale_return", "purchase_return", "income", "expense"];
export const isDocKind = (k: string): k is DocKind => (DOC_KINDS as string[]).includes(k);

/** Card keys: "active" (gross total), "cancelled", kind-specific parts, or a collection bucket. */
export type DocCardKey = string;

/** Per-row accounting facts. Every card value and every click-to-filter reads these same facts. */
export interface DocFacts {
  cancelled: boolean;
  amount: number;
  parts: Record<string, number>;
  byBucket: Record<CollectionBucket, number>;
}

const n = (v: unknown) => Number(v) || 0;
type Row = Record<string, any>;

/** Refund split of a return row; legacy rows without split columns fall back to refund_method. */
function refundSplit(r: Row, amount: number) {
  let cash = n(r.refund_cash_amount), transfer = n(r.refund_transfer_amount), balance = n(r.refund_balance_amount);
  if (cash + transfer + balance <= 0.01 && amount > 0) {
    if (r.refund_method === "balance" || r.refund_method === "credit_balance") balance = amount;
    else if (bucketOf(r.refund_method) === "cash") cash = amount;
    else transfer = amount;
  }
  return { cash, transfer, balance };
}

export function docFacts(kind: DocKind, r: Row): DocFacts {
  const byBucket = emptyBuckets();
  // only a cancelled document is "cancelled" (a draft return is neither active money nor cancelled)
  const cancelled = (r.status ?? "active") === "cancelled";
  switch (kind) {
    case "sale": {
      const amount = n(r.total);
      Object.assign(byBucket, r.__byBucket ?? {});
      return { cancelled, amount, parts: { active: amount, collected: n(r.__paid_money ?? r.__paid), remaining: n(r.__remaining) }, byBucket };
    }
    case "purchase": {
      const amount = n(r.total_cost);
      const remaining = n(r.__remaining);
      return { cancelled, amount, parts: { active: amount, supplierPaid: n(r.__paid_money ?? r.__paid), supplierDue: remaining, fullyPaid: remaining <= 0.01 ? amount : 0 }, byBucket };
    }
    case "sale_return":
    case "purchase_return": {
      const amount = n(kind === "sale_return" ? r.total_refund : r.total_amount);
      const s = refundSplit(r, amount);
      byBucket.cash = s.cash;
      byBucket[r.refund_method && bucketOf(r.refund_method) !== "cash" && bucketOf(r.refund_method) !== "other" ? bucketOf(r.refund_method) : "bank"] += s.transfer;
      byBucket.other = s.balance;
      return kind === "sale_return"
        ? { cancelled, amount, parts: { active: amount, paidOut: s.cash + s.transfer, credit: s.balance }, byBucket }
        : { cancelled, amount, parts: { active: amount, refunded: s.cash + s.transfer, deducted: s.balance }, byBucket };
    }
    case "income":
    case "expense": {
      const amount = n(r.amount);
      byBucket[bucketOf(r.payment_method)] = amount;
      const sysKey = r.voucher_categories?.system_key;
      // flow_class (Step 6E) says what the money really is, also for vouchers written by the till
      const fc: string | null = r.flow_class ?? null;
      if (kind === "income") {
        const fromCustomer = fc ? fc === "customer" : r.party_type === "customer";
        return { cancelled, amount, parts: { active: amount, customers: fromCustomer ? amount : 0, otherIncome: fromCustomer ? 0 : amount }, byBucket };
      }
      const supplier = fc ? fc === "supplier" : (sysKey === "supplier_payment" || r.party_type === "supplier");
      const internal = !supplier && (fc ? fc === "internal" || fc === "customer_refund" : isInternalOrRefundPayment(sysKey, r.voucher_categories?.name, r.party_type));
      return { cancelled, amount, parts: { active: amount, suppliers: supplier ? amount : 0, internal: internal ? amount : 0, operating: supplier || internal ? 0 : amount }, byBucket };
    }
  }
}

export interface DocMetricsResult {
  /** Σ per card key over active rows ("cancelled" sums cancelled rows). */
  values: Record<string, number>;
  /** Number of rows contributing to each card. */
  counts: Record<string, number>;
  byBucket: Record<CollectionBucket, number>;
}

export function aggregateFacts(facts: DocFacts[]): DocMetricsResult {
  const values: Record<string, number> = { cancelled: 0 };
  const counts: Record<string, number> = { cancelled: 0 };
  const byBucket = emptyBuckets();
  for (const f of facts) {
    if (f.cancelled) { values.cancelled += f.amount; counts.cancelled += 1; continue; }
    for (const [k, v] of Object.entries(f.parts)) {
      values[k] = (values[k] ?? 0) + v;
      counts[k] = (counts[k] ?? 0) + (v > 0.01 || k === "active" ? 1 : 0);
    }
    (Object.keys(byBucket) as CollectionBucket[]).forEach((b) => { byBucket[b] += f.byBucket[b]; });
  }
  Object.keys(values).forEach((k) => { values[k] = r2(values[k]); });
  (Object.keys(byBucket) as CollectionBucket[]).forEach((b) => { byBucket[b] = r2(byBucket[b]); });
  return { values, counts, byBucket };
}

const BUCKETS: CollectionBucket[] = ["cash", "instapay", "wallet", "bank", "other"];

/** Click-to-filter on loaded rows — uses the exact facts the cards are built from. */
export function matchesDocCard(kind: DocKind, r: Row, key: DocCardKey | null): boolean {
  if (!key) return true;
  const f = docFacts(kind, r);
  if (key === "cancelled") return f.cancelled;
  if (f.cancelled) return false;
  if (key === "active") return true;
  if ((BUCKETS as string[]).includes(key)) return f.byBucket[key as CollectionBucket] > 0.01;
  if (kind === "purchase" && key === "supplierPaid") return (f.parts.supplierDue ?? 0) <= 0.01;
  return (f.parts[key] ?? 0) > 0.01;
}

/** Lean projection each kind needs for its metrics (all filtered rows, never just one page). */
export const METRIC_SELECT: Record<DocKind, string> = {
  sale: "id, total, status",
  purchase: "id, total_cost, status, contact_id",
  sale_return: "id, total_refund, status, refund_method, refund_account, refund_cash_amount, refund_transfer_amount, refund_balance_amount",
  purchase_return: "id, total_amount, status, refund_method, refund_account, refund_cash_amount, refund_transfer_amount, refund_balance_amount",
  income: "id, amount, status, payment_method, party_type, voucher_categories(system_key)",
  expense: "id, amount, status, payment_method, party_type, voucher_categories(system_key, name)",
};

/** Payment vouchers that move money out but are not operating expenses: transfers between treasuries/branches, refunds to customers, and staff advances (receivables). */
export function isInternalOrRefundPayment(sysKey?: string | null, name?: string | null, partyType?: string | null): boolean {
  if (sysKey === "customer_return" || sysKey === "advance" || (sysKey ?? "").includes("transfer")) return true;
  if (partyType === "customer") return true;
  const n = name ?? "";
  return /تحويل/.test(n) || /مرتجع/.test(n) || /سلف/.test(n) || /مدفوعات لعملاء/.test(n);
}
