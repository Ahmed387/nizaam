import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatEGP } from "@/lib/format";
import type { SideOverview } from "@/lib/ledger";

/**
 * «الرصيد الفعلي» of a customer / supplier at the top of his file: what he owes us and what we owe him.
 * Each total is built from the two separate accounts (customer debt + our advance at him as a supplier, and
 * the reverse) — the accounts are never netted against each other (owner rule).
 */
export function ContactBalanceHeader({ customer, supplier, scopeLabel }: { customer: SideOverview | null; supplier: SideOverview | null; scopeLabel?: string }) {
  const c = Number(customer?.balance ?? 0), s = Number(supplier?.balance ?? 0);
  const fromCustomer = Math.max(c, 0), supplierAdvance = Math.max(-s, 0);
  const toSupplier = Math.max(s, 0), customerAdvance = Math.max(-c, 0);
  const us = fromCustomer + supplierAdvance, them = toSupplier + customerAdvance;

  const Card = ({ title, total, tone, icon, lines }: { title: string; total: number; tone: string; icon: JSX.Element; lines: [string, number][] }) => (
    <div className={`card-elevated flex-1 min-w-[220px] p-4 border-r-4 ${tone}`}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{title}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums">{total > 0.005 ? formatEGP(total) : "—"}</div>
      {lines.filter(([, v]) => v > 0.005).length > 0 && (
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {lines.filter(([, v]) => v > 0.005).map(([l, v]) => <div key={l} className="flex justify-between gap-3"><span>{l}</span><span className="tabular-nums">{formatEGP(v)}</span></div>)}
        </div>
      )}
    </div>
  );

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="font-bold">الرصيد الفعلي</h3>
        {scopeLabel && <span className="text-xs text-muted-foreground">{scopeLabel}</span>}
      </div>
      <div className="flex flex-wrap gap-3">
        <Card title="لينا عنده" total={us} tone="border-success" icon={<ArrowDownLeft className="h-4 w-4 text-success" />}
          lines={[["عليه كعميل (فواتير مفتوحة)", fromCustomer], ["مقدم دفعناه له كمورد", supplierAdvance]]} />
        <Card title="علينا له" total={them} tone="border-destructive" icon={<ArrowUpRight className="h-4 w-4 text-destructive" />}
          lines={[["له كمورد (فواتير شراء مفتوحة)", toSupplier], ["مقدم دفعه لنا كعميل", customerAdvance]]} />
      </div>
      {us <= 0.005 && them <= 0.005 && <p className="mt-1 text-xs text-success">الحساب مسدد بالكامل.</p>}
    </div>
  );
}
