import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermTable } from "@/components/PermTable";
import { formatDate, formatEGP } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelContactSettlement, settleKindText, type ContactSettlement } from "@/lib/contactSettlement";

/**
 * The account's settlements (both kinds) with «إلغاء» — the only door that cancels a settlement (0291: its two vouchers
 * can't be cancelled, edited or restored one by one). Cancel is booked on the settlement's own day.
 */
export function SettlementList({ list, branchName, onChanged }: {
  list: ContactSettlement[]; branchName: (id: string) => string; onChanged: () => void;
}) {
  const [row, setRow] = useState<ContactSettlement | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (list.length === 0) return null;

  const doCancel = async () => {
    if (!row) return;
    if (!reason.trim()) return toast.error("اكتب سبب الإلغاء");
    setBusy(true);
    try {
      await cancelContactSettlement(row.id, reason);
      toast.success(`اتلغت التسوية ${row.settlement_number} في يومها`);
      setRow(null); setReason("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر الإلغاء");
    } finally {
      setBusy(false);
    }
  };

  const pl = row?.kind === "profit_loss";
  return (
    <div className="mt-2 min-w-0 border-t pt-3" data-testid="settle-list">
      <div className="mb-2 text-sm font-semibold">التسويات اللي اتعملت</div>
      <div className="max-w-full overflow-x-auto">
      <PermTable className="w-full text-xs">
        <thead><tr><th className="text-right">الرقم</th><th className="text-right">التاريخ</th><th className="text-right">النوع</th>
          <th className="text-right">المبلغ</th><th className="text-right">الفرع</th><th className="text-right">الحالة</th><th /></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} data-testid={`settle-row-${s.settlement_number}`} className={cn(s.status === "cancelled" && "text-muted-foreground line-through")}>
              <td>{s.settlement_number}</td>
              <td>{formatDate(s.settlement_date)}</td>
              <td className={cn(s.kind === "profit_loss" && s.status === "active" && (s.result === "gain" ? "text-success" : "text-destructive"))}>
                {settleKindText(s)}
              </td>
              <td>{formatEGP(s.amount)}</td>
              <td>{branchName(s.branch_id)}</td>
              <td>{s.status === "active" ? "شغالة" : "ملغية"}</td>
              <td>{s.status === "active" && (
                <Button size="sm" variant="ghost" className="h-7 text-destructive" data-testid={`settle-cancel-${s.settlement_number}`}
                  onClick={() => { setRow(s); setReason(""); }}>إلغاء</Button>
              )}</td>
            </tr>
          ))}
        </tbody>
      </PermTable>
      </div>

      <Dialog open={!!row} onOpenChange={(o) => !o && setRow(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إلغاء التسوية {row?.settlement_number}</DialogTitle>
            <DialogDescription>
              {pl
                ? `الرصيد يرجع زي ما كان، و${row?.result === "gain" ? "الربح" : "الخسارة"} (${formatEGP(row?.amount ?? 0)}) تتشال من ربح شهرها. الخزن الحقيقية ما تتحركش. لو فترة يومها مقفولة الإلغاء هيترفض.`
                : "الرصيد يرجع زي ما كان، والإلغاء بيتسجل في يوم التسوية نفسه. الخزن الحقيقية ما تتحركش."}
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={2} placeholder="سبب الإلغاء" data-testid="settle-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter className="gap-2 sm:justify-start">
            <Button variant="destructive" onClick={doCancel} disabled={busy} data-testid="settle-cancel-go">الغيها</Button>
            <Button variant="ghost" onClick={() => setRow(null)}>رجوع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A branch card with his balance there — only branches where that side has a balance are offered. */
export function BranchBalancePick({ items, value, onPick, text, prefix }: {
  items: { id: string; name: string; net: number }[]; value: string | null; onPick: (id: string) => void;
  text: (net: number) => string; prefix: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="الفرع">
      {items.map((b) => (
        <button key={b.id} type="button" role="radio" aria-checked={value === b.id} data-testid={`${prefix}-branch-${b.id}`}
          onClick={() => onPick(b.id)}
          className={cn("rounded-md border p-2 text-right transition-colors",
            value === b.id ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted")}>
          <div className="text-xs text-muted-foreground">{b.name}</div>
          <div className="font-semibold tabular-nums">{text(b.net)}</div>
        </button>
      ))}
    </div>
  );
}

/** Two choices the owner decides between (above the balance / the other side). */
export function ChoiceCards({ prefix, value, onPick, options }: {
  prefix: string; value: string | null; onPick: (v: string) => void; options: { value: string; title: string; note: string }[];
}) {
  return (
    <div className="space-y-2" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} data-testid={`${prefix}-${o.value}`}
          onClick={() => onPick(o.value)}
          className={cn("w-full rounded-md border p-2 text-right transition-colors",
            value === o.value ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted")}>
          <div className="font-semibold">{o.title}</div>
          <div className="text-xs text-muted-foreground">{o.note}</div>
        </button>
      ))}
    </div>
  );
}
