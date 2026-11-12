import { useEffect, useState } from "react";
import { ArrowLeftRight, GitMerge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { PermTable } from "@/components/PermTable";

/**
 * «دمج حساب تاني» in the contact file — owner only (migration 0185, `merge_contacts`).
 * The owner picks the second account, sees the PREVIEW (the server runs the real merge and rolls it back, so the numbers
 * shown are exactly what «تأكيد الدمج» does), then confirms. Documents move to the kept account, the other one is archived
 * (never deleted). No money, till, stock or profit moves.
 */
interface MergeSide { id: string; name: string; type: string; customer_balance: number; supplier_balance: number }
interface MergePreview {
  from: MergeSide; into: MergeSide;
  after: { name: string; type: string; customer_balance: number; supplier_balance: number };
  documents: { key: string; label: string; count: number; total: number | null }[];
  balanced: boolean; applied: boolean; difference: { customer: number; supplier: number };
}
interface Hit { id: string; name: string; type: string }

const typeName = (t: string) => (t === "customer" ? "عميل" : t === "supplier" ? "مورد" : "عميل ومورد");
/** One side balance in plain words (customer + = he owes us; supplier + = we owe him). */
const sideText = (side: "customer" | "supplier", v: number) => {
  const a = Math.abs(Number(v) || 0);
  if (a < 0.005) return "—";
  if (side === "customer") return v > 0 ? `${formatEGP(a)} عليه (مدين)` : `${formatEGP(a)} مقدم منه (دائن)`;
  return v > 0 ? `${formatEGP(a)} علينا له (دائن)` : `${formatEGP(a)} مقدم دفعناه له (مدين)`;
};

export function MergeContactButton({ contactId, contactName, branchId, onDone }: {
  contactId: string; contactName: string; branchId: string | null; onDone?: (keptId: string) => void;
}) {
  const { isOwner } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [other, setOther] = useState<Hit | null>(null);
  const [keepThis, setKeepThis] = useState(true);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || other) return;
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const timer = setTimeout(async () => {
      let query = (supabase.from("contacts") as any).select("id,name,type").ilike("name", `%${term}%`)
        .eq("is_archived", false).is("internal_branch_id", null).neq("id", contactId).order("name").limit(20);
      query = branchId ? query.eq("branch_id", branchId) : query;
      const { data } = await query;
      setHits((data ?? []) as Hit[]);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, open, other, contactId, branchId]);

  if (!isOwner) return null;

  const fromId = keepThis ? other?.id : contactId;
  const intoId = keepThis ? contactId : other?.id;

  const run = async (apply: boolean) => {
    if (!fromId || !intoId) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("merge_contacts", { p_from: fromId, p_into: intoId, p_apply: apply });
      if (error) throw error;
      const res = data as MergePreview;
      if (apply) {
        toast.success(`اتدمج «${res.from.name}» في «${res.into.name}»`);
        setOpen(false); onDone?.(intoId);
      } else setPreview(res);
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر الدمج");
    } finally {
      setBusy(false);
    }
  };

  const start = () => { setQ(""); setHits([]); setOther(null); setKeepThis(true); setPreview(null); setOpen(true); };
  const moved = (preview?.documents ?? []).filter((d) => d.count > 0);

  return (
    <>
      <Button variant="outline" onClick={start}><GitMerge className="w-4 h-4 ml-1" /> دمج حساب تاني</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>دمج حسابين</DialogTitle>
            <DialogDescription>
              كل مستندات الحساب اللي هيتشال بتتنقل للحساب الباقي، والحساب القديم بيتأرشف (مش بيتمسح). مفيش فلوس ولا خزنة ولا بضاعة بتتحرك.
            </DialogDescription>
          </DialogHeader>

          {!other ? (
            <div className="space-y-2">
              <Label>اختار الحساب التاني (نفس الفرع)</Label>
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب جزء من الاسم…" />
              <div className="max-h-64 overflow-y-auto divide-y rounded border">
                {hits.map((h) => (
                  <button key={h.id} type="button" className="w-full text-right px-3 py-2 hover:bg-muted text-sm flex justify-between gap-3"
                    onClick={() => { setOther(h); setPreview(null); }}>
                    <span>{h.name}</span><span className="text-xs text-muted-foreground">{typeName(h.type)}</span>
                  </button>
                ))}
                {hits.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">{q.trim().length < 2 ? "اكتب حرفين على الأقل" : "مفيش حساب بالاسم ده"}</div>}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <div className="rounded border border-destructive/40 p-3">
                  <div className="text-xs text-destructive font-semibold">هيتشال (يتأرشف)</div>
                  <div className="font-bold">{keepThis ? other.name : contactName}</div>
                </div>
                <div className="rounded border border-success/50 p-3">
                  <div className="text-xs text-success font-semibold">هيفضل</div>
                  <div className="font-bold">{keepThis ? contactName : other.name}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { setKeepThis((v) => !v); setPreview(null); }}>
                  <ArrowLeftRight className="w-4 h-4 ml-1" /> اعكس (مين يفضل)
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { setOther(null); setPreview(null); }}>اختار حساب تاني</Button>
                {!preview && <Button size="sm" className="btn-gradient" disabled={busy} onClick={() => run(false)}>{busy ? "بحسب…" : "معاينة قبل الدمج"}</Button>}
              </div>

              {preview && (
                <div className="space-y-3">
                  <div className="rounded border">
                    <div className="px-3 py-2 text-sm font-semibold bg-muted/50">اللي هيتنقل للحساب الباقي</div>
                    {moved.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">مفيش مستندات على الحساب اللي هيتشال.</div> : (
                      <PermTable noFilter className="w-full text-sm">
                        <tbody>
                          {moved.map((d) => (
                            <tr key={d.key} className="border-t">
                              <td className="px-3 py-1.5">{d.label}</td>
                              <td className="px-3 py-1.5 tabular-nums">{d.count}</td>
                              <td className="px-3 py-1.5 tabular-nums text-left">{d.total == null ? "" : formatEGP(d.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </PermTable>
                    )}
                  </div>
                  <div className="rounded border">
                    <div className="px-3 py-2 text-sm font-semibold bg-muted/50">الرصيد (كل الفروع) قبل وبعد</div>
                    <PermTable noFilter className="w-full text-sm">
                      <thead><tr className="text-xs text-muted-foreground"><th className="px-3 py-1 text-right"></th><th className="px-3 py-1 text-right">ناحية العميل</th><th className="px-3 py-1 text-right">ناحية المورد</th></tr></thead>
                      <tbody>
                        <tr className="border-t"><td className="px-3 py-1.5">قبل — {preview.from.name}</td><td className="px-3 py-1.5">{sideText("customer", preview.from.customer_balance)}</td><td className="px-3 py-1.5">{sideText("supplier", preview.from.supplier_balance)}</td></tr>
                        <tr className="border-t"><td className="px-3 py-1.5">قبل — {preview.into.name}</td><td className="px-3 py-1.5">{sideText("customer", preview.into.customer_balance)}</td><td className="px-3 py-1.5">{sideText("supplier", preview.into.supplier_balance)}</td></tr>
                        <tr className="border-t font-bold"><td className="px-3 py-1.5">بعد الدمج — {preview.after.name} ({typeName(preview.after.type)})</td><td className="px-3 py-1.5">{sideText("customer", preview.after.customer_balance)}</td><td className="px-3 py-1.5">{sideText("supplier", preview.after.supplier_balance)}</td></tr>
                      </tbody>
                    </PermTable>
                  </div>
                  {preview.balanced
                    ? <p className="text-xs text-success">الرصيد بعد الدمج = مجموع الرصيدين قبله. مفيش فرق.</p>
                    : <p className="text-sm text-destructive font-semibold">فيه فرق بعد الدمج (عميل {formatEGP(preview.difference.customer)}، مورد {formatEGP(preview.difference.supplier)}) — الدمج هيترفض.</p>}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>إلغاء</Button>
            {preview && preview.balanced && (
              <Button variant="destructive" disabled={busy} onClick={() => run(true)}>{busy ? "بدمج…" : "تأكيد الدمج"}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
