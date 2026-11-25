import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { payExample, payRuleText, ruleForMonth, setPayRule, toFraction, type PartnerCards, type PayBase, type PayRule, type PayRuleRow } from "@/lib/partners";
import { PayExampleTable } from "./PayExampleTable";

type Mode = "none" | "fixed" | "percent" | "both";
const modeOf = (r: PayRule | null): Mode =>
  !r ? "none" : r.fixed > 0 && r.percent > 0 ? "both" : r.fixed > 0 ? "fixed" : r.percent > 0 ? "percent" : "none";

/**
 * «مرتب الشريك» (0280, owner 2026-11-25 «انا اللي اختار … ثابت ولا نسبة او الاتنين … مع تحديد الشهر»): from a month on he
 * takes a fixed salary, a % of the profit (of the whole profit or of what is left after the fixed ones), both, or nothing —
 * until the owner changes it again. The table under it is the split of an example month with these choices.
 */
export function PartnerPayDialog({ cards, active, shares, rules, onClose, onDone }: {
  cards: PartnerCards; active: PartnerCards[]; shares: Record<string, { share: number }>; rules: PayRuleRow[];
  onClose: () => void; onDone: () => void;
}) {
  const [month, setMonth] = useState(cairoTodayDay().slice(0, 7));
  const current = ruleForMonth(rules, cards.partner.id, month);
  const [mode, setMode] = useState<Mode>(modeOf(current));
  const [fixed, setFixed] = useState(current?.fixed ? String(current.fixed) : "");
  const [percent, setPercent] = useState(current?.percent ? String(Math.round(current.percent * 10000) / 100) : "");
  const [base, setBase] = useState<PayBase>(current?.base ?? "after_fixed");
  const [profit, setProfit] = useState("300000");
  const [busy, setBusy] = useState(false);

  const rule: PayRule = {
    fixed: mode === "fixed" || mode === "both" ? Number(fixed || 0) : 0,
    percent: mode === "percent" || mode === "both" ? toFraction(percent) : 0,
    base,
  };
  const example = useMemo(() => payExample(Number(profit || 0), active.map((r) => ({
    id: r.partner.id, name: r.partner.name, share: shares[r.partner.id]?.share ?? 0,
    rule: r.partner.id === cards.partner.id ? rule : ruleForMonth(rules, r.partner.id, month),
  }))), [profit, active, shares, rules, month, rule.fixed, rule.percent, rule.base, cards.partner.id]);

  const save = async () => {
    if (!month) return toast.error("اختار الشهر");
    if ((mode === "fixed" || mode === "both") && !(Number(fixed) > 0)) return toast.error("اكتب المرتب الثابت");
    if ((mode === "percent" || mode === "both") && !(Number(percent) > 0 && Number(percent) <= 100)) return toast.error("اكتب النسبة (من 1 لـ 100)");
    setBusy(true);
    try {
      await setPayRule(cards.partner.id, month, rule);
      toast.success(`${cards.partner.name} من شهر ${month}: ${payRuleText(rule)}`);
      onDone(); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>مرتب {cards.partner.name}</DialogTitle>
          <DialogDescription>بيتاخد من ربح كل شهر قبل التوزيع على رأس المال — ويفضل كده لحد ما تغيّره من شهر تاني.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="max-w-xs">
            <Label htmlFor="pay-month">من شهر</Label>
            <Input id="pay-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">دلوقتي في الشهر ده: {payRuleText(current)}</p>
          </div>
          <div className="space-y-2">
            <Label>هياخد إيه؟</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {([["fixed", "مرتب ثابت"], ["percent", "نسبة من الربح"], ["both", "الاتنين"], ["none", "مالوش مرتب"]] as const).map(([v, l]) => (
                <label key={v} className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm cursor-pointer ${mode === v ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value={v} aria-label={l} /> {l}
                </label>
              ))}
            </RadioGroup>
          </div>
          {(mode === "fixed" || mode === "both") && (
            <div className="max-w-xs">
              <Label htmlFor="pay-fixed">المرتب الثابت في الشهر</Label>
              <Input id="pay-fixed" type="number" min={0} value={fixed} onChange={(e) => setFixed(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">بيتصرف حتى في الشهر الخسران.</p>
            </div>
          )}
          {(mode === "percent" || mode === "both") && (
            <div className="grid gap-2">
              <div className="max-w-xs">
                <Label htmlFor="pay-percent">النسبة %</Label>
                <Input id="pay-percent" type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="مثلاً 10" />
              </div>
              <RadioGroup value={base} onValueChange={(v) => setBase(v as PayBase)} className="grid gap-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="after_fixed" aria-label="من الربح بعد المرتبات الثابتة" /> من الربح بعد المرتبات الثابتة</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="all" aria-label="من الربح كله" /> من الربح كله</label>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">الشهر الخسران النسبة صفر.</p>
            </div>
          )}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="pay-example">لو الشهر كسب</Label>
                <Input id="pay-example" type="number" value={profit} onChange={(e) => setProfit(e.target.value)} className="w-40" />
              </div>
              <span className="text-xs text-muted-foreground pb-2">(اكتب رقم بالسالب للشهر الخسران)</span>
            </div>
            <PayExampleTable example={example} profit={Number(profit || 0)} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy}>احفظ من شهر {month}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
