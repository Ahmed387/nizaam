import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { toast } from "sonner";
import { Loader2, Save, Smartphone, CreditCard, Landmark, Banknote } from "lucide-react";
import { loadTransferFees } from "@/lib/paymentMethods";

interface FeeRow {
  payment_method: "vodafone" | "instapay" | "bank";
  fee_type: "percentage" | "fixed";
  fee_value: number;
  is_enabled: boolean;
}

const METHODS: { value: FeeRow["payment_method"]; label: string; Icon: any }[] = [
  { value: "vodafone", label: "محفظة إلكترونية", Icon: Smartphone },
  { value: "instapay", label: "انستاباي", Icon: CreditCard },
  { value: "bank", label: "تحويل بنكي", Icon: Landmark },
];

export function PaymentFeesTab() {
  const { user, profile, tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [fees, setFees] = useState<Record<string, FeeRow>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("transfer_fees").select("payment_method,fee_type,fee_value,is_enabled");
    const map: Record<string, FeeRow> = {};
    for (const m of METHODS) {
      const existing: any = data?.find((d: any) => d.payment_method === m.value);
      map[m.value] = existing
        ? { ...existing, is_enabled: existing.is_enabled !== false }
        : { payment_method: m.value, fee_type: "fixed", fee_value: 0, is_enabled: true };
    }
    setFees(map);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async (method: FeeRow["payment_method"]) => {
    const row = fees[method];
    setSaving(method);
    const { error } = await supabase
      .from("transfer_fees")
      .upsert(
        { ...row, updated_by: user!.id, updated_at: new Date().toISOString() } as any,
        { onConflict: "tenant_id,payment_method" }
      );
    setSaving(null);
    if (error) return toast.error(error.message);
    toast.success(`تم حفظ إعدادات ${METHODS.find((m) => m.value === method)?.label}`);
    await loadTransferFees(true);
    if (user && profile) {
      await logAudit({
        userId: user.id, userName: profile.name, tenantId,
        action: "UPDATE", entity: "transfer_fees", entityId: method,
        details: { method, ...row },
      });
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="card-elevated p-4 text-sm bg-info/5 border border-info/20">
        <p className="text-muted-foreground">
          فعّل/عطّل طرق الدفع وحدد العمولة (نسبة أو مبلغ ثابت) لكل طريقة. النقدي دائماً مُفعّل بدون عمولة.
        </p>
      </div>

      {/* Cash — info card */}
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

      {METHODS.map((m) => {
        const f = fees[m.value];
        if (!f) return null;
        const Icon = m.Icon;
        return (
          <div key={m.value} className={`card-elevated p-5 ${!f.is_enabled ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-3 mb-4">
              <Icon className="w-6 h-6 text-primary" />
              <h3 className="text-lg font-bold flex-1">{m.label}</h3>
              <div className="flex items-center gap-2">
                <Label htmlFor={`en-${m.value}`} className="text-sm">{f.is_enabled ? "مُفعّل" : "معطّل"}</Label>
                <Switch
                  id={`en-${m.value}`}
                  checked={f.is_enabled}
                  onCheckedChange={(v) => setFees({ ...fees, [m.value]: { ...f, is_enabled: v } })}
                />
              </div>
            </div>
            {f.is_enabled && (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>نوع العمولة</Label>
                    <Select
                      value={f.fee_type}
                      onValueChange={(v) => setFees({ ...fees, [m.value]: { ...f, fee_type: v as any } })}
                    >
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">مبلغ ثابت (جنيه)</SelectItem>
                        <SelectItem value="percentage">نسبة مئوية (%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{f.fee_type === "percentage" ? "النسبة %" : "المبلغ بالجنيه"}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={f.fee_value}
                      onChange={(e) => setFees({ ...fees, [m.value]: { ...f, fee_value: Number(e.target.value) } })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  مثال: على مبلغ 1,000 ج.م → عمولة{" "}
                  <span className="font-bold text-foreground">
                    {f.fee_type === "percentage" ? `${((1000 * f.fee_value) / 100).toFixed(2)} ج.م` : `${f.fee_value} ج.م`}
                  </span>
                </p>
              </>
            )}
            <Button className="mt-3 gap-2" onClick={() => save(m.value)} disabled={saving === m.value}>
              {saving === m.value ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>
          </div>
        );
      })}
    </div>
  );
}
