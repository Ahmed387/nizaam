import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { exportElementToPdf } from "@/lib/inventoryPdf";
import { Loader2, Download, Lock } from "lucide-react";
import { toast } from "sonner";

export default function Snapshot() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { tenant, isAdmin } = useAuth();
  const [sess, setSess] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId || !isAdmin) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const [s, it] = await Promise.all([
        supabase.from("inventory_sessions" as any).select("*, branches(name)").eq("id", sessionId).maybeSingle(),
        supabase.from("inventory_session_items" as any)
          .select("product_code, product_name, unit, system_quantity")
          .eq("session_id", sessionId)
          .order("product_name"),
      ]);
      const sd: any = s.data;
      if (sd?.created_by) {
        const p = await supabase.from("profiles").select("name").eq("id", sd.created_by).maybeSingle();
        sd.created_by_name = (p.data as any)?.name ?? "—";
      }
      setSess(sd);
      setItems((it.data as any) ?? []);
      setLoading(false);
    })();
  }, [sessionId, isAdmin]);

  if (!isAdmin) {
    return (
      <ConditionalLayout title="Snapshot الجرد">
        <div className="card-elevated p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
          <Lock className="w-8 h-8" />
          <div>هذه الصفحة متاحة لمدير الشركة فقط.</div>
        </div>
      </ConditionalLayout>
    );
  }

  const exportPdf = async () => {
    if (!ref.current || !sess) return;
    setExporting(true);
    try {
      const ts = new Date(sess.created_at);
      const date = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
      const warehouse = (sess.branches?.name ?? "warehouse").replace(/\s+/g, "_");
      await exportElementToPdf(ref.current, {
        filename: `Snapshot-${warehouse}-${date}.pdf`,
        sessionId: sess.id,
      });
      toast.success("تم تصدير الـ Snapshot");
    } catch (e: any) {
      toast.error(e.message ?? "فشل التصدير");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <ConditionalLayout title="Snapshot الجرد">
        <div className="card-elevated p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      </ConditionalLayout>
    );
  }
  if (!sess) {
    return (
      <ConditionalLayout title="Snapshot الجرد">
        <div className="card-elevated p-8 text-center text-muted-foreground">الجلسة غير موجودة</div>
      </ConditionalLayout>
    );
  }

  const totalQty = items.reduce((s, i) => s + Number(i.system_quantity || 0), 0);

  return (
    <ConditionalLayout
      title="Snapshot لحظة فتح الجرد"
      subtitle="لقطة ثابتة لكميات النظام عند بدء الجلسة — للمدير فقط"
      actions={
        <Button onClick={exportPdf} disabled={exporting} className="gap-2">
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          تحميل PDF
        </Button>
      }
    >
      <div ref={ref} dir="rtl" className="bg-white text-black p-8 rounded-xl shadow" style={{ fontFamily: "system-ui, 'Segoe UI', Tahoma, sans-serif" }}>
        <div className="flex items-start justify-between border-b-2 border-gray-300 pb-4 mb-6">
          <div className="flex items-center gap-3">
            {tenant?.logo_url && <img src={tenant.logo_url} alt="" className="w-16 h-16 object-contain" crossOrigin="anonymous" />}
            <div>
              <div className="text-2xl font-extrabold">{tenant?.name ?? "—"}</div>
              <div className="text-sm text-gray-600">Snapshot جرد الفرع — كميات النظام لحظة الفتح</div>
            </div>
          </div>
          <div className="text-sm text-left">
            <div>تاريخ الـ Snapshot: <b>{formatDateTime(sess.created_at)}</b></div>
            <div>تاريخ التحميل: <b>{formatDateTime(new Date())}</b></div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-6">
          <div><div className="text-gray-500">المخزن</div><div className="font-bold">{sess.branches?.name ?? "—"}</div></div>
          <div><div className="text-gray-500">فتح الجلسة</div><div className="font-bold">{sess.created_by_name ?? "—"}</div></div>
          <div><div className="text-gray-500">عدد الأصناف</div><div className="font-bold">{items.length}</div></div>
          <div><div className="text-gray-500">إجمالي الكميات</div><div className="font-bold">{totalQty}</div></div>
        </div>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-2 py-1 text-right">#</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الكود</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الاسم</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الوحدة</th>
              <th className="border border-gray-300 px-2 py-1 text-right">كمية النظام (Snapshot)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="border border-gray-300 px-2 py-1">{idx + 1}</td>
                <td className="border border-gray-300 px-2 py-1">{it.product_code}</td>
                <td className="border border-gray-300 px-2 py-1">{it.product_name}</td>
                <td className="border border-gray-300 px-2 py-1">{it.unit ?? "—"}</td>
                <td className="border border-gray-300 px-2 py-1 font-bold">{Number(it.system_quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 text-xs text-gray-500 border-t pt-3">
          🔒 هذه اللقطة ثابتة ولا تتأثر بأي حركات بيع/شراء/تحويل تمت بعد {formatDateTime(sess.created_at)}.
        </div>
      </div>
    </ConditionalLayout>
  );
}
