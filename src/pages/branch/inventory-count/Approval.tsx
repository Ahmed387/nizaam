import { useEffect, useMemo, useState } from "react";
import { PermCard } from "@/contexts/PermCustomize";
import { PermTable } from "@/components/PermTable";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";
import { VariantLine } from "@/components/VariantChips";
import { rpcErrorText } from "@/lib/rpcError";

export default function Approval() {
  const { id: branchId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [sess, setSess] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 0267: approving is the company owner's (the server refuses anybody else)
  const allowed = isOwner;

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
    let match = 0, shortage = 0, surplus = 0, shortQty = 0, surQty = 0, shortVal = 0, surVal = 0;
    items.forEach((i) => {
      const d = Number(i.difference);
      const cost = Number(i.unit_cost ?? 0);
      if (d === 0) match++;
      else if (d < 0) { shortage++; shortQty += Math.abs(d); shortVal += Math.abs(d) * cost; }
      else { surplus++; surQty += d; surVal += d * cost; }
    });
    return { total: items.length, match, shortage, surplus, shortQty, surQty, shortVal, surVal };
  }, [items]);

  const approve = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("approve_inventory_session" as any, { p_session_id: sessionId });
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success("تم اعتماد الجرد وتطبيق الفروقات على المخزون");
    navigate(`/branch/${branchId}/inventory-count/${sessionId}/report`);
  };

  const reject = async () => {
    setSaving(true);
    const why = window.prompt("ليه بترجّعه للمراجعة؟ (هيظهر في ملاحظات الجرد)") ?? "";
    const { error } = await (supabase.rpc as any)("return_inventory_session", { p_session: sessionId, p_reason: why });
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success("الجرد رجع للمدير للمراجعة");
    navigate(`/branch/${branchId}/inventory-count`);
  };

  if (!allowed) {
    return (
      <ConditionalLayout title="اعتماد الجرد">
        <div className="card-elevated p-8 text-center text-muted-foreground">اعتماد الجرد لصاحب الشركة بس.</div>
      </ConditionalLayout>
    );
  }

  return (
    <ConditionalLayout
      title="اعتماد الجرد"
      subtitle="مراجعة الفروقات قبل التطبيق النهائي على المخزون"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <PermCard label="إجمالي المنتجات"><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">إجمالي المنتجات</div><div className="text-2xl font-bold">{stats.total}</div></div></PermCard>
        <PermCard label="مطابق"><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">مطابق</div><div className="text-2xl font-bold">{stats.match}</div></div></PermCard>
        <PermCard label="عجز"><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">عجز</div><div className="text-2xl font-bold text-red-500">{stats.shortage} <span className="text-sm font-normal">({stats.shortQty})</span></div></div></PermCard>
        <PermCard label="زيادة"><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">زيادة</div><div className="text-2xl font-bold text-emerald-500">{stats.surplus} <span className="text-sm font-normal">({stats.surQty})</span></div></div></PermCard>
        <PermCard label="قيمة العجز"><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">قيمة العجز (بمتوسط التكلفة)</div><div className="text-2xl font-bold text-red-500 tabular-nums">{Math.round(stats.shortVal).toLocaleString("en-EG")}</div></div></PermCard>
        <PermCard label="قيمة الزيادة"><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">قيمة الزيادة (بمتوسط التكلفة)</div><div className="text-2xl font-bold text-emerald-500 tabular-nums">{Math.round(stats.surVal).toLocaleString("en-EG")}</div></div></PermCard>
      </div>

      {loading ? (
        <div className="card-elevated p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <>
          <div className="card-elevated mb-4">
            <PermTable className="w-full text-sm">
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
                      <td className="px-3 py-2">{it.product_name}<VariantLine attrs={it as any} className="block mt-0.5" /></td>
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
            </PermTable>
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
