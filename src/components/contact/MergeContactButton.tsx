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
import { rpcErrorText } from "@/lib/rpcError";
import { netText, netTone } from "@/lib/netBalance";
import { candidateNet, contactTypeName, keepAdvice, mergeBranchOptions, mergeNameOptions, mergeNameToSend, splitCandidates, type MergeCandidate, type MergeCandidates } from "@/lib/mergeCandidates";

/**
 * «دمج حساب تاني» in the contact file — owner only (migration 0185, `merge_contacts`).
 * The owner picks the second account, sees the PREVIEW (the server runs the real merge and rolls it back, so the numbers
 * shown are exactly what «تأكيد الدمج» does), then confirms. Documents move to the kept account, the other one is archived
 * (never deleted). No money, till, stock or profit moves.
 * Search (migration 0223, owner 2026-11-15 «البحث فى دمج الحسابات مش متظبط», answer «ب»): `merge_contact_candidates` —
 * written the system's way (ة = ه, ى = ي, أ = ا), any words in any order, name / phone / account number; with nothing typed
 * it lists accounts whose name shares a word with this one. Every branch is listed (own branch first) with account number,
 * branch, type, balance and documents.
 * Across branches (migration 0229, owner 2026-11-15 «اختار الاسم اللي هيبقي ظاهر بيه وكمان الفرع … ويبقي حساب واحد»):
 * an account of another branch can be picked; the owner chooses the NAME (either account's or his own) and the BRANCH
 * of the merged account. Every document keeps its own branch; the preview shows each branch's balance before / after.
 */
interface MergeSide { id: string; name: string; type: string; customer_balance: number; supplier_balance: number }
interface MergeBranchRow { branch_id: string; branch_name: string; customer_before: number; supplier_before: number; customer_after: number; supplier_after: number }
interface MergePreview {
  from: MergeSide; into: MergeSide;
  after: { name: string; type: string; branch_name?: string | null; customer_balance: number; supplier_balance: number };
  branches?: MergeBranchRow[];
  documents: { key: string; label: string; count: number; total: number | null }[];
  balanced: boolean; applied: boolean; difference: { customer: number; supplier: number };
}
type Hit = MergeCandidate;

const typeName = contactTypeName;
/** One side balance in plain words (customer + = he owes us; supplier + = we owe him). */
const sideText = (side: "customer" | "supplier", v: number) => {
  const a = Math.abs(Number(v) || 0);
  if (a < 0.005) return "—";
  if (side === "customer") return v > 0 ? `${formatEGP(a)} عليه (مدين)` : `${formatEGP(a)} مقدم منه (دائن)`;
  return v > 0 ? `${formatEGP(a)} علينا له (دائن)` : `${formatEGP(a)} مقدم دفعناه له (مدين)`;
};

