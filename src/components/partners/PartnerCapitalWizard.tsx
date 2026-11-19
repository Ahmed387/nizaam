import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactLookup } from "@/components/ContactLookup";
import { PermTable } from "@/components/PermTable";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { fetchMoneyBranches, pct } from "@/lib/partners";
import {
  MOVE_LABEL, amountsOf, emptyMove, fetchSetupInfo, moveProblem, openingProblem, runSetup, setupPayload,
  type MoveKind, type SetupInfo, type SetupMove, type SetupResult,
} from "@/lib/partnerCapitalSetup";

const STEPS = ["البداية", "رأس مال كل شريك", "فلوس دخلت أو طلعت (اختياري)", "راجع وسجّل"];
const sel = "w-full h-9 rounded-md border bg-background px-2 text-sm";

/**
 * «ظبّط رأس مال الشركاء» (0275): four steps, one «سجّل». Company owner only (the server refuses anybody else too).
 * Example: صافي الملك يوم 1/1 = 4,845,828.43 → محمد 3,000,000 + ناصر 1,000,000 → 845,828.43 تفضل أرباح محتجزة،
 * والربح يتقسم 75% / 25%.
 */
export function PartnerCapitalWizard({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const today = cairoTodayDay();
  const [step, setStep] = useState(0);
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [moves, setMoves] = useState<SetupMove[]>([]);
  const [preview, setPreview] = useState<SetupResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSetupInfo().then((i) => {
      setInfo(i);
      setTyped(Object.fromEntries(i.partners.map((p) => [p.id, p.opening ? String(p.opening) : ""])));
    }).catch((e) => setLoadError(e.message));
    fetchMoneyBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  const net = Number(info?.opening_equity ?? 0);
  const amounts = useMemo(() => amountsOf(mode, typed, net), [mode, typed, net]);
  const total = Object.values(amounts).reduce((s, v) => s + v, 0);
  const openErr = info ? openingProblem(amounts, net) : null;
  const moveErrs = moves.map((m) => moveProblem(m, info?.start_day ?? "", today));
  const firstMoveErr = moveErrs.findIndex(Boolean);

  const payload = (apply: boolean) => setupPayload(info?.partners ?? [], amounts, moves, apply);
  const goReview = async () => {
    setBusy(true);
    try { setPreview(await runSetup(payload(false))); setStep(3); } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await runSetup(payload(true));
      toast.success(r.books_balanced === false ? "اتسجل — بس الدفاتر مش متزنة، راجع صحة النظام" : "اتسجل رأس مال الشركاء — والربح هيتقسم بالنسب الجديدة");
      onDone?.(); onClose();
    } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  };
  const setMove = (key: string, patch: Partial<SetupMove>) => setMoves((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  const nameOf = (id: string) => info?.partners.find((p) => p.id === id)?.name ?? "";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[92vh] overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>ظبّط رأس مال الشركاء</DialogTitle>
          <DialogDescription>خطوة {step + 1} من 4 — {STEPS[step]}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-wrap gap-1 text-xs" aria-label="الخطوات">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-full px-2 py-1 ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{i + 1}. {s}</li>
          ))}
        </ol>

        {loadError && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{loadError}</div>}
        {!info && !loadError && <div className="text-sm text-muted-foreground">جاري التحميل…</div>}

        {info && step === 0 && (
          <div className="space-y-3 text-sm">
            {info.distributed && (
              <div className="rounded-lg bg-destructive/10 p-3 text-destructive">فيه أرباح اتوزعت على الشركاء — الغي التوزيع الأول قبل ما تغيّر رأس المال.</div>
            )}
            {!info.start_day ? (
              <div className="rounded-lg bg-warning/10 p-3">مفيش أرصدة افتتاحية في الدفاتر لسه — سجّل الأرصدة الافتتاحية الأول.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/40 p-3"><div className="text-muted-foreground">أول يوم في الدفاتر</div><div className="mt-1 font-bold" data-testid="start-day">{info.start_day}</div></div>
                  <div className="rounded-lg bg-primary/10 p-3"><div className="text-muted-foreground">صافي الملك يومها</div><div className="mt-1 font-extrabold text-primary" data-testid="net-worth">{formatEGP(net)}</div></div>
                </div>
                <p className="text-muted-foreground leading-6">
                  صافي الملك = البضاعة + اللي في الخزن + اللي لينا عند الناس − اللي علينا للناس يوم البداية. في الخطوة الجاية تقول قد إيه منه رأس مال كل شريك،
                  والباقي يفضل «أرباح محتجزة». الربح بعد كده بيتقسم على حسب رأس مال كل واحد.
                </p>
                <PermTable className="w-full text-sm" noFilter>
                  <thead className="bg-muted/40"><tr><th className="p-2 text-right">الشريك</th><th className="p-2">رأس ماله دلوقتي</th><th className="p-2">نسبته من الربح</th></tr></thead>
                  <tbody>{info.partners.map((p) => (
                    <tr key={p.id} className="border-t"><td className="p-2">{p.name}</td><td className="p-2 text-center tabular-nums">{formatEGP(p.capital)}</td><td className="p-2 text-center">{pct(p.capital_share)}</td></tr>
                  ))}</tbody>
                </PermTable>
              </>
            )}
          </div>
        )}

        {info && step === 1 && (
          <div className="space-y-3 text-sm">
            <div className="flex gap-4" role="radiogroup" aria-label="طريقة الكتابة">
              <label className="flex items-center gap-1"><input type="radio" checked={mode === "amount"} onChange={() => setMode("amount")} /> بالمبلغ</label>
              <label className="flex items-center gap-1"><input type="radio" checked={mode === "percent"} onChange={() => setMode("percent")} /> بالنسبة من صافي الملك</label>
            </div>
            {info.partners.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_12rem_9rem] items-center gap-2">
                <Label htmlFor={`cap-${p.id}`}>{p.name}</Label>
                <Input id={`cap-${p.id}`} inputMode="decimal" value={typed[p.id] ?? ""} placeholder={mode === "percent" ? "%" : "0"}
                  onChange={(e) => setTyped((t) => ({ ...t, [p.id]: e.target.value }))} />
                <span className="text-xs text-muted-foreground tabular-nums">{mode === "percent" ? formatEGP(amounts[p.id] ?? 0) : total > 0 ? `${Math.round(((amounts[p.id] ?? 0) / total) * 10000) / 100}% من الربح` : ""}</span>
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/40 p-2"><div className="text-muted-foreground text-xs">صافي الملك</div><div className="font-bold">{formatEGP(net)}</div></div>
              <div className="rounded-lg bg-primary/10 p-2"><div className="text-muted-foreground text-xs">رأس مال الشركاء</div><div className="font-bold" data-testid="open-total">{formatEGP(total)}</div></div>
              <div className="rounded-lg bg-success/10 p-2"><div className="text-muted-foreground text-xs">يفضل أرباح محتجزة</div><div className="font-bold" data-testid="retained">{formatEGP(net - total)}</div></div>
            </div>
            {openErr && <div className="rounded-lg bg-destructive/10 p-2 text-destructive" role="alert">{openErr}</div>}
          </div>
        )}

        {info && step === 2 && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground leading-6">
              لو شريك حط فلوس كاش في درج فرع، أو دفع لمورد من جيبه، أو سحب من رأس ماله بعد يوم البداية — سجّلها هنا كل واحدة في يومها.
              «دفع لمورد من جيبه» = مساهمة للشريك + سند صرف للمورد في نفس اليوم (الدرج ما يتغيرش، واللي علينا للمورد يقل).
              الخطوة دي بالكاش بس — لأي وعاء تاني استخدم «مساهمة» / «سحب» في كارت الشريك.
            </p>
            {moves.map((m, i) => (
              <div key={m.key} className="rounded-lg border p-3 space-y-2" data-testid="move-row">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div><Label>الحركة</Label>
                    <select aria-label="نوع الحركة" className={sel} value={m.kind} onChange={(e) => setMove(m.key, { kind: e.target.value as MoveKind })}>
                      {(Object.keys(MOVE_LABEL) as MoveKind[]).map((k) => <option key={k} value={k}>{MOVE_LABEL[k]}</option>)}
                    </select></div>
                  <div><Label>الشريك</Label>
                    <select aria-label="الشريك" className={sel} value={m.partner_id} onChange={(e) => setMove(m.key, { partner_id: e.target.value })}>
                      <option value="">— اختار —</option>
                      {info.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select></div>
                  <div><Label>الفرع</Label>
                    <select aria-label="الفرع" className={sel} value={m.branch_id} onChange={(e) => setMove(m.key, { branch_id: e.target.value })}>
                      <option value="">— اختار —</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select></div>
                  <div><Label>اليوم</Label><Input aria-label="اليوم" type="date" value={m.date} min={info.start_day ?? undefined} max={today} onChange={(e) => setMove(m.key, { date: e.target.value })} /></div>
                  <div><Label>المبلغ</Label><Input aria-label="المبلغ" inputMode="decimal" value={m.amount} onChange={(e) => setMove(m.key, { amount: e.target.value })} /></div>
                  {m.kind === "supplier" && (
                    <div><Label>المورد</Label>
                      <ContactLookup branchId={m.branch_id || null} kind="supplier" value={m.supplier_id} onChange={(id) => setMove(m.key, { supplier_id: id })} /></div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input aria-label="ملاحظات" placeholder="ملاحظات (اختياري)" value={m.notes} onChange={(e) => setMove(m.key, { notes: e.target.value })} />
                  <Button type="button" size="icon" variant="ghost" aria-label="شيل الحركة" onClick={() => setMoves((ms) => ms.filter((x) => x.key !== m.key))}><Trash2 className="w-4 h-4" /></Button>
                </div>
                {moveErrs[i] && <div className="text-xs text-destructive">{moveErrs[i]}</div>}
              </div>
            ))}
            <Button type="button" variant="outline" className="gap-1" onClick={() => setMoves((ms) => [...ms, emptyMove(today)])}><Plus className="w-4 h-4" /> ضيف حركة</Button>
          </div>
        )}

        {info && step === 3 && preview && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/40 p-2"><div className="text-muted-foreground text-xs">صافي الملك {preview.start_day}</div><div className="font-bold">{formatEGP(preview.opening_equity)}</div></div>
              <div className="rounded-lg bg-primary/10 p-2"><div className="text-muted-foreground text-xs">رأس المال الافتتاحي</div><div className="font-bold">{formatEGP(preview.opening_total)}</div></div>
              <div className="rounded-lg bg-success/10 p-2"><div className="text-muted-foreground text-xs">أرباح محتجزة</div><div className="font-bold">{formatEGP(preview.kept_as_retained)}</div></div>
            </div>
            <PermTable className="w-full text-sm" noFilter>
              <thead className="bg-muted/40"><tr><th className="p-2 text-right">الشريك</th><th className="p-2">رأس المال قبل</th><th className="p-2">بعد</th><th className="p-2">نسبة الربح قبل</th><th className="p-2">بعد</th></tr></thead>
              <tbody>{preview.partners.map((p) => (
                <tr key={p.id} className="border-t" data-testid="review-row">
                  <td className="p-2">{p.name}</td>
                  <td className="p-2 text-center tabular-nums">{formatEGP(p.capital_before)}</td>
                  <td className="p-2 text-center tabular-nums font-bold">{formatEGP(p.capital_after)}</td>
                  <td className="p-2 text-center">{pct(p.share_before)}</td>
                  <td className="p-2 text-center font-bold">{pct(p.share_after)}</td>
                </tr>
              ))}</tbody>
            </PermTable>
            {moves.length > 0 && (
              <ul className="list-disc pr-5 text-muted-foreground">
                {moves.map((m) => <li key={m.key}>{m.date} — {nameOf(m.partner_id)}: {MOVE_LABEL[m.kind]} {formatEGP(Number(m.amount))}</li>)}
              </ul>
            )}
            <p className="text-muted-foreground">الدفاتر: رأس المال الافتتاحي بيتنقل من «رصيد افتتاحي» لـ«رأس المال» يوم البداية — الخزن ما بتتحركش. لو ظبّطته تاني القديم بيتلغي ويفضل في السجل.</p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))} disabled={busy}>{step === 0 ? "إلغاء" : "رجوع"}</Button>
          {step === 0 && <Button onClick={() => setStep(1)} disabled={!info?.start_day || info.distributed}>التالي</Button>}
          {step === 1 && <Button onClick={() => setStep(2)} disabled={!!openErr}>التالي</Button>}
          {step === 2 && <Button onClick={goReview} disabled={busy || firstMoveErr >= 0}>{busy ? "بيحسب…" : "راجع"}</Button>}
          {step === 3 && <Button onClick={apply} disabled={busy}>{busy ? "بيسجّل…" : "سجّل"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
