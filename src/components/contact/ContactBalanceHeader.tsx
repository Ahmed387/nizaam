import { formatEGP } from "@/lib/format";
import type { SideOverview } from "@/lib/ledger";

/**
 * The account's ONE balance (owner 2026-11-11 «التعامل الأول والأخير … دائن ومدين ورصيد»), the way «سهل» shows a name:
 *   الرصيد = رصيد ناحية العميل − رصيد ناحية المورد؛ موجب = مدين (لنا عنده)، سالب = دائن (علينا له).
 * No «لينا عنده / علينا له» cards and no open / closed invoices: the movements table under it explains the number.
 */
export function ContactBalanceHeader({ customer, supplier, scopeLabel }: { customer: SideOverview | null; supplier: SideOverview | null; scopeLabel?: string }) {
  const net = Math.round((Number(customer?.balance ?? 0) - Number(supplier?.balance ?? 0)) * 100) / 100;
  const zero = Math.abs(net) <= 0.005;
  const tone = zero ? "border-muted-foreground/40" : net > 0 ? "border-success" : "border-destructive";
  return (
    <div className={`card-elevated mb-4 p-4 border-r-4 ${tone} flex flex-wrap items-end gap-x-8 gap-y-2`} data-testid="account-balance">
      <div>
        <div className="text-sm text-muted-foreground">الرصيد الحالى{scopeLabel ? ` — ${scopeLabel}` : ""}</div>
        <div className="mt-1 text-3xl font-extrabold tabular-nums">{zero ? "0" : formatEGP(Math.abs(net))}</div>
      </div>
      <div className={`text-lg font-bold ${zero ? "text-muted-foreground" : net > 0 ? "text-success" : "text-destructive"}`}>
        {zero ? "مسدد" : net > 0 ? "مدين — لنا عنده" : "دائن — علينا له"}
      </div>
    </div>
  );
}