export function MergeContactButton({ contactId, contactName, branchId = null, branchName = null, openingBalance = 0, onDone }: {
  contactId: string; contactName: string; branchId?: string | null; branchName?: string | null; openingBalance?: number; onDone?: (keptId: string) => void;
}) {
  const { isOwner } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [mode, setMode] = useState<"search" | "similar">("similar");
  const [searching, setSearching] = useState(false);
  const [other, setOther] = useState<Hit | null>(null);
  const [keepThis, setKeepThis] = useState(true);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameChoice, setNameChoice] = useState("");
  const [customName, setCustomName] = useState("");
  const [branchChoice, setBranchChoice] = useState("");

  useEffect(() => {
    if (!open || other) return;
    const term = q.trim();
    if (term.length === 1) return; // one letter: wait for the next
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await (supabase.rpc as any)("merge_contact_candidates", { p_contact: contactId, p_query: term || null });
      setSearching(false);
      if (error) { toast.error(rpcErrorText(error)); setHits([]); return; }
      const res = data as MergeCandidates;
      setMode(res?.mode ?? "search");
      setHits(res?.results ?? []);
    }, term ? 300 : 0);
    return () => clearTimeout(timer);
  }, [q, open, other, contactId]);

  if (!isOwner) return null;

  const fromId = keepThis ? other?.id : contactId;
  const intoId = keepThis ? contactId : other?.id;
  const meSide = { id: branchId, name: branchName };
  const otherSide = { id: other?.branch_id ?? null, name: other?.branch_name ?? null };
  const keptName = keepThis ? contactName : other?.name ?? "";
  const goneName = keepThis ? other?.name ?? "" : contactName;
  const nameOptions = other ? mergeNameOptions(keptName, goneName) : [];
  const branchOptions = other ? mergeBranchOptions(keepThis ? meSide : otherSide, keepThis ? otherSide : meSide) : [];
  const finalName = mergeNameToSend(nameChoice || keptName, customName);
  const finalBranch = branchChoice || branchOptions[0]?.id || null;
  const resetChoices = () => { setNameChoice(""); setCustomName(""); setBranchChoice(""); setPreview(null); };

  const run = async (apply: boolean) => {
    if (!fromId || !intoId) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("merge_contacts", {
        p_from: fromId, p_into: intoId, p_apply: apply, p_name: finalName || null, p_branch: finalBranch,
      });
      if (error) throw error;
      const res = data as MergePreview;
      if (apply) {
        toast.success(`اتدمج «${res.from.name}» و«${res.into.name}» في حساب واحد: «${res.after.name}»`);
        setOpen(false); onDone?.(intoId);
      } else setPreview(res);
    } catch (e: any) {
      toast.error(rpcErrorText(e) || "تعذر الدمج");
    } finally {
      setBusy(false);
    }
  };

  const start = () => { setQ(""); setHits([]); setMode("similar"); setOther(null); setKeepThis(true); resetChoices(); setOpen(true); };
  const pick = (h: Hit) => { setOther(h); setKeepThis(keepAdvice(openingBalance, h, contactName).keepThis); resetChoices(); };
  const advice = other ? keepAdvice(openingBalance, other, contactName) : null;
  const { sameBranch, elsewhere } = splitCandidates(hits);
  const row = (h: Hit, enabled: boolean) => {
    const n = candidateNet(h);
    return (
      <button key={h.id} type="button" disabled={!enabled}
        className={`w-full text-right px-3 py-2 text-sm grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 ${enabled ? "hover:bg-muted" : "opacity-60 cursor-not-allowed"}`}
        onClick={() => enabled && pick(h)} title={h.why_not ?? undefined}>
        <span className="font-medium">{h.name}</span>
        <span className={`text-xs tabular-nums ${netTone(n)}`}>{netText(n)}</span>
        <span className="text-xs text-muted-foreground">
          {h.account_no != null && <>رقم {h.account_no} · </>}{typeName(h.type)} · {h.branch_name ?? "—"}{h.phone ? <> · {h.phone}</> : null}
        </span>
        <span className="text-xs text-muted-foreground">{h.documents} مستند{Math.abs(h.opening_balance) > 0.005 ? " · عليه افتتاحي" : ""}</span>
        {!enabled && h.why_not && <span className="col-span-2 text-xs text-warning">{h.why_not}</span>}
      </button>
    );
  };
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
              <Label>اختار الحساب التاني</Label>
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب أي جزء من الاسم أو التليفون أو رقم الحساب — بأي ترتيب" />
              <p className="text-xs text-muted-foreground">
                البحث مش بيفرّق بين ة وه ولا ى وي ولا أ وا. ينفع تدمج مع حساب في نفس الفرع أو في فرع تاني — كل مستند بيفضل في فرعه.
              </p>
              <div className="max-h-80 overflow-y-auto rounded border">
                {mode === "similar" && hits.length > 0 && <div className="px-3 py-1.5 text-xs font-semibold bg-muted/50">حسابات اسمها قريب من «{contactName}»</div>}
                {searching && <div className="px-3 py-4 text-sm text-muted-foreground">بدوّر…</div>}
                {!searching && sameBranch.length > 0 && <div className="divide-y">{sameBranch.map((h) => row(h, h.can_merge))}</div>}
                {!searching && elsewhere.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-xs font-semibold bg-muted/50 border-t">في فروع تانية</div>
                    <div className="divide-y">{elsewhere.map((h) => row(h, h.can_merge))}</div>
                  </>
                )}
                {!searching && hits.length === 0 && (
                  <div className="px-3 py-4 text-sm text-muted-foreground">
                    {q.trim().length === 0 ? "مفيش حسابات اسمها قريب — اكتب جزء من اسم الحساب التاني" : q.trim().length === 1 ? "اكتب حرف كمان" : "مفيش حساب بالكلام ده"}
                  </div>
                )}
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
              {advice?.note && <p className={`text-xs ${advice.blocked ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{advice.note}</p>}
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div className="space-y-1.5">
                  <Label>الاسم اللي هيظهر بيه الحساب</Label>
                  {[...nameOptions, "__custom"].map((n) => (
                    <label key={n} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="merge-name" checked={(nameChoice || keptName) === n}
                        onChange={() => { setNameChoice(n); setPreview(null); }} />
                      <span>{n === "__custom" ? "اسم تاني" : n}</span>
                    </label>
                  ))}
                  {(nameChoice === "__custom") && (
                    <Input value={customName} onChange={(e) => { setCustomName(e.target.value); setPreview(null); }} placeholder="اكتب الاسم" aria-label="الاسم الجديد" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>الفرع اللي الحساب هيبقى تابع له</Label>
                  {branchOptions.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="merge-branch" checked={finalBranch === b.id}
                        onChange={() => { setBranchChoice(b.id); setPreview(null); }} />
                      <span>{b.name}</span>
                    </label>
                  ))}
                  <p className="text-xs text-muted-foreground">كل فاتورة وسند بيفضلوا في فرعهم — ده فرع الحساب بس.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { setKeepThis((v) => !v); resetChoices(); }}>
                  <ArrowLeftRight className="w-4 h-4 ml-1" /> اعكس (مين يفضل)
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { setOther(null); setPreview(null); }}>اختار حساب تاني</Button>
                {!preview && <Button size="sm" className="btn-gradient" disabled={busy || !finalName} onClick={() => run(false)}>{busy ? "بحسب…" : "معاينة قبل الدمج"}</Button>}
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
                        <tr className="border-t font-bold"><td className="px-3 py-1.5">بعد الدمج — {preview.after.name} ({typeName(preview.after.type)}{preview.after.branch_name ? ` · ${preview.after.branch_name}` : ""})</td><td className="px-3 py-1.5">{sideText("customer", preview.after.customer_balance)}</td><td className="px-3 py-1.5">{sideText("supplier", preview.after.supplier_balance)}</td></tr>
                      </tbody>
                    </PermTable>
                  </div>
                  {(preview.branches ?? []).length > 0 && (
                    <div className="rounded border">
                      <div className="px-3 py-2 text-sm font-semibold bg-muted/50">رصيد كل فرع (المستندات بتفضل في فرعها)</div>
                      <PermTable noFilter className="w-full text-sm">
                        <thead><tr className="text-xs text-muted-foreground"><th className="px-3 py-1 text-right">الفرع</th><th className="px-3 py-1 text-right">قبل (الحسابين)</th><th className="px-3 py-1 text-right">بعد الدمج</th></tr></thead>
                        <tbody>
                          {(preview.branches ?? []).map((b) => {
                            const before = candidateNet({ customer_balance: b.customer_before, supplier_balance: b.supplier_before });
                            const after = candidateNet({ customer_balance: b.customer_after, supplier_balance: b.supplier_after });
                            return (
                              <tr key={b.branch_id} className="border-t">
                                <td className="px-3 py-1.5">{b.branch_name}</td>
                                <td className={`px-3 py-1.5 tabular-nums ${netTone(before)}`}>{netText(before)}</td>
                                <td className={`px-3 py-1.5 tabular-nums ${netTone(after)}`}>{netText(after)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </PermTable>
                    </div>
                  )}
                  {preview.balanced
                    ? <p className="text-xs text-success">رصيد كل فرع بعد الدمج = رصيد الحسابين فيه قبله. مفيش فرق.</p>
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
