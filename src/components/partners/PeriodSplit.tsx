import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PermTable } from "@/components/PermTable";
import { PermCard } from "@/contexts/PermCustomize";
import { confirmAlert } from "@/components/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { distributeManual, fetchDistributions, fetchSplitPreview, lockDistributedPeriod, pct, reverseDistribution, type DistributionRow } from "@/lib/partners";
import {
  addPartner, finalLines, setAmount, setPct, splitProblem, splitTotals, spreadRest, suggestedRows,
  type RestChoice, type SplitPreview, type SplitRow,
} from "@/lib/periodSplit";
import { ReasonDialog } from "./ReasonDialog";

const pctIn = (f: number) => String(Math.round(f * 10000) / 100);

/**
 * Step 2 «وزّع الباقي» (0289, owner 2026-11-26): the period of step 1, its profit after the partners' salaries, what was
 * already distributed and what is available; the partners with capital in it with the suggested split (capital month by
 * month); the owner types a % or an amount for each (the other one fills itself, the others never move by themselves);
 * a remainder is HIS choice right here — keep it in the company or spread it by his ratios — each option saying where the
 * money goes. Below: every distribution with each partner's share and «اعكس التوزيع».
 */
export function PeriodSplit({ from, to, reloadKey, onDone }: { from: string; to: string; reloadKey?: unknown; onDone?: () => void }) {
  const { isOwner, isAdmin } = useAuth();
  const canWrite = isOwner || isAdmin;
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [rest, setRest] = useState<RestChoice | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const [list, setList] = useState<DistributionRow[]>([]);
  const [reversing, setReversing] = useState<DistributionRow | null>(null);
  const avail = Number(preview?.available ?? 0);

  const loadPreview = async () => {
    if (!from || !to || from > to) { setPreview(null); return; }
    try {
      const p = await fetchSplitPreview(from, to);
      setPreview(p); setRows(suggestedRows(p)); setRest(null);
    } catch (e: any) { toast.error(e.message); setPreview(null); }
  };
  const loadList = () => fetchDistributions().then(setList).catch(() => {});
  useEffect(() => { loadPreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, reloadKey]);
  useEffect(() => { loadList(); }, [reloadKey]);

  const t = splitTotals(rows, avail);
  const problem = splitProblem(preview, rows, rest);
  const spread = useMemo(() => (t.under ? spreadRest(rows, avail) : rows), [rows, avail, t.under]);
  const lines = finalLines(rows, avail, rest ?? "keep");
  const others = (preview?.partners ?? []).filter((p) => !rows.some((r) => r.partner_id === p.partner_id));
  const amountOf = (id: string) => lines.find((l) => l.partner_id === id)?.amount ?? 0;

  const go = async () => {
    if (!preview || problem) return;
    const choice: RestChoice = t.under ? (rest ?? "keep") : "keep";
    const sent = lines.reduce((s, l) => s + l.amount, 0);
    const ok = await confirmAlert({
      title: `هنوزّع ${formatEGP(sent)} على ${lines.length} شريك`,
      description: [
        ...lines.map((l) => `${rows.find((r) => r.partner_id === l.partner_id)?.name}: ${formatEGP(l.amount)}`),
        choice === "keep" && t.under ? `الباقي ${formatEGP(avail - sent)} يفضل في الشركة (أرباح محتجزة).` : "",
        "المبالغ بتروح كارت «صافي الربح» بتاع كل شريك، والسلف المفتوحة بتتخصم من نصيبه الأول.",
      ].filter(Boolean).join("\n"),
      confirmLabel: "أيوه، وزّع", cancelLabel: "لأ، استنى", tone: "warning",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await distributeManual(from, to, lines, choice, notes);
      toast.success(`اتوزع ${formatEGP(r.total_amount)}${r.kept > 0 ? ` — ${formatEGP(r.kept)} فضلوا في الشركة` : ""}${r.advances_settled > 0 ? ` — اتخصم ${formatEGP(r.advances_settled)} سلف` : ""}`);
      setNotes("");
      if (isOwner && to < cairoTodayDay()) {
        const lock = await confirmAlert({
          title: "تقفل الفترة دي؟",
          description: `من ${from} لحد ${to}: بعد القفل محدش يقدر يضيف أو يعدّل أو يلغي أي مستند أو سند في الأيام دي. الأرقام والتقارير زي ما هي.`,
          confirmLabel: "أيوه، اقفلها", cancelLabel: "لأ، سيبها مفتوحة", tone: "warning",
        });
        if (lock) {
          try { await lockDistributedPeriod(from, to, notes); toast.success(`الفترة ${from} ← ${to} اتقفلت`); } catch (e: any) { toast.error(e.message); }
        }
      }
      await loadPreview(); loadList(); onDone?.();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="period-split">
      <div className="text-sm">الفترة: <b className="tabular-nums">{from} ← {to}</b> <span className="text-xs text-muted-foreground">(نفس فترة خطوة 1)</span></div>
      {preview && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <PermCard label="صافي ربح الفترة بعد مرتبات الشركاء"><div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">صافي ربح الفترة (بعد مرتبات الشركاء)</div>
              <div className={`text-lg font-extrabold tabular-nums ${preview.net_profit < 0 ? "text-destructive" : ""}`}>{formatEGP(preview.net_profit)}</div>
            </div></PermCard>
            <PermCard label="اتوزع قبل كده من الفترة"><div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">اتوزع قبل كده من الفترة دي</div>
              <div className="text-lg font-extrabold tabular-nums">{formatEGP(preview.already)}</div>
            </div></PermCard>
            <PermCard label="المتاح للتوزيع دلوقتي"><div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <div className="text-xs text-muted-foreground">المتاح للتوزيع دلوقتي</div>
              <div className="text-lg font-extrabold tabular-nums text-primary" data-testid="split-available">{formatEGP(avail)}</div>
            </div></PermCard>
          </div>
          {preview.pay_missing && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
              فيه شريك ليه مرتب أو نسبة في الفترة دي ولسه متسجلتش — سجّلها من خطوة 1 فوق الأول، بتتخصم من الربح قبل التوزيع.
            </div>
          )}
          {avail <= 0 ? (
            <div className="text-sm text-muted-foreground">مفيش ربح متاح للتوزيع في الفترة دي.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <PermTable className="w-full text-sm" permTable="period_split" noFilter>
                  <thead className="bg-muted/40">
                    <tr className="text-right">
                      <th className="p-2">الشريك</th><th className="p-2">رأس ماله (أول الفترة ← آخرها)</th><th className="p-2">المقترح حسب رأس المال</th>
                      <th className="p-2">النسبة %</th><th className="p-2">المبلغ</th><th className="p-2">ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.partner_id} className="border-t" data-testid={`split-row-${r.partner_id}`}>
                        <td className="p-2 font-semibold">{r.name}</td>
                        <td className="p-2 tabular-nums text-xs whitespace-nowrap">{formatEGP(r.capital_start)}<br />← {formatEGP(r.capital_end)}</td>
                        <td className="p-2 tabular-nums text-xs whitespace-nowrap"><b>{pct(r.suggested)}</b><br />{formatEGP(Math.round(r.suggested * avail * 100) / 100)}</td>
                        <td className="p-2 w-28">
                          <Input type="number" min={0} step="0.01" aria-label={`نسبة ${r.name}`} disabled={!canWrite} value={pctIn(r.pct)}
                            onChange={(e) => setRows(setPct(rows, r.partner_id, Number(e.target.value || 0) / 100, avail))} />
                        </td>
                        <td className="p-2 w-40">
                          <Input type="number" min={0} aria-label={`مبلغ ${r.name}`} disabled={!canWrite} value={String(r.amount)}
                            onChange={(e) => setRows(setAmount(rows, r.partner_id, Number(e.target.value || 0), avail))} />
                        </td>
                        <td className="p-2 text-xs text-warning">{r.advances > 0 ? `عليه سلفة ${formatEGP(r.advances)} — بتتخصم من نصيبه الأول` : ""}</td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/30 font-extrabold" data-testid="split-total">
                      <td className="p-2" colSpan={3}>الإجمالي</td>
                      <td className="p-2 tabular-nums">{pct(t.pct)}</td>
                      <td className={`p-2 tabular-nums ${t.over ? "text-destructive" : ""}`}>{formatEGP(t.total)}</td>
                      <td className="p-2 text-xs" data-testid="split-diff">
                        {t.over ? <span className="text-destructive">زيادة {formatEGP(-t.rest)} عن المتاح</span>
                          : t.under ? <span>فاضل {formatEGP(t.rest)} من المتاح</span> : <span className="text-success">= المتاح بالظبط ✓</span>}
                      </td>
                    </tr>
                  </tbody>
                </PermTable>
              </div>
              {canWrite && (
                <div className="flex flex-wrap items-center gap-2">
                  {others.length > 0 && (
                    <>
                      <select aria-label="ضيف شريك" className="h-9 rounded-md border bg-background px-2 text-sm" value={adding} onChange={(e) => setAdding(e.target.value)}>
                        <option value="">اختار شريك ملوش رأس مال في الفترة…</option>
                        {others.map((o) => <option key={o.partner_id} value={o.partner_id}>{o.name}</option>)}
                      </select>
                      <Button size="sm" variant="outline" className="gap-1" disabled={!adding} onClick={() => {
                        const p = others.find((o) => o.partner_id === adding); if (p) setRows(addPartner(rows, p)); setAdding("");
                      }}><UserPlus className="w-4 h-4" /> ضيف شريك</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => { setRows(suggestedRows(preview)); setRest(null); }}>
                    <RotateCcw className="w-4 h-4" /> رجّع المقترح
                  </Button>
                </div>
              )}

              {t.under && t.total > 0 && (
                <div className="rounded-lg border p-3 space-y-2" data-testid="rest-choice">
                  <div className="font-semibold text-sm">فاضل {formatEGP(t.rest)} من المتاح — تعمل فيهم إيه؟</div>
                  <label className="flex gap-2 items-start cursor-pointer">
                    <input type="radio" name="rest" className="mt-1" checked={rest === "keep"} onChange={() => setRest("keep")} />
                    <span className="text-sm"><b>(أ) سيب الباقي في الشركة</b>
                      <span className="block text-xs text-muted-foreground">
                        يتوزع {formatEGP(t.total)} بس. الـ {formatEGP(t.rest)} تفضل «أرباح محتجزة» في الدفاتر — ملك الشركة، مش في كارت أي شريك.
                        تقدر توزعهم بعدين من نفس الفترة (هتلاقيهم في «المتاح»). لو قفلت الفترة بعد التوزيع يفضلوا محتجزين للشركة.
                      </span></span>
                  </label>
                  <label className="flex gap-2 items-start cursor-pointer">
                    <input type="radio" name="rest" className="mt-1" checked={rest === "spread"} onChange={() => setRest("spread")} />
                    <span className="text-sm"><b>(ب) وزّع الباقي على الشركا</b>
                      <span className="block text-xs text-muted-foreground">
                        الـ {formatEGP(t.rest)} تتقسم عليهم بنفس النسب اللي كتبتها بينهم، والمتاح كله ({formatEGP(avail)}) يروح كروت «صافي الربح»:{" "}
                        {spread.filter((x) => x.amount > 0).map((x) => `${x.name} ${formatEGP(x.amount)}`).join(" • ")}. مفيش حاجة تفضل محتجزة.
                      </span></span>
                  </label>
                </div>
              )}

              {lines.length > 0 && !t.over && (
                <div className="rounded-lg bg-muted p-3 text-sm space-y-1" data-testid="split-final">
                  <div className="font-semibold">هيروح كارت «صافي الربح» بتاع كل واحد:</div>
                  {rows.filter((r) => amountOf(r.partner_id) > 0).map((r) => (
                    <div key={r.partner_id} className="tabular-nums">
                      {r.name}: <b>{formatEGP(amountOf(r.partner_id))}</b>
                      {r.advances > 0 && <span className="text-xs text-muted-foreground"> — منها {formatEGP(Math.min(r.advances, amountOf(r.partner_id)))} سداد سلفته، يوصله {formatEGP(Math.max(amountOf(r.partner_id) - r.advances, 0))}</span>}
                    </div>
                  ))}
                  {rest === "keep" && t.under && <div className="text-xs text-muted-foreground">والباقي {formatEGP(t.rest)} في الشركة.</div>}
                </div>
              )}

              {canWrite && (
                <>
                  <div><Label htmlFor="split-notes">ملاحظات على التوزيع</Label>
                    <Textarea id="split-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={`توزيع ${from} ← ${to}`} /></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={go} disabled={busy || !!problem} data-testid="split-go">وزّع</Button>
                    {problem && <span className="text-xs text-muted-foreground" data-testid="split-problem">{problem}</span>}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      <Card>
        <CardHeader><CardTitle>توزيعات الفترات</CardTitle></CardHeader>
        <CardContent>
          {list.length === 0 ? <div className="text-sm text-muted-foreground">مفيش توزيعات لسه.</div> : (
            <div className="overflow-x-auto">
              <PermTable className="w-full text-sm" permTable="distributions" noFilter>
                <thead className="bg-muted/40">
                  <tr className="text-right"><th className="p-2">الفترة</th><th className="p-2">اتوزع يوم</th><th className="p-2">الإجمالي</th>
                    <th className="p-2">نصيب كل واحد</th><th className="p-2">الباقي</th><th className="p-2">الحالة</th>{canWrite && <th className="p-2">إجراءات</th>}</tr>
                </thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.id} className={`border-t align-top ${d.status === "reversed" ? "opacity-60" : ""}`} data-testid={`dist-${d.id}`}>
                      <td className="p-2 tabular-nums whitespace-nowrap">{d.from ?? "—"} ← {d.to ?? "—"}</td>
                      <td className="p-2 tabular-nums">{d.day}{d.by ? <div className="text-[11px] text-muted-foreground">{d.by}</div> : null}</td>
                      <td className="p-2 tabular-nums font-bold">{formatEGP(d.total)}<div className="text-[11px] font-normal text-muted-foreground">{d.mode === "manual" ? "نسب يدوية" : "حسب رأس المال"}</div></td>
                      <td className="p-2 text-xs space-y-0.5">
                        {d.lines.map((l) => (
                          <div key={l.partner_id} className="tabular-nums">{l.name}: <b>{formatEGP(l.amount)}</b> ({Number(l.pct).toFixed(2)}%{l.suggested != null && d.mode === "manual" ? ` — المقترح ${Number(l.suggested).toFixed(2)}%` : ""})</div>
                        ))}
                      </td>
                      <td className="p-2 text-xs">{d.available != null && d.available - d.total > 0.01 ? `${formatEGP(d.available - d.total)} في الشركة` : "—"}</td>
                      <td className="p-2 text-xs">{d.status === "reversed" ? "اتعكس" : "متوزع"}</td>
                      {canWrite && <td className="p-2">{d.status !== "reversed" && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setReversing(d)}>اعكس التوزيع</Button>
                      )}</td>}
                    </tr>
                  ))}
                </tbody>
              </PermTable>
            </div>
          )}
        </CardContent>
      </Card>

      {reversing && (
        <ReasonDialog title={`اعكس توزيع ${reversing.from} ← ${reversing.to} (${formatEGP(reversing.total)})`}
          description="نصيب كل شريك بيتشال من كارته، والقيد بيتعكس، والسلف اللي اتسددت منه بترجع مفتوحة. بعدها تقدر تعدّل رأس المال وتوزّع من جديد."
          confirm="اعكس التوزيع" onClose={() => setReversing(null)}
          onConfirm={async (reason) => {
            try { await reverseDistribution(reversing.id, reason); toast.success("اتعكس التوزيع"); setReversing(null); await loadPreview(); loadList(); onDone?.(); }
            catch (e: any) { toast.error(e.message); }
          }} />
      )}
    </div>
  );
}
