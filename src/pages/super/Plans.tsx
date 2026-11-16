/**
 * Platform owner → «الباقات والاشتراكات» (migration 0239, owner 2026-11-16): every plan with its monthly / yearly
 * price, a discount % for each, limits (branches / users / sale invoices a month; empty = بلا حد) and which features
 * it opens — the feature list is the system's standard catalogue (`platform_features`). Below: every company with its
 * plan, end day, days left and paid / not paid; a company's subscription is set on its own page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermTable } from "@/components/PermTable";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";
import { afterDiscount, groupFeatures, limitText, statusLabel, type Feature, type Plan } from "@/lib/plans";

interface Overview { tenant_id: string; tenant: string; plan: string | null; cycle: string | null; ends_on: string | null; paid: boolean | null; amount_due: number | null; unlimited: boolean | null; days_left: number | null; status: string }

const money = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const EMPTY: Plan = { id: null, name: "", description: "", monthly_price: 0, yearly_price: 0, monthly_discount_pct: 0, yearly_discount_pct: 0,
  max_branches: null, max_users: null, max_invoices_month: null, all_features: false, is_active: true, sort: 10, features: [], companies: 0 };

export default function Plans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [overview, setOverview] = useState<Overview[]>([]);
  const [edit, setEdit] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data, error }, ov] = await Promise.all([
      (supabase.rpc as any)("super_plans_list"),
      (supabase.rpc as any)("super_subscriptions_overview"),
    ]);
    if (error) return toast.error(rpcErrorText(error));
    setPlans((data as any).plans); setFeatures((data as any).features);
    if (!ov.error) setOverview(ov.data as Overview[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupFeatures(features), [features]);

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    const { error } = await (supabase.rpc as any)("super_plan_save", { p: edit });
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success("اتحفظت الباقة");
    setEdit(null); load();
  };
  const remove = async (p: Plan) => {
    if (!window.confirm(`تمسح باقة «${p.name}»؟`)) return;
    const { error } = await (supabase.rpc as any)("super_plan_delete", { p_id: p.id });
    if (error) return toast.error(rpcErrorText(error));
    load();
  };
  const toggle = (key: string, on: boolean) => {
    if (!edit) return;
    const set = new Set(edit.features);
    const kids = features.filter((f) => f.parent === key).map((f) => f.key);
    if (on) { set.add(key); kids.forEach((k) => set.add(k)); const par = features.find((f) => f.key === key)?.parent; if (par) set.add(par); }
    else { set.delete(key); kids.forEach((k) => set.delete(k)); }
    setEdit({ ...edit, features: [...set] });
  };
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <SuperAdminLayout>
      <PageHeader title="الباقات والاشتراكات" subtitle="كل باقة: سعرها الشهري والسنوي، الخصم، الحدود، والخصائص اللي بتفتحها"
        actions={<Button onClick={() => setEdit({ ...EMPTY })}><Plus className="w-4 h-4" /> باقة جديدة</Button>} />
      {!plans ? <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-6">
            {plans.map((p) => (
              <div key={p.id} className={`card-elevated p-4 space-y-2 ${p.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-extrabold text-lg">{p.name}</h3>
                  {!p.is_active && <Badge variant="outline">موقوفة</Badge>}
                </div>
                {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                <div className="text-sm">شهري: <b>{money(afterDiscount(p.monthly_price, p.monthly_discount_pct))}</b>{p.monthly_discount_pct > 0 && <span className="text-muted-foreground line-through mr-1">{money(p.monthly_price)}</span>}</div>
                <div className="text-sm">سنوي: <b>{money(afterDiscount(p.yearly_price, p.yearly_discount_pct))}</b>{p.yearly_discount_pct > 0 && <span className="text-muted-foreground line-through mr-1">{money(p.yearly_price)}</span>}</div>
                <div className="text-xs text-muted-foreground">
                  فروع {limitText(p.max_branches)} — مستخدمين {limitText(p.max_users)} — فواتير بيع/شهر {limitText(p.max_invoices_month)}
                </div>
                <div className="text-xs">{p.all_features ? "كل الخصائص" : `${p.features.length} من ${features.length} خاصية`} — {p.companies} شركة</div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setEdit({ ...p, features: [...p.features] })}><Pencil className="w-4 h-4" /> تعديل</Button>
                  {p.companies === 0 && <Button size="sm" variant="ghost" onClick={() => remove(p)}><Trash2 className="w-4 h-4" /></Button>}
                </div>
              </div>
            ))}
          </div>

          <div className="card-elevated p-4">
            <h3 className="font-bold mb-3">اشتراكات الشركات</h3>
            <div className="overflow-x-auto">
              <PermTable className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr><th className="text-right px-3 py-2">الشركة</th><th className="text-right px-3 py-2">الباقة</th><th className="text-right px-3 py-2">المدة</th>
                    <th className="text-right px-3 py-2">بينتهي</th><th className="text-right px-3 py-2">باقي</th><th className="text-right px-3 py-2">الحالة</th>
                    <th className="text-right px-3 py-2">المطلوب</th><th className="text-right px-3 py-2">الدفع</th></tr>
                </thead>
                <tbody>
                  {overview.map((o) => (
                    <tr key={o.tenant_id} className="border-t">
                      <td className="px-3 py-2"><Link className="text-primary font-bold" to={`/super/tenants/${o.tenant_id}`}>{o.tenant}</Link></td>
                      <td className="px-3 py-2">{o.plan ?? "—"}</td>
                      <td className="px-3 py-2">{o.cycle === "monthly" ? "شهري" : o.cycle === "yearly" ? "سنوي" : o.cycle === "unlimited" ? "غير محدود" : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{o.ends_on ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{o.days_left == null ? "—" : `${o.days_left} يوم`}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{statusLabel(o.status)}</Badge></td>
                      <td className="px-3 py-2 tabular-nums">{o.unlimited ? "—" : money(o.amount_due)}</td>
                      <td className="px-3 py-2">{o.plan == null ? "—" : o.paid ? <Badge className="bg-success/15 text-success border-success/30">مدفوع</Badge> : <Badge className="bg-destructive/15 text-destructive border-destructive/30">مش مدفوع</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </PermTable>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>{edit?.id ? `تعديل باقة «${edit.name}»` : "باقة جديدة"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="grid gap-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div><Label>اسم الباقة</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                <div className="flex items-end gap-2"><Switch checked={edit.is_active} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} /><Label>شغالة (تظهر عند اختيار باقة لشركة)</Label></div>
                <div className="sm:col-span-2"><Label>وصف</Label><Textarea rows={2} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 rounded-lg border p-3">
                <div><Label>السعر الشهري (جنيه)</Label><Input type="number" min={0} value={edit.monthly_price} onChange={(e) => setEdit({ ...edit, monthly_price: Number(e.target.value) })} /></div>
                <div><Label>خصم الشهري ٪</Label><Input type="number" min={0} max={100} value={edit.monthly_discount_pct} onChange={(e) => setEdit({ ...edit, monthly_discount_pct: Number(e.target.value) })} />
                  <span className="text-xs text-muted-foreground">بعد الخصم: {money(afterDiscount(edit.monthly_price, edit.monthly_discount_pct))}</span></div>
                <div><Label>السعر السنوي (جنيه)</Label><Input type="number" min={0} value={edit.yearly_price} onChange={(e) => setEdit({ ...edit, yearly_price: Number(e.target.value) })} />
                  <span className="text-xs text-muted-foreground">= {edit.monthly_price > 0 ? (edit.yearly_price / edit.monthly_price).toFixed(1) : "—"} شهر</span></div>
                <div><Label>خصم السنوي ٪</Label><Input type="number" min={0} max={100} value={edit.yearly_discount_pct} onChange={(e) => setEdit({ ...edit, yearly_discount_pct: Number(e.target.value) })} />
                  <span className="text-xs text-muted-foreground">بعد الخصم: {money(afterDiscount(edit.yearly_price, edit.yearly_discount_pct))}</span></div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div><Label>أقصى فروع</Label><Input type="number" min={1} placeholder="بلا حد" value={edit.max_branches ?? ""} onChange={(e) => setEdit({ ...edit, max_branches: numOrNull(e.target.value) })} /></div>
                <div><Label>أقصى مستخدمين</Label><Input type="number" min={1} placeholder="بلا حد" value={edit.max_users ?? ""} onChange={(e) => setEdit({ ...edit, max_users: numOrNull(e.target.value) })} /></div>
                <div><Label>أقصى فواتير بيع في الشهر</Label><Input type="number" min={1} placeholder="بلا حد" value={edit.max_invoices_month ?? ""} onChange={(e) => setEdit({ ...edit, max_invoices_month: numOrNull(e.target.value) })} /></div>
              </div>
              <div className="flex items-center gap-2"><Switch checked={edit.all_features} onCheckedChange={(v) => setEdit({ ...edit, all_features: v })} /><Label>كل الخصائص (وأي خاصية جديدة تتضاف للسيستم)</Label></div>
              {!edit.all_features && (
                <div className="grid gap-3">
                  {groups.map((g) => {
                    const keys = g.items.map((f) => f.key);
                    const all = keys.every((k) => edit.features.includes(k));
                    return (
                      <div key={g.section} className="rounded-lg border p-3">
                        <label className="flex items-center gap-2 font-bold mb-2">
                          <Checkbox checked={all} onCheckedChange={(v) => {
                            const set = new Set(edit.features);
                            keys.forEach((k) => (v ? set.add(k) : set.delete(k)));
                            setEdit({ ...edit, features: [...set] });
                          }} /> {g.section} ({keys.filter((k) => edit.features.includes(k)).length}/{keys.length})
                        </label>
                        <div className="grid sm:grid-cols-2 gap-1">
                          {g.items.map((f) => (
                            <label key={f.key} className={`flex items-center gap-2 text-sm ${f.parent ? "pr-6 text-muted-foreground" : ""}`}>
                              <Checkbox checked={edit.features.includes(f.key)} onCheckedChange={(v) => toggle(f.key, !!v)} /> {f.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} حفظ الباقة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SuperAdminLayout>
  );
}
