import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

export default function CountingSheet() {
  const { id: branchId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const { hasRole, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sess, setSess] = useState<any>(null);

  const allowed = isAdmin || hasRole("warehouse");

  const load = async () => {
    if (!sessionId) return;
    setLoading(true);
    const [s, it] = await Promise.all([
      supabase.from("inventory_sessions" as any).select("*").eq("id", sessionId).maybeSingle(),
      supabase
        .from("inventory_session_items" as any)
        // never select system_quantity — keep keeper blind
        .select("id, product_code, product_name, unit, actual_quantity")
        .eq("session_id", sessionId)
        .order("product_name"),
    ]);
    setSess(s.data);
    setItems((it.data as any) ?? []);
    const m: Record<string, string> = {};
    (it.data as any[] | null)?.forEach((r) => {
      if (r.actual_quantity != null) m[r.id] = String(r.actual_quantity);
    });
    setVals(m);
    setLoading(false);
  };
  useEffect(() => { load(); }, [sessionId]);

  const counted = useMemo(() => Object.values(vals).filter((v) => v !== "" && v != null).length, [vals]);
  const progress = items.length ? Math.round((counted / items.length) * 100) : 0;

  const save = async (final: boolean) => {
    if (!sessionId) return;
    setSaving(true);
    const updates = items
      .map((it) => ({ id: it.id, actual_quantity: vals[it.id] === "" || vals[it.id] == null ? null : Number(vals[it.id]) }))
      .filter((u) => u.actual_quantity != null);
    for (const u of updates) {
      await supabase.from("inventory_session_items" as any).update({ actual_quantity: u.actual_quantity }).eq("id", u.id);
    }
    if (final) {
      if (counted < items.length) {
        setSaving(false);
        return toast.error("يجب إدخال جميع الأصناف قبل الإرسال للمراجعة");
      }
      const { error } = await supabase
        .from("inventory_sessions" as any)
        .update({ status: "reviewing", counted_at: new Date().toISOString() })
        .eq("id", sessionId);
      if (error) { setSaving(false); return toast.error(error.message); }
      toast.success("تم إرسال الجرد للمراجعة");
      navigate(`/branch/${branchId}/inventory-count`);
    } else {
      toast.success("تم حفظ الكميات");
    }
    setSaving(false);
  };

  if (!allowed) {
    return (
      <ConditionalLayout title="جرد المخزن">
        <div className="card-elevated p-8 text-center text-muted-foreground">هذه الصفحة لأمين المخزن فقط.</div>
      </ConditionalLayout>
    );
  }

  return (
    <ConditionalLayout
      title="إدخال كميات الجرد"
      subtitle="أدخل الكمية الفعلية لكل منتج — كميات النظام مخفية"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save(false)} disabled={saving || loading || sess?.status !== "counting"}>
            حفظ
          </Button>
          <Button onClick={() => save(true)} disabled={saving || loading || sess?.status !== "counting"} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            إرسال للمراجعة
          </Button>
        </div>
      }
    >
      {sess && sess.status !== "counting" && (
        <div className="card-elevated p-4 mb-4 text-amber-600 bg-amber-500/10 border-amber-500/30">
          هذه الجلسة لم تعد في طور العد — لا يمكن التعديل.
        </div>
      )}

      <div className="card-elevated p-4 mb-4">
        <div className="flex justify-between mb-2 text-sm">
          <span>التقدم: {counted} / {items.length}</span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} />
      </div>

      {loading ? (
        <div className="card-elevated p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-3 py-2 text-right">الكود</th>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">الوحدة</th>
                <th className="px-3 py-2 text-right w-40">الكمية الفعلية</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-border">
                  <td className="px-3 py-2">{it.product_code}</td>
                  <td className="px-3 py-2">{it.product_name}</td>
                  <td className="px-3 py-2">{it.unit ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={vals[it.id] ?? ""}
                      onChange={(e) => setVals((v) => ({ ...v, [it.id]: e.target.value }))}
                      disabled={sess?.status !== "counting"}
                      placeholder="0"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ConditionalLayout>
  );
}
