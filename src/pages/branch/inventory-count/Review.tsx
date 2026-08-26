import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { VariantLine } from "@/components/VariantChips";

export default function Review() {
  const { id: branchId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const { hasRole, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sess, setSess] = useState<any>(null);

  const allowed = isAdmin || hasRole("accountant");

  const load = async () => {
    if (!sessionId) return;
    setLoading(true);
    const [s, it] = await Promise.all([
      supabase.from("inventory_sessions" as any).select("*").eq("id", sessionId).maybeSingle(),
      supabase.from("inventory_session_items" as any).select("*").eq("session_id", sessionId).order("product_name"),
    ]);
    setSess(s.data);
    setItems((it.data as any) ?? []);
    const m: Record<string, string> = {};
    (it.data as any[] | null)?.forEach((r) => { m[r.id] = r.reason ?? ""; });
    setReasons(m);
    setLoading(false);
  };
  useEffect(() => { load(); }, [sessionId]);

  const summary = useMemo(() => {
    let match = 0, shortage = 0, surplus = 0;
    items.forEach((i) => {
      const d = Number(i.difference);
      if (d === 0) match++;
      else if (d < 0) shortage++;
      else surplus++;
    });
    return { match, shortage, surplus };
  }, [items]);

  const send = async () => {
    setSaving(true);
    for (const it of items) {
      const r = reasons[it.id] ?? "";
      if ((r ?? "") !== (it.reason ?? "")) {
        await supabase.from("inventory_session_items" as any).update({ reason: r }).eq("id", it.id);
      }
    }
    const { error } = await supabase
      .from("inventory_sessions" as any)
      .update({ status: "pending_approval", reviewed_at: new Date().toISOString() })
      .eq("id", sessionId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم إرسال الجرد للاعتماد");
    navigate(`/branch/${branchId}/inventory-count`);
  };

  if (!allowed) {
    return (
      <ConditionalLayout title="جرد الفرع">
        <div className="card-elevated p-8 text-center text-muted-foreground">هذه الصفحة للمحاسب فقط.</div>
      </ConditionalLayout>
    );
  }

  const diffColor = (d: number) => d === 0 ? "text-muted-foreground" : d < 0 ? "text-red-500 font-bold" : "text-emerald-500 font-bold";

  return (
    <ConditionalLayout
      title="مراجعة الفروقات"
      subtitle="أضف سبب الفرق ثم أرسل للاعتماد"
      actions={
        <Button onClick={send} disabled={saving || loading || sess?.status !== "reviewing"} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          إرسال للاعتماد
        </Button>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">مطابق</div><div className="text-2xl font-bold">{summary.match}</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">عجز</div><div className="text-2xl font-bold text-red-500">{summary.shortage}</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">زيادة</div><div className="text-2xl font-bold text-emerald-500">{summary.surplus}</div></div>
      </div>

      {loading ? (
        <div className="card-elevated p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="card-elevated">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-3 py-2 text-right">الكود</th>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">الوحدة</th>
                <th className="px-3 py-2 text-right">كمية النظام</th>
                <th className="px-3 py-2 text-right">الفعلي</th>
                <th className="px-3 py-2 text-right">الفرق</th>
                <th className="px-3 py-2 text-right w-64">السبب</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const d = Number(it.difference);
                const rowBg = d === 0 ? "" : d < 0 ? "bg-red-500/5" : "bg-emerald-500/5";
                return (
                  <tr key={it.id} className={`border-t border-border ${rowBg}`}>
                    <td className="px-3 py-2">{it.product_code}</td>
                    <td className="px-3 py-2">{it.product_name}<VariantLine attrs={it as any} className="block mt-0.5" /></td>
                    <td className="px-3 py-2">{it.unit ?? "—"}</td>
                    <td className="px-3 py-2">{Number(it.system_quantity)}</td>
                    <td className="px-3 py-2">{it.actual_quantity == null ? "—" : Number(it.actual_quantity)}</td>
                    <td className={`px-3 py-2 ${diffColor(d)}`}>{d > 0 ? `+${d}` : d}</td>
                    <td className="px-3 py-2">
                      <Input
                        value={reasons[it.id] ?? ""}
                        onChange={(e) => setReasons((r) => ({ ...r, [it.id]: e.target.value }))}
                        placeholder={d === 0 ? "—" : "سبب الفرق..."}
                        disabled={d === 0 || sess?.status !== "reviewing"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ConditionalLayout>
  );
}
