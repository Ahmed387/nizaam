import { formatEGP } from "@/lib/format";
import type { SideOverview } from "@/lib/ledger";
import { netKind, netOf, netTone } from "@/lib/netBalance";

/**
 * The account's ONE balance (owner 2026-11-11 «التعامل الأول والأخير … دائن ومدين ورصيد»), the way «سهل» shows a name:
 *   الرصيد = رصيد ناحية العميل − رصيد ناحية المورد؛ الرصيد = ناحية المورد − ناحية العميل؛ دائن موجب (علينا له)، مدين سالب (لنا عنده) — owner 2026-11-12 «حساب جاري».
 * No «لينا عنده / علينا له» cards and no open / closed invoices: the movements table under it explains the number.
 */
export function ContactBalanceHeader({ customer, supplier, scopeLabel }: { customer: SideOverview | null; supplier: SideOverview | null; scopeLabel?: string }) {
  const net = netOf(customer?.balance, supplier?.balance);
  const kind = netKind(net);
  const tone = kind === "zero" ? "border-muted-foreground/40" : kind === "debit" ? "border-success" : "border-destructive";
  return (
    <div className={`card-elevated mb-4 p-4 border-r-4 ${tone} flex flex-wrap items-end gap-x-8 gap-y-2`} data-testid="account-balance">
      <div>
        <div className="text-sm text-muted-foreground">الرصيد الحالى{scopeLabel ? ` — ${scopeLabel}` : ""}</div>
        <div className="mt-1 text-3xl font-extrabold tabular-nums" dir="ltr">{kind === "zero" ? "0" : `${net < 0 ? "-" : ""}${formatEGP(Math.abs(net))}`}</div>
      </div>
      <div className={`text-lg font-bold ${netTone(net)}`}>{kind === "zero" ? "مسدد" : kind === "debit" ? "مدين — لنا عنده" : "دائن — علينا له"}</div>
    </div>
  );
}
