import { formatEGP } from "@/lib/format";
import { methodLabel, type Side, type SideOverview } from "@/lib/ledger";

/**
 * Cards of ONE side of a contact (customer or supplier) from the unified ledger. The two sides are
 * always shown apart: nothing here adds or subtracts one side from the other.
 */
export function SideSummary({ side, data, compact = false }: { side: Side; data: SideOverview; compact?: boolean }) {
  const isC = side === "customer";
  const bal = data.balance;
  const balText = Math.abs(bal) <= 0.005
    ? "الحساب مسدد"
    : isC ? (bal > 0 ? "مستحق لنا على العميل" : "مقدم من العميل عندنا") : (bal > 0 ? "مستحق للمورد علينا" : "مقدم لينا عند المورد");
  const balTone = Math.abs(bal) <= 0.005 ? "text-muted-foreground" : bal > 0 ? (isC ? "text-warning" : "text-destructive") : "text-primary";
  const Card =({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );

  // Branch staff looking at "all branches" get the contact's global totals only — the documents and
  // money of other branches stay with those branches.
  if (data.totals_only || !data.documents) {
    return (
      <div className="space-y-2">
        <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
          <Card label={balText} value={formatEGP(Math.abs(bal))} tone={balTone} />
          <Card label={isC ? "فواتير مفتوحة عليه" : "فواتير شراء مفتوحة"} value={formatEGP(data.open_remaining)} />
          <Card label={isC ? "مقدم من العميل" : "مقدم لينا عند المورد"} value={formatEGP(data.advance)} />
          <Card label="أقساط متأخرة" value={formatEGP(data.overdue)} tone={data.overdue > 0.005 ? "text-destructive" : ""} />
        </div>
        <div className="text-[11px] text-muted-foreground">إجمالي الرصيد على مستوى الشركة. تفاصيل الفواتير والفلوس بتاعة الفروع التانية بتظهر للإدارة بس.</div>
      </div>
    );
  }
  const money = isC ? data.money.collected ?? 0 : data.money.paid ?? 0;
  const methods = Object.entries(data.money.by_method ?? {}).filter(([, v]) => Math.abs(v) > 0.005);

  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-6"}`}>
      <Card label={balText} value={formatEGP(Math.abs(bal))} tone={balTone}
        sub={`مفتوح ${formatEGP(data.open_remaining)} · مقدم ${formatEGP(data.advance)}`} />
      <Card label={isC ? "إجمالي المبيعات" : "إجمالي المشتريات"} value={formatEGP(data.documents.total)}
        sub={`${data.documents.count} فاتورة · مفتوحة ${data.documents.open_count} · مقفولة ${data.documents.closed_count}`} />
      <Card label={isC ? "المقبوض من العميل" : "المدفوع للمورد"} value={formatEGP(money)}
        sub={methods.length ? methods.map(([k, v]) => `${methodLabel(k)} ${formatEGP(v)}`).join(" · ") : undefined} tone="text-success" />
      <Card label={isC ? "مرتجعات البيع" : "مرتجعات الشراء"} value={formatEGP(data.returns.total)}
        sub={`${data.returns.count} مرتجع · نقدي ${formatEGP(data.returns.cash)} · على الحساب ${formatEGP(data.returns.credit)}`} />
      {!compact && (
        <Card label={isC ? "فلوس رجعت للعميل" : "فلوس رجعت من المورد"} value={formatEGP(data.money.refunded)}
          sub={`رصيد افتتاحي: ${data.money.opening_debt ? formatEGP(data.money.opening_debt) + (isC ? " عليه" : " له") : data.money.opening_advance ? formatEGP(data.money.opening_advance) + " مقدم" : "—"}`} />
      )}
      {!compact && (
        <Card label="أقساط متأخرة" value={formatEGP(data.overdue)} tone={data.overdue > 0.005 ? "text-destructive" : ""}
          sub={data.documents.cancelled_count ? `ملغاة: ${data.documents.cancelled_count} (${formatEGP(data.documents.cancelled_total)})` : "مفيش مستندات ملغاة"} />
      )}
    </div>
  );
}
