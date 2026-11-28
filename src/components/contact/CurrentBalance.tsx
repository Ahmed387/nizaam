import { useEffect, useState } from "react";
import { balanceScope, netOfSides, netText, netTone } from "@/lib/netBalance";
import { fetchSideBalance } from "@/lib/ledger";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

/** An account's ONE net balance, live: this branch for a branch user, every branch for an admin (with its scope text). */
export function useAccountNet(contactId: string | null | undefined, branchId: string | null | undefined, reloadKey: unknown = 0) {
  const { isAdmin } = useAuth();
  const [v, setV] = useState<{ net: number; scope: string } | null>(null);
  useEffect(() => {
    if (!contactId) { setV(null); return; }
    let off = false;
    const all = isAdmin || !branchId;
    fetchSideBalance(contactId, all ? null : branchId)
      .then((sb) => { if (!off) setV({ net: netOfSides(sb), scope: balanceScope(all) }); })
      .catch(() => { if (!off) setV(null); });
    return () => { off = true; };
  }, [contactId, branchId, isAdmin, reloadKey]);
  return v;
}

/**
 * «الرصيد الحالي: 316,269.95 ج.م مدين» — the ONE way an account's balance is shown next to a form / document (owner PDF
 * 2026-11-28 part 2): no minus sign, مدين green / دائن red / مسدد grey, the scope («الفرع ده» / «كل الفروع») beside it,
 * and an optional second line «الرصيد بعد السند / بعد الفاتورة».
 */
export function CurrentBalance({
  net, scope, after, afterLabel = "الرصيد بعد السند", before, beforeLabel = "الرصيد السابق", label = "الرصيد الحالي", className, testId = "current-balance",
}: {
  net: number; scope?: string; after?: number | null; afterLabel?: string; before?: number | null; beforeLabel?: string; label?: string; className?: string; testId?: string;
}) {
  const row = (t: string, v: number, id: string) => (
    <div className="flex items-center justify-between gap-3" data-testid={id}>
      <span className="text-muted-foreground">{t}</span>
      <span className={cn("font-bold tabular-nums", netTone(v))}>{netText(v)}</span>
    </div>
  );
  return (
    <div className={cn("rounded-md border bg-muted/30 p-3 text-sm space-y-1", className)} data-testid={testId}>
      {typeof before === "number" && row(beforeLabel, before, `${testId}-before`)}
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}{scope ? <span className="ms-1 text-[11px] font-normal text-muted-foreground">({scope})</span> : null}</span>
        <span className={cn("font-bold tabular-nums", netTone(net))} data-testid={`${testId}-now`}>{netText(net)}</span>
      </div>
      {typeof after === "number" && row(afterLabel, after, `${testId}-after`)}
    </div>
  );
}
