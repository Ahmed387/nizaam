import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";

export default function Approval() {
  const { id: branchId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const { hasRole, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [sess, setSess] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const allowed = isAdmin || hasRole("branch_manager");

  const load = async () => {
    if (!sessionId) return;
    setLoading(true);
    const [s, it] = await Promise.all([
      supabase.from("inventory_sessions" as any).select("*").eq("id", sessionId).maybeSingle(),
      supabase.from("inventory_session_items" as any).select("*").eq("session_id", sessionId).order("product_name"),
    ]);
    setSess(s.data);
    setItems((it.data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [sessionId]);

  const stats = useMemo(() => {
    let match = 0, shortage = 0, surplus = 0, shortQty = 0, surQty = 0;
    items.forEach((i) => {
      const d = Number(i.difference);
      if (d === 0) match++;
      else if (d < 0) { shortage++; shortQty += Math.abs(d); }
      else { surplus++; surQty += d; }
    });
    return { total: items.length, match, shortage, surplus, shortQty, surQty };
  }, [items]);

  const approve = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("approve_inventory_session" as any, { p_session_id: sessionId });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم اعتماد الجرد وتطبيق الفروقات على المخزون");
    navigate(`/branch/${branchId}/inventory-count/${sessionId}/report`);
  };

  const reject = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("inventory_sessions" as any)
      .update({ status: "reviewing" })
      .eq("id", sessionId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم إرجاع الجلسة للمحاسب");
    navigate(`/branch/${branchId}/inventory-count`);
  };

  if (!allowed) {
    return (
      <ConditionalLayout title="اعتماد الجرد">
        <div className="card-elevated p-8 text-center text-muted-foreground">هذه الصفحة للمدير فقط.</div>
      </ConditionalLayout>
    );
  }

  return (
    <ConditionalLayout
      title="اعتماد الجرد"
      subtitle="مراجعة الفروقات قبل التطبيق النهائي على المخزون"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">إجمالي المنتجات</div><div className="text-2xl font-bold">{stats.total}</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">مطابق</div><div className="text-2xl font-bold">{stats.match}</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">عجز</div><div className="text-2xl font-bold text-red-500">{stats.shortage} <span className="text-sm font-normal">({stats.shortQty})</span></div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">زيادة</div><div className="text-2xl font-bold text-emerald-500">{stats.surplus} <span className="text-sm font-normal">({stats.surQty})</span></div></div>
      </div>

      {loading ? (
        <div className="card-elevated p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <>
          <div className="card-elevated mb-4">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th className="px-3 py-2 text-right">الكود</th>
                  <th className="px-3 py-2 text-right">الاسم</th>
                  <th className="px-3 py-2 text-right">النظام</th>
                  <th className="px-3 py-2 text-right">الفعلي</th>
                  <th className="px-3 py-2 text-right">الفرق</th>
                  <th className="px-3 py-2 text-right">السبب</th>
                </tr>
              </thead>
              <tbody>
                {items.filter((i) => Number(i.difference) !== 0).map((it) => {
                  const d = Number(it.difference);
                  return (
                    <tr key={it.id} className={`border-t border-border ${d < 0 ? "bg-red-500/5" : "bg-emerald-500/5"}`}>
                      <td className="px-3 py-2">{it.product_code}</td>
                      <td className="px-3 py-2">{it.product_name}</td>
                      <td className="px-3 py-2">{Number(it.system_quantity)}</td>
                      <td className="px-3 py-2">{Number(it.actual_quantity ?? 0)}</td>
                      <td className={`px-3 py-2 font-bold ${d < 0 ? "text-red-500" : "text-emerald-500"}`}>{d > 0 ? `+${d}` : d}</td>
                      <td className="px-3 py-2">{it.reason ?? "—"}</td>
                    </tr>
                  );
                })}
                {items.filter((i) => Number(i.difference) !== 0).length === 0 && (
                  <tr><td colSpan={6} className="text-center text-muted-foreground p-6">لا توجد فروقات — كل الأصناف مطابقة</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={reject} disabled={saving || sess?.status !== "pending_approval"} className="gap-2">
              <X className="w-4 h-4" /> رفض وإرجاع للمحاسب
            </Button>
            <Button onClick={approve} disabled={saving || sess?.status !== "pending_approval"} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              اعتماد وتطبيق على المخزون
            </Button>
          </div>
        </>
      )}
    </ConditionalLayout>
  );
}
