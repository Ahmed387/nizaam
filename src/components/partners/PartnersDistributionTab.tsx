import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermTable } from "@/components/PermTable";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import {
  cancelPeriodShares, payExample, payRuleText, pct, postPeriodShares, previewPeriodShares, ruleForMonth,
  type PartnerCards, type SharesPreview,
} from "@/lib/partners";
import { PeriodSplit } from "./PeriodSplit";
import { PartnerPayDialog } from "./PartnerPayDialog";
import { PayExampleTable } from "./PayExampleTable";
import { ReasonDialog } from "./ReasonDialog";
import type { usePartnersData } from "./usePartnersData";

type Data = ReturnType<typeof usePartnersData>;

function lastMonth(): { from: string; to: string } {
  const [y, m] = cairoTodayDay().split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * «توزيع الأرباح» tab (owner 2026-11-25): every month the profit goes 1) the partners' fixed salaries, 2) their %,
 * 3) the rest by capital. Here: each partner's pay (from a month on), a live example, step 1 «سجّل مرتبات الشركاء» of a
 * period (Dr 5200 / Cr 3850, month by month) and step 2 «وزّع الباقي» (the distribution screen, by capital).
 */
export function PartnersDistributionTab({ data }: { data: Data }) {
  const { isOwner, isAdmin } = useAuth();
  const canWrite = isOwner || isAdmin;
  const { active, shares, rules, load } = data;
  const thisMonth = cairoTodayDay().slice(0, 7);
  const [editing, setEditing] = useState<PartnerCards | null>(null);
  const [profit, setProfit] = useState("300000");
  const example = useMemo(() => payExample(Number(profit || 0), active.map((r) => ({
    id: r.partner.id, name: r.partner.name, share: shares[r.partner.id]?.share ?? 0, rule: ruleForMonth(rules, r.partner.id, thisMonth),
  }))), [profit, active, shares, rules, thisMonth]);

  // step 1
  const init = lastMonth();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SharesPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  // step 2 reads the same period and reloads after step 1 changes it (0289)
  const [stepKey, setStepKey] = useState(0);
  const overrides = () => Object.fromEntries(Object.entries(typed).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
  const loadPreview = async () => {
    if (!from || !to || from > to) return;
    try { setPreview(await previewPeriodShares(from, to, overrides())); } catch (e: any) { toast.error(e.message); setPreview(null); }
  };
  useEffect(() => { setTyped({}); loadPreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, rules]);

  const post = async () => {
    setBusy(true);
    try {
      const r = await postPeriodShares(from, to, overrides());
      toast.success(`اتسجل ${r.posted} — اتخصموا من ربح الفترة كمرتبات للشركاء`);
      setTyped({}); await loadPreview(); load(); setStepKey((k) => k + 1);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const cancel = async (reason: string) => {
    try { await cancelPeriodShares(from, to, reason); toast.success("اتلغت مرتبات الفترة"); setAsking(false); await loadPreview(); load(); setStepKey((k) => k + 1); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>مرتب كل شريك</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <PermTable className="w-full text-sm" permTable="pay" noFilter>
            <thead className="bg-muted/40">
              <tr className="text-right"><th className="p-2">الشريك</th><th className="p-2">نصيبه من رأس المال</th><th className="p-2">مرتبه الشهر ده</th>{canWrite && <th className="p-2">إجراءات</th>}</tr>
            </thead>
            <tbody>
              {active.map((r) => (
                <tr key={r.partner.id} className="border-t">
                  <td className="p-2 font-semibold">{r.partner.name}</td>
                  <td className="p-2 tabular-nums">{pct(shares[r.partner.id]?.share ?? 0)}</td>
                  <td className="p-2" data-testid={`pay-${r.partner.id}`}>{payRuleText(ruleForMonth(rules, r.partner.id, thisMonth))}</td>
                  {canWrite && <td className="p-2"><Button size="sm" variant="outline" className="gap-1" onClick={() => setEditing(r)}><Settings2 className="w-4 h-4" /> حدد مرتبه</Button></td>}
                </tr>
              ))}
            </tbody>
          </PermTable>
          {rules.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">تاريخ التغييرات ({rules.length})</summary>
              <ul className="mt-2 space-y-1">
                {[...rules].reverse().map((x) => (
                  <li key={x.id}>من شهر <b>{x.from_month.slice(0, 7)}</b> — {active.find((a) => a.partner.id === x.partner_id)?.partner.name ?? ""}:{" "}
                    {payRuleText({ fixed: Number(x.fixed_amount), percent: Number(x.percent), base: x.percent_base })}</li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>لو الشهر كسب كام… كل واحد ياخد كام؟</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div><Label htmlFor="dist-example">ربح الشهر</Label><Input id="dist-example" type="number" value={profit} onChange={(e) => setProfit(e.target.value)} className="w-44" /></div>
            <span className="text-xs text-muted-foreground pb-2">بالمرتبات والنسب الحالية (اكتب بالسالب للشهر الخسران)</span>
          </div>
          <PayExampleTable example={example} profit={Number(profit || 0)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>خطوة 1: سجّل مرتبات الشركاء للفترة</CardTitle>
          <p className="text-xs text-muted-foreground">بتتخصم من ربح الفترة الأول (مصروف مرتبات) — والتوزيع مش هيقبل فترة فيها مرتب شريك مش متسجل.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div><Label htmlFor="pay-from">من</Label><Input id="pay-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label htmlFor="pay-to">إلى</Label><Input id="pay-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          {preview && (
            <>
              {(preview.months ?? []).length > 0 && (
                <PermTable className="w-full text-sm" noFilter>
                  <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشهر</th><th className="p-2">صافي الربح قبل المرتبات</th><th className="p-2">المرتبات</th><th className="p-2">الباقي للتوزيع</th></tr></thead>
                  <tbody>
                    {(preview.months ?? []).map((m) => (
                      <tr key={m.month} className="border-t">
                        <td className="p-2 tabular-nums">{m.month}</td>
                        <td className={`p-2 tabular-nums ${m.net_before < 0 ? "text-destructive" : ""}`}>{formatEGP(m.net_before)}</td>
                        <td className="p-2 text-xs">{m.lines.length ? m.lines.map((l) => `${l.name}: ${formatEGP(l.amount)}${l.kind === "percent" ? ` (${pct(l.percent ?? 0)})` : " ثابت"}`).join(" • ") : "—"}</td>
                        <td className="p-2 tabular-nums font-bold">{formatEGP(m.net_before - m.pay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </PermTable>
              )}
              {preview.rows.length === 0 ? (
                <div className="text-sm text-muted-foreground">مفيش شريك ليه مرتب في الفترة دي — روح على خطوة 2 على طول.</div>
              ) : (
                <PermTable className="w-full text-sm" noFilter>
                  <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشريك</th><th className="p-2">النوع</th><th className="p-2">المحسوب</th><th className="p-2">هيتسجل</th></tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.key} className="border-t">
                        <td className="p-2">{r.name}</td>
                        <td className="p-2">{r.kind === "salary_share" ? "مرتب ثابت" : `نسبة ${pct(r.percent ?? 0)}`}</td>
                        <td className="p-2 tabular-nums">{formatEGP(r.computed ?? r.amount)}</td>
                        <td className="p-2 w-40">
                          {preview.already || !canWrite ? formatEGP(r.amount) : (
                            <Input type="number" min={0} aria-label={`مبلغ ${r.name}`} value={typed[r.key] ?? String(r.amount)}
                              onChange={(e) => setTyped({ ...typed, [r.key]: e.target.value })} onBlur={loadPreview} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </PermTable>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>الإجمالي: <b>{formatEGP(preview.total)}</b>{preview.already && " — اتسجلت للفترة دي ✓"}</span>
                {canWrite && !preview.already && preview.rows.length > 0 && <Button onClick={post} disabled={busy}>سجّل مرتبات الشركاء</Button>}
                {canWrite && preview.already && <Button variant="destructive" size="sm" onClick={() => setAsking(true)}>الغي مرتبات الفترة</Button>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>خطوة 2: وزّع الباقي على الشركا</CardTitle>
          <p className="text-xs text-muted-foreground">
            النظام بيقترح النسب حسب رأس مال كل واحد في كل شهر — وانت تكتب النسبة أو المبلغ اللي تحبه لكل شريك. السلف المفتوحة بتتخصم من نصيبه الأول.
          </p>
        </CardHeader>
        <CardContent><PeriodSplit from={from} to={to} reloadKey={stepKey} onDone={load} /></CardContent>
      </Card>

      {editing && <PartnerPayDialog cards={editing} active={active} shares={shares} rules={rules} onClose={() => setEditing(null)} onDone={load} />}
      {asking && <ReasonDialog title="إلغاء مرتبات الفترة" description="المرتبات اللي اتسجلت للفترة دي هتتعكس في نفس يومها." onConfirm={cancel} onClose={() => setAsking(false)} />}
    </div>
  );
}
