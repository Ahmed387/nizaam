import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { toast } from "sonner";
import { Loader2, Save, Smartphone, CreditCard, Landmark, Banknote, Plus, Trash2, Wallet } from "lucide-react";
import { loadTransferFees } from "@/lib/paymentMethods";
import { confirmAlert } from "@/components/ConfirmDialog";

interface FeeRow {
  payment_method: string;
  label?: string | null;
  fee_type: "percentage" | "fixed";
  fee_value: number;
  is_enabled: boolean;
  is_builtin: boolean;
}

const BUILTIN_META: Record<string, { label: string; Icon: any }> = {
  vodafone: { label: "محفظة إلكترونية", Icon: Smartphone },
  instapay: { label: "انستاباي", Icon: CreditCard },
  bank: { label: "تحويل بنكي", Icon: Landmark },
};

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9_\u0600-\u06FF]+/g, "_").replace(/^_+|_+$/g, "") || `m_${Date.now()}`;

export function PaymentFeesTab() {
  const { user, profile, tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newM, setNewM] = useState({ label: "", key: "", fee_type: "fixed" as "fixed" | "percentage", fee_value: 0 });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("transfer_fees").select("payment_method,label,fee_type,fee_value,is_enabled");
    const existing: FeeRow[] = [];
    for (const m of ["vodafone", "instapay", "bank"]) {
      const row: any = data?.find((d: any) => d.payment_method === m);
      existing.push(row
        ? { ...row, label: row.label || BUILTIN_META[m].label, is_builtin: true, is_enabled: row.is_enabled !== false }
        : { payment_method: m, label: BUILTIN_META[m].label, fee_type: "fixed", fee_value: 0, is_enabled: true, is_builtin: true });
    }
    for (const d of (data ?? []) as any[]) {
      if (!["vodafone", "instapay", "bank"].includes(d.payment_method)) {
        existing.push({ ...d, label: d.label || d.payment_method, is_builtin: false, is_enabled: d.is_enabled !== false });
      }
    }
    setRows(existing);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateRow = (key: string, patch: Partial<FeeRow>) =>
    setRows(rows.map((r) => r.payment_method === key ? { ...r, ...patch } : r));

  const save = async (key: string) => {
    const row = rows.find((r) => r.payment_method === key);
    if (!row) return;
    setSaving(key);
    const { error } = await supabase
      .from("transfer_fees")
      .upsert(
        {
          payment_method: row.payment_method,
          label: row.label,
          fee_type: row.fee_type,
          fee_value: row.fee_value,
          is_enabled: row.is_enabled,
          updated_by: user!.id,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "tenant_id,payment_method" }
      );
    setSaving(null);
    if (error) return toast.error(error.message);
    toast.success(`تم الحفظ`);
    await loadTransferFees(true);
    if (user && profile) {
      await logAudit({
        userId: user.id, userName: profile.name, tenantId,
        action: "UPDATE", entity: "transfer_fees", entityId: key,
        details: { ...row },
      });
    }
  };

  const addCustom = async () => {
    const label = newM.label.trim();
    if (!label) return toast.error("اكتب اسم الطريقة");
    const key = slugify(newM.key || newM.label);
    if (rows.some((r) => r.payment_method === key)) return toast.error("المفتاح موجود بالفعل");
    const { error } = await supabase.from("transfer_fees").insert({
      payment_method: key, label, fee_type: newM.fee_type, fee_value: newM.fee_value, is_enabled: true,
      updated_by: user!.id,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("تمت إضافة طريقة الدفع");
    setAddOpen(false);
    setNewM({ label: "", key: "", fee_type: "fixed", fee_value: 0 });
    await loadTransferFees(true);
    load();
  };

  const removeCustom = async (key: string) => {
    if (!(await confirmAlert({ title: "حذف طريقة الدفع دي؟", description: "الخطوة دي مش هتترجع تاني — متأكد؟", confirmLabel: "أيوه، امسح", cancelLabel: "لأ، سيبها", tone: "danger" }))) return;
    const { error } = await supabase.from("transfer_fees").delete().eq("payment_method", key);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    await loadTransferFees(true);
    load();
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="card-elevated p-4 text-sm bg-info/5 border border-info/20 flex items-center justify-between gap-3">
        <p className="text-muted-foreground flex-1">
          فعّل/عطّل طرق الدفع وحدد العمولة (نسبة أو مبلغ ثابت). تقدر تضيف طرق دفع جديدة وهتظهر تلقائياً في صفحة المبيعات.
        </p>
        <Button size="sm" className="gap-2 shrink-0" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" /> إضافة طريقة
        </Button>
      </div>

      {/* Cash */}
      <div className="card-elevated p-5 opacity-90">
        <div className="flex items-center gap-3">
          <Banknote className="w-6 h-6 text-success" />
          <div className="flex-1">
            <h3 className="text-lg font-bold">نقدي</h3>
            <p className="text-xs text-muted-foreground">مُفعّل دائماً — بدون عمولة</p>
          </div>
          <span className="text-xs px-2 py-1 rounded bg-success/10 text-success font-bold">ثابت</span>
        </div>
      </div>

      {rows.map((f) => {
        const Icon = f.is_builtin ? (BUILTIN_META[f.payment_method]?.Icon ?? Wallet) : Wallet;
        return (
          <div key={f.payment_method} className={`card-elevated p-5 ${!f.is_enabled ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-3 mb-4">
              <Icon className="w-6 h-6 text-primary" />
              {f.is_builtin ? (
                <h3 className="text-lg font-bold flex-1">{f.label}</h3>
              ) : (
                <Input
                  className="flex-1 text-lg font-bold"
                  value={f.label || ""}
                  onChange={(e) => updateRow(f.payment_method, { label: e.target.value })}
                />
              )}
              <div className="flex items-center gap-2">
                <Label className="text-sm">{f.is_enabled ? "مُفعّل" : "معطّل"}</Label>
                <Switch checked={f.is_enabled} onCheckedChange={(v) => updateRow(f.payment_method, { is_enabled: v })} />
              </div>
              {!f.is_builtin && (
                <Button variant="ghost" size="icon" onClick={() => removeCustom(f.payment_method)} title="حذف">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              )}
            </div>
            {f.is_enabled && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>نوع العمولة</Label>
                  <Select value={f.fee_type} onValueChange={(v) => updateRow(f.payment_method, { fee_type: v as any })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">مبلغ ثابت (جنيه)</SelectItem>
                      <SelectItem value="percentage">نسبة مئوية (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{f.fee_type === "percentage" ? "النسبة %" : "المبلغ بالجنيه"}</Label>
                  <Input type="number" step="0.01" min={0} value={f.fee_value}
                    onChange={(e) => updateRow(f.payment_method, { fee_value: Number(e.target.value) })}
                    className="mt-1.5" />
                </div>
              </div>
            )}
            <Button className="mt-3 gap-2" onClick={() => save(f.payment_method)} disabled={saving === f.payment_method}>
              {saving === f.payment_method ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>
          </div>
        );
      })}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>إضافة طريقة دفع جديدة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>اسم الطريقة (يظهر للمستخدم)</Label>
              <Input value={newM.label} onChange={(e) => setNewM({ ...newM, label: e.target.value })} placeholder="مثلاً: فيزا، شيك، تيلدا..." />
            </div>
            <div>
              <Label>المفتاح (اختياري — حروف إنجليزية)</Label>
              <Input dir="ltr" className="text-right" value={newM.key} onChange={(e) => setNewM({ ...newM, key: e.target.value })} placeholder="visa" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>نوع العمولة</Label>
                <Select value={newM.fee_type} onValueChange={(v) => setNewM({ ...newM, fee_type: v as any })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">مبلغ ثابت</SelectItem>
                    <SelectItem value="percentage">نسبة %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>القيمة</Label>
                <Input type="number" step="0.01" min={0} value={newM.fee_value}
                  onChange={(e) => setNewM({ ...newM, fee_value: Number(e.target.value) })} className="mt-1.5" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={addCustom} className="gap-2"><Plus className="w-4 h-4" /> إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
