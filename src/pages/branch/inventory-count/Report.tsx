import { useEffect, useMemo, useRef, useState } from "react";
import { PermTable } from "@/components/PermTable";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { InventoryStatusBadge, INV_STATUS_LABELS } from "@/components/InventoryStatusBadge";
import { formatDateTime } from "@/lib/format";
import { exportElementToPdf } from "@/lib/inventoryPdf";
import { Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { VariantLine } from "@/components/VariantChips";

export default function Report() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { tenant, isAdmin, hasRole } = useAuth();
  const [sess, setSess] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const canExport = isAdmin || hasRole("branch_manager");

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      setLoading(true);
      const [sRes, itRes] = await Promise.all([
        supabase.from("inventory_sessions" as any).select("*, branches(name)").eq("id", sessionId).maybeSingle(),
        supabase.from("inventory_session_items" as any).select("*").eq("session_id", sessionId).order("product_name"),
      ]);
      const sd: any = sRes.data;
      if (sd?.created_by) {
        const p = await supabase.from("profiles").select("name").eq("id", sd.created_by).maybeSingle();
        sd.created_by_name = (p.data as any)?.name ?? "—";
      }
      if (sd?.approved_by) {
        const p = await supabase.from("profiles").select("name").eq("id", sd.approved_by).maybeSingle();
        sd.approved_by_name = (p.data as any)?.name ?? "—";
      }
      setSess(sd);
      setItems((itRes.data as any) ?? []);
      setLoading(false);
    })();
  }, [sessionId]);

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

  const exportPdf = async () => {
    if (!reportRef.current || !sess) return;
    setExporting(true);
    try {
      const ts = new Date(sess.created_at);
      const date = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
      const warehouse = (sess.branches?.name ?? "warehouse").replace(/\s+/g, "_");
      await exportElementToPdf(reportRef.current, {
        filename: `جرد-المخزن-${warehouse}-${date}.pdf`,
        sessionId: sess.id,
      });
      toast.success("تم تصدير التقرير");
    } catch (e: any) {
      toast.error(e.message ?? "فشل التصدير");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <ConditionalLayout title="تقرير جرد الفرع">
        <div className="card-elevated p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      </ConditionalLayout>
    );
  }
  if (!sess) {
    return (
      <ConditionalLayout title="تقرير جرد الفرع">
        <div className="card-elevated p-8 text-center text-muted-foreground">الجلسة غير موجودة</div>
      </ConditionalLayout>
    );
  }

  return (
    <ConditionalLayout
      title="تقرير جرد الفرع"
      subtitle={`جلسة بتاريخ ${formatDateTime(sess.created_at)}`}
      actions={
        canExport ? (
          <Button onClick={exportPdf} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            تصدير PDF
          </Button>
        ) : null
      }
    >
      <div ref={reportRef} dir="rtl" className="bg-white text-black p-8 rounded-xl shadow" style={{ fontFamily: "system-ui, 'Segoe UI', Tahoma, sans-serif" }}>
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-gray-300 pb-4 mb-6">
          <div className="flex items-center gap-3">
            {tenant?.logo_url && <img src={tenant.logo_url} alt="" className="w-16 h-16 object-contain" crossOrigin="anonymous" />}
            <div>
              <div className="text-2xl font-extrabold">{tenant?.name ?? "—"}</div>
              <div className="text-sm text-gray-600">تقرير جرد الفرع</div>
            </div>
          </div>
          <div className="text-sm text-left">
            <div>تاريخ الجلسة: <b>{formatDateTime(sess.created_at)}</b></div>
            <div>تاريخ التوليد: <b>{formatDateTime(new Date())}</b></div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-6">
          <div><div className="text-gray-500">المخزن</div><div className="font-bold">{sess.branches?.name ?? "—"}</div></div>
          <div><div className="text-gray-500">فتح الجلسة</div><div className="font-bold">{sess.created_by_name ?? "—"}</div></div>
          <div><div className="text-gray-500">الاعتماد</div><div className="font-bold">{sess.approved_by_name ?? "—"}</div></div>
          <div><div className="text-gray-500">الحالة</div><div className="font-bold">{INV_STATUS_LABELS[sess.status] ?? sess.status}</div></div>
        </div>

        {/* Table */}
        <PermTable className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-2 py-1 text-right">#</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الكود</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الاسم</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الوحدة</th>
              <th className="border border-gray-300 px-2 py-1 text-right">النظام</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الفعلي</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الفرق</th>
              <th className="border border-gray-300 px-2 py-1 text-right">الحالة</th>
              <th className="border border-gray-300 px-2 py-1 text-right">السبب</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const d = Number(it.difference);
              const label = d === 0 ? "مطابق" : d < 0 ? "نقص" : "زيادة";
              const color = d === 0 ? "" : d < 0 ? "color:#dc2626" : "color:#059669";
              return (
                <tr key={it.id}>
                  <td className="border border-gray-300 px-2 py-1">{idx + 1}</td>
                  <td className="border border-gray-300 px-2 py-1">{it.product_code}</td>
                  <td className="border border-gray-300 px-2 py-1">{it.product_name}<VariantLine attrs={it as any} className="block mt-0.5" /></td>
                  <td className="border border-gray-300 px-2 py-1">{it.unit ?? "—"}</td>
                  <td className="border border-gray-300 px-2 py-1">{Number(it.system_quantity)}</td>
                  <td className="border border-gray-300 px-2 py-1">{it.actual_quantity == null ? "—" : Number(it.actual_quantity)}</td>
                  <td className="border border-gray-300 px-2 py-1" style={{ ...(d !== 0 && { color: d < 0 ? "#dc2626" : "#059669", fontWeight: 700 }) }}>{d > 0 ? `+${d}` : d}</td>
                  <td className="border border-gray-300 px-2 py-1" style={{ ...(d !== 0 && { color: d < 0 ? "#dc2626" : "#059669" }) }}>{label}</td>
                  <td className="border border-gray-300 px-2 py-1">{it.reason ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </PermTable>

        {/* Summary */}
        <div className="border-t-2 border-gray-300 pt-4">
          <div className="font-bold mb-2">ملخص الجرد</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="border border-gray-300 p-3 rounded"><div className="text-gray-500">إجمالي المنتجات</div><div className="text-xl font-bold">{stats.total}</div></div>
            <div className="border border-gray-300 p-3 rounded"><div className="text-gray-500">مطابق</div><div className="text-xl font-bold">{stats.match}</div></div>
            <div className="border border-gray-300 p-3 rounded"><div className="text-gray-500">عجز</div><div className="text-xl font-bold" style={{ color: "#dc2626" }}>{stats.shortage} <span className="text-xs">({stats.shortQty} وحدة)</span></div></div>
            <div className="border border-gray-300 p-3 rounded"><div className="text-gray-500">زيادة</div><div className="text-xl font-bold" style={{ color: "#059669" }}>{stats.surplus} <span className="text-xs">({stats.surQty} وحدة)</span></div></div>
          </div>
          {sess.approved_at && (
            <div className="mt-4 text-sm">تم الاعتماد بواسطة <b>{sess.approved_by_name}</b> بتاريخ <b>{formatDateTime(sess.approved_at)}</b></div>
          )}
        </div>
      </div>

      <div className="mt-4 text-center">
        <InventoryStatusBadge status={sess.status} />
      </div>
    </ConditionalLayout>
  );
}
