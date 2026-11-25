import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import {
  cancelGapDecision, fetchGapInfo, gapItems, gapLeft, lineText, settleGap,
  type GapForm, type GapInfo, type GapItem, type GapLine,
} from "@/lib/capitalGap";
import { ReasonDialog } from "./ReasonDialog";

const EMPTY: GapForm = { loss: "", drawings: [] };

/**
 * «الفرق بين رأس المال والدفاتر» (0283, owner 2026-11-25): shows the partners' «موجود بالفعل» capital not decided yet vs
 * what the books say the company owned on day one, and asks where the difference went — assets (on «الأصول الثابتة»),
 * a loss, a partner's drawings (his % stays or goes down, chosen each time) or «سيبه زي ما هو». «راجع» shows the entry in
 * words before «سجّل». Every decision can be cancelled (its entry is reversed on its own day).
 */
export function CapitalGapCard({ reloadKey, onDone }: { reloadKey: string; onDone: () => void }) {
  const { isOwner } = useAuth();
  const [info, setInfo] = useState<GapInfo | null>(null);
  const [form, setForm] = useState<GapForm>(EMPTY);
  const [preview, setPreview] = useState<{ items: GapItem[]; lines: GapLine[]; leave: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = async () => { try { setInfo(await fetchGapInfo()); } catch (e: any) { toast.error(e.message); } };
  useEffect(() => { load(); setForm(EMPTY); setPreview(null); }, [reloadKey]);
  if (!info) return null;

  const gap = Number(info.gap);
  const left = gapLeft(gap, form);
  const pending = Number(info.capital_new) !== 0;
  const active = info.decisions.filter((d) => d.status === "active");
  const nameOf = (id: string) => info.partners.find((p) => p.id === id)?.name ?? "";

  const review = async (items: GapItem[]) => {
    setBusy(true);
    try {
      const r = await settleGap(items, false);
      setPreview({ items, lines: r.lines ?? [], leave: r.leave });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await settleGap(preview.items, true);
      toast.success(preview.leave ? "اتسجل إنك سايبه زي ما هو" : "اتسجل — رأس مال كل شريك بقى في الدفاتر");
      setPreview(null); setForm(EMPTY); await load(); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const cancel = async (reason: string) => {
    if (!cancelling) return;
    try { await cancelGapDecision(cancelling, reason); toast.success("اتلغى القرار والقيد اتعكس في يومه"); setCancelling(null); await load(); onDone(); }
    catch (e: any) { toast.error(e.message); }
  };
  const setDrawing = (i: number, p: Partial<GapForm["drawings"][number]>) =>
    setForm({ ...form, drawings: form.drawings.map((d, j) => (j === i ? { ...d, ...p } : d)) });

  return (
    <Card data-testid="capital-gap">
      <CardHeader>
        <CardTitle>الفرق بين رأس المال والدفاتر</CardTitle>
        <p className="text-xs text-muted-foreground">رأس المال «موجود بالفعل» قصاد صافي اللي الشركة كانت تملكه في الدفاتر يوم {info.start_day}.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-muted/40 p-3"><div className="text-xs text-muted-foreground">رأس مال «موجود بالفعل» لسه متقررش</div><div className="font-extrabold tabular-nums">{formatEGP(info.capital_new)}</div></div>
          <div className="rounded-lg bg-muted/40 p-3"><div className="text-xs text-muted-foreground">صافي الملك في الدفاتر</div><div className="font-extrabold tabular-nums">{formatEGP(info.opening_left)}</div></div>
          <div className={`rounded-lg p-3 ${gap > 0 ? "bg-warning/10" : gap < 0 ? "bg-primary/10" : "bg-success/10"}`}>
            <div className="text-xs text-muted-foreground">{gap > 0 ? "رأس المال أكبر بـ" : gap < 0 ? "رأس المال أقل بـ" : "الفرق"}</div>
            <div className="font-extrabold tabular-nums" data-testid="gap-amount">{formatEGP(Math.abs(gap))}</div>
          </div>
        </div>

        {!pending ? (
          <div className="text-sm text-muted-foreground">مفيش رأس مال جديد محتاج قرار.{info.capital_new === 0 && active.length === 0 && " سجّل «موجود بالفعل» لكل شريك الأول."}</div>
        ) : !isOwner ? (
          <div className="text-sm text-muted-foreground">القرار ده لصاحب الشركة بس.</div>
        ) : gap > 0 ? (
          <div className="space-y-3">
            <div className="font-bold">الفرق ده راح فين؟ (تقدر تقسمه على أكتر من اختيار)</div>
            <div className="rounded-lg border p-3 text-sm">
              <b>1) أصول مش متسجلة</b> (معرض، عربية، أجهزة): ضيف كل واحد في{" "}
              <Link to="/admin/accounting/fixed-assets" className="text-primary underline">الأصول الثابتة</Link> واختار «كان عندنا قبل السيستم» — الفرق هنا هيقل لوحده.
            </div>
            <div className="rounded-lg border p-3 grid gap-2 max-w-md">
              <Label htmlFor="gap-loss"><b>2) خسارة قبل السيستم</b></Label>
              <Input id="gap-loss" type="number" min={0} value={form.loss} onChange={(e) => setForm({ ...form, loss: e.target.value })} placeholder="0" />
              <p className="text-xs text-muted-foreground">بتتسجل «خسائر قبل السيستم» تحت الأرباح المحتجزة — ربح 2026 مش بيتأثر.</p>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm">3) سحبها شريك قبل السيستم</b>
                <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setForm({ ...form, drawings: [...form.drawings, { partner_id: "", amount: "", keep_share: null }] })}>
                  <Plus className="w-4 h-4" /> ضيف سحب
                </Button>
              </div>
              {form.drawings.map((d, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[1fr_10rem_auto_auto] items-end rounded-md bg-muted/30 p-2">
                  <div>
                    <Label htmlFor={`gap-dp-${i}`} className="text-xs">الشريك</Label>
                    <select id={`gap-dp-${i}`} className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={d.partner_id} onChange={(e) => setDrawing(i, { partner_id: e.target.value })}>
                      <option value="">اختار…</option>
                      {info.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`gap-da-${i}`} className="text-xs">المبلغ</Label>
                    <Input id={`gap-da-${i}`} type="number" min={0} value={d.amount} onChange={(e) => setDrawing(i, { amount: e.target.value })} />
                  </div>
                  <div role="radiogroup" aria-label={`نسبة ${nameOf(d.partner_id) || "الشريك"}`} className="flex gap-1">
                    {([[true, "نسبته تفضل زي ما هي"], [false, "نسبته تقل"]] as const).map(([v, l]) => (
                      <button key={String(v)} type="button" role="radio" aria-checked={d.keep_share === v} onClick={() => setDrawing(i, { keep_share: v })}
                        className={`rounded-full border px-3 min-h-[36px] text-xs font-bold ${d.keep_share === v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}>{l}</button>
                    ))}
                  </div>
                  <Button type="button" size="icon" variant="ghost" aria-label="شيل السحب" onClick={() => setForm({ ...form, drawings: form.drawings.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">«نسبته تقل» = رأس ماله ونسبته من الربح بيتحسبوا بعد السحب من أول شهر. «تفضل زي ما هي» = بيتسجل مسحوبات بس.</p>
            </div>
            <div className={`text-sm font-bold ${Math.abs(left) < 0.05 ? "text-success" : "text-warning"}`} data-testid="gap-left">
              {Math.abs(left) < 0.05 ? "✓ الفرق كله اتوزع" : `فاضل ${formatEGP(left)} من الفرق`}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => review(gapItems(form))} disabled={busy || Math.abs(left) >= 0.05 || form.drawings.some((d) => d.keep_share === null && Number(d.amount) > 0)}>راجع</Button>
              <Button variant="outline" onClick={() => review([{ kind: "leave" }])} disabled={busy}>4) سيبه زي ما هو</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {gap < 0
              ? <p>رأس المال أقل من الدفاتر بـ <b>{formatEGP(-gap)}</b> — الباقي هيتسجل <b>أرباح محتجزة</b> (ربح قديم لسه متوزعش، وتقدر توزعه بعدين بالنسب).</p>
              : <p>رأس المال قد الدفاتر بالظبط — هيتسجل رأس مال كل شريك في الدفاتر.</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => review([])} disabled={busy}>راجع</Button>
              <Button variant="outline" onClick={() => review([{ kind: "leave" }])} disabled={busy}>سيبه زي ما هو</Button>
            </div>
          </div>
        )}

        {preview && (
          <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3 space-y-2" data-testid="gap-preview">
            <div className="font-bold">قبل ما تسجّل — اللي هيحصل:</div>
            {preview.leave ? (
              <p className="text-sm">مفيش أي قيد. الميزانية تفضل فيها «رصيد افتتاحي» من غير ما يتقسم على الشركاء، والنسب شغالة على «موجود بالفعل» زي ما هي.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {preview.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3"><span>{lineText(l)}</span><b className="tabular-nums">{formatEGP(l.debit || l.credit)}</b></li>
                ))}
                <li className="text-xs text-muted-foreground pt-1">قيد واحد يوم {info.start_day}. الخزن والمخزون وحسابات العملاء والموردين وربح 2026 مش هيتغيروا.</li>
              </ul>
            )}
            <div className="flex gap-2">
              <Button onClick={apply} disabled={busy}>سجّل</Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>رجوع</Button>
            </div>
          </div>
        )}

        {info.decisions.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-bold">القرارات اللي اتاخدت</div>
            {info.decisions.map((d) => (
              <div key={d.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm ${d.status === "cancelled" ? "opacity-50" : ""}`}>
                <span>
                  {d.created_at.slice(0, 10)} — {d.kind === "leave" ? "سيبه زي ما هو" : "رأس المال اتسجل في الدفاتر"} ({formatEGP(d.capital_total)})
                  {d.items.filter((x) => x.kind === "loss").map((x, i) => <span key={`l${i}`}> • خسارة {formatEGP(x.amount)}</span>)}
                  {d.items.filter((x) => x.kind === "drawing").map((x, i) => <span key={`d${i}`}> • سحب {nameOf(x.partner_id)} {formatEGP(x.amount)} ({x.keep_share ? "نسبته زي ما هي" : "نسبته قلت"})</span>)}
                </span>
                {d.status === "active"
                  ? isOwner && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelling(d.id)}>إلغاء</Button>
                  : <Badge variant="destructive">ملغي{d.cancel_reason ? ` — ${d.cancel_reason}` : ""}</Badge>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {cancelling && <ReasonDialog title="إلغاء القرار" description="القيد هيتعكس في نفس يومه، والسحوبات اللي اتسجلت معاه هتتلغي، والفرق يرجع يستنى قرار." onConfirm={cancel} onClose={() => setCancelling(null)} />}
    </Card>
  );
}
