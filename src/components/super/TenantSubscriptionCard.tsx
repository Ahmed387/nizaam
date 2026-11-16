/**
 * Platform owner → one company → «الاشتراك» (migration 0239): plan, monthly / yearly / unlimited, start → end
 * (end proposed = a month / a year − 1 day, editable), price and discount (from the plan, editable), amount due,
 * paid by hand (amount, day, note), grace days, the countdown and the history. A new start day / plan / cycle is a
 * new period and starts unpaid («ابدا من الاول»).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";
import { afterDiscount, countdownText, limitText, periodEnd, statusLabel, type Cycle, type Plan } from "@/lib/plans";

interface Sub {
  plan_id: string; plan_name: string; cycle: Cycle; starts_on: string; ends_on: string | null; price: number; discount_pct: number;
  amount_due: number; paid: boolean; paid_amount: number | null; paid_on: string | null; paid_note: string | null; grace_days: number;
  unlimited: boolean; notes: string | null; days_left: number | null; status: string;
}
interface Resp { subscription: Sub | null; usage: { branches: number; users: number; invoices_month: number }; events: { at: string; event: string; data: any; by: string | null }[] }

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const money = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const EVENT: Record<string, string> = { start: "بداية اشتراك", renew: "تجديد / فترة جديدة", change: "تعديل", paid: "اتدفع", unpaid: "اتلغى الدفع" };

export function TenantSubscriptionCard({ tenantId }: { tenantId: string }) {
  const [resp, setResp] = useState<Resp | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [f, setF] = useState({ plan_id: "", cycle: "monthly" as Cycle, starts_on: today(), ends_on: "", price: "", discount_pct: "", grace_days: "7", unlimited: false, notes: "" });
  const [pay, setPay] = useState({ amount: "", on: today(), note: "" });
  const [busy, setBusy] = useState<"" | "save" | "pay">("");

  const fill = (r: Resp) => {
    setResp(r);
    const s = r.subscription;
    if (s) {
      setF({ plan_id: s.plan_id, cycle: s.cycle, starts_on: s.starts_on, ends_on: s.ends_on ?? "", price: String(s.price), discount_pct: String(s.discount_pct),
        grace_days: String(s.grace_days), unlimited: s.unlimited, notes: s.notes ?? "" });
      setPay((p) => ({ ...p, amount: String(s.amount_due) }));
    }
  };
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      (supabase.rpc as any)("super_tenant_subscription_get", { p_tenant: tenantId }),
      (supabase.rpc as any)("super_plans_list"),
    ]);
    if (a.error) return toast.error(rpcErrorText(a.error));
    fill(a.data as Resp);
    if (!b.error) setPlans(((b.data as any).plans as Plan[]));
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const plan = plans.find((p) => p.id === f.plan_id) ?? null;
  // choosing a plan / cycle proposes its price, discount and end day
  const propose = (next: Partial<typeof f>) => {
    const n = { ...f, ...next };
    const p = plans.find((x) => x.id === n.plan_id);
    if (p && ("plan_id" in next || "cycle" in next)) {
      n.price = String(n.cycle === "yearly" ? p.yearly_price : n.cycle === "monthly" ? p.monthly_price : 0);
      n.discount_pct = String(n.cycle === "yearly" ? p.yearly_discount_pct : n.cycle === "monthly" ? p.monthly_discount_pct : 0);
    }
    if ("starts_on" in next || "cycle" in next) n.ends_on = periodEnd(n.starts_on, n.cycle) ?? "";
    if (n.cycle === "unlimited") n.unlimited = true;
    setF(n);
  };
  const due = useMemo(() => afterDiscount(Number(f.price || 0), Number(f.discount_pct || 0)), [f.price, f.discount_pct]);

  const save = async () => {
    if (!f.plan_id) return toast.error("اختار الباقة");
    setBusy("save");
    const { data, error } = await (supabase.rpc as any)("super_tenant_subscription_set", {
      p_tenant: tenantId,
      p: { plan_id: f.plan_id, cycle: f.cycle, starts_on: f.starts_on, ends_on: f.cycle === "unlimited" ? null : f.ends_on || null,
           price: f.price, discount_pct: f.discount_pct, grace_days: f.grace_days, unlimited: f.unlimited, notes: f.notes },
    });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    fill(data as Resp);
    toast.success("اتحفظ الاشتراك");
  };
  const setPaid = async (paid: boolean) => {
    setBusy("pay");
    const { data, error } = await (supabase.rpc as any)("super_tenant_subscription_pay", {
      p_tenant: tenantId, p_paid: paid, p_amount: paid ? Number(pay.amount || 0) : null, p_on: paid ? pay.on : null, p_note: paid ? pay.note : null,
    });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    fill(data as Resp);
    toast.success(paid ? "اتسجل الدفع" : "اتلغى الدفع");
  };

  if (!resp) return <section className="card-elevated p-5 mb-5"><Loader2 className="w-5 h-5 animate-spin" /></section>;
  const s = resp.subscription;
  return (
    <section className="card-elevated p-5 mb-5 grid gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-extrabold">الاشتراك</h2>
        {s ? (
          <>
            <Badge variant="outline">{s.plan_name}</Badge>
            <Badge variant="outline">{statusLabel(s.status)}</Badge>
            <span className={`text-sm font-bold ${s.status === "expired" || s.status === "grace" ? "text-destructive" : s.status === "ending" ? "text-warning" : "text-success"}`}>
              ⏱ {countdownText(s.days_left)}{s.ends_on ? ` (لحد ${s.ends_on})` : ""}
            </span>
            {s.paid ? <Badge className="bg-success/15 text-success border-success/30">مدفوع {s.paid_amount != null ? money(s.paid_amount) : ""}</Badge>
              : !s.unlimited && <Badge className="bg-destructive/15 text-destructive border-destructive/30">مش مدفوع — مطلوب {money(s.amount_due)}</Badge>}
          </>
        ) : <Badge variant="outline">مفيش اشتراك — كل حاجة مفتوحة</Badge>}
      </div>
      <div className="text-xs text-muted-foreground">
        الاستخدام: {resp.usage.branches} فرع (الحد {limitText(plan?.max_branches)}) — {resp.usage.users} مستخدم (الحد {limitText(plan?.max_users)}) — {resp.usage.invoices_month} فاتورة بيع الشهر ده (الحد {limitText(plan?.max_invoices_month)})
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div><Label>الباقة</Label>
          <select className="w-full h-10 rounded-md border bg-background px-2" value={f.plan_id} onChange={(e) => propose({ plan_id: e.target.value })}>
            <option value="">اختار…</option>
            {plans.filter((p) => p.is_active || p.id === f.plan_id).map((p) => <option key={p.id!} value={p.id!}>{p.name}</option>)}
          </select>
        </div>
        <div><Label>المدة</Label>
          <select className="w-full h-10 rounded-md border bg-background px-2" value={f.cycle} onChange={(e) => propose({ cycle: e.target.value as Cycle })}>
            <option value="monthly">شهري</option><option value="yearly">سنوي</option><option value="unlimited">غير محدود</option>
          </select>
        </div>
        <div><Label>من</Label><Input type="date" value={f.starts_on} onChange={(e) => propose({ starts_on: e.target.value })} /></div>
        <div><Label>لحد</Label><Input type="date" value={f.ends_on} disabled={f.cycle === "unlimited"} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></div>
        <div><Label>السعر</Label><Input type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
        <div><Label>الخصم ٪</Label><Input type="number" min={0} max={100} value={f.discount_pct} onChange={(e) => setF({ ...f, discount_pct: e.target.value })} /></div>
        <div><Label>المطلوب</Label><div className="h-10 flex items-center font-extrabold">{money(due)}</div></div>
        <div><Label>أيام السماح بعد النهاية</Label><Input type="number" min={0} max={60} value={f.grace_days} onChange={(e) => setF({ ...f, grace_days: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={f.unlimited} onChange={(e) => setF({ ...f, unlimited: e.target.checked })} /> بلا حدود (كل الخصائص ومفيش حد للفروع / المستخدمين / الفواتير)</label>
        <div className="md:col-span-2"><Label>ملاحظات</Label><Textarea rows={1} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      <div><Button onClick={save} disabled={busy !== ""}>{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ الاشتراك</Button></div>

      {s && !s.unlimited && (
        <div className="rounded-lg border p-3 grid gap-2 md:grid-cols-4 items-end">
          <div className="md:col-span-4 font-bold">الدفع (بتأكده بإيدك)</div>
          <div><Label>المبلغ اللي اتدفع</Label><Input type="number" min={0} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
          <div><Label>يوم الدفع</Label><Input type="date" value={pay.on} onChange={(e) => setPay({ ...pay, on: e.target.value })} /></div>
          <div><Label>ملاحظة (فودافون كاش، تحويل…)</Label><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
          <div className="flex gap-2">
            <Button onClick={() => setPaid(true)} disabled={busy !== ""}><CheckCircle2 className="w-4 h-4" /> اتدفع</Button>
            {s.paid && <Button variant="outline" onClick={() => setPaid(false)} disabled={busy !== ""}><XCircle className="w-4 h-4" /> مش مدفوع</Button>}
          </div>
        </div>
      )}

      {resp.events.length > 0 && (
        <div className="text-xs space-y-1">
          <div className="font-bold text-sm">السجل</div>
          {resp.events.map((e, i) => (
            <div key={i} className="text-muted-foreground">
              {new Date(e.at).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })} — {EVENT[e.event] ?? e.event}
              {e.data?.plan ? ` — ${e.data.plan}` : ""}{e.data?.ends_on ? ` لحد ${e.data.ends_on}` : ""}
              {e.data?.amount_due != null ? ` — مطلوب ${money(e.data.amount_due)}` : ""}{e.data?.amount != null ? ` — ${money(e.data.amount)}` : ""}
              {e.by ? ` — ${e.by}` : ""}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
