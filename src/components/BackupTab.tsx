import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Loader2, DatabaseBackup } from "lucide-react";
import * as XLSX from "xlsx";

const TABLES: { key: string; label: string }[] = [
  { key: "branches", label: "الفروع" },
  { key: "categories", label: "التصنيفات" },
  { key: "products", label: "المنتجات" },
  { key: "price_list_sources", label: "موردين قائمة الأسعار" },
  { key: "price_list_items", label: "أصناف قائمة الأسعار" },
  { key: "customers", label: "العملاء" },
  { key: "employees", label: "الموظفين" },
  { key: "invoices", label: "الفواتير" },
  { key: "invoice_items", label: "أصناف الفواتير" },
  { key: "invoice_payments", label: "مدفوعات الفواتير" },
  { key: "returns", label: "المرتجعات" },
  { key: "return_items", label: "أصناف المرتجعات" },
  { key: "pre_orders", label: "طلبات الحجز" },
  { key: "payment_plans", label: "خطط السداد" },
  { key: "payment_installments", label: "الأقساط" },
  { key: "payment_transactions", label: "حركات السداد" },
  { key: "treasury", label: "حركات الخزينة" },
  { key: "treasury_transfers", label: "تحويلات الخزينة" },
  { key: "vouchers", label: "السندات المالية" },
  { key: "voucher_categories", label: "تصنيفات السندات" },
  { key: "advances", label: "السلف" },
  { key: "advance_payments", label: "أقساط السلف" },
  { key: "advance_requests", label: "طلبات السلف" },
  { key: "salaries", label: "الرواتب" },
  { key: "attendance", label: "الحضور" },
  { key: "audit_log", label: "سجل العمليات" },
];

export function BackupTab() {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const exportAll = async (format: "xlsx" | "json") => {
    setExporting(true);
    try {
      const all: Record<string, any[]> = {};
      for (const t of TABLES) {
        setProgress(`تصدير ${t.label}...`);
        let from = 0;
        const pageSize = 1000;
        const rows: any[] = [];
        while (true) {
          const { data, error } = await supabase.from(t.key as any).select("*").range(from, from + pageSize - 1);
          if (error) {
            console.warn(`Failed ${t.key}:`, error.message);
            break;
          }
          rows.push(...(data ?? []));
          if (!data || data.length < pageSize) break;
          from += pageSize;
        }
        all[t.key] = rows;
      }

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

      if (format === "xlsx") {
        setProgress("جاري بناء ملف Excel...");
        const wb = XLSX.utils.book_new();
        for (const t of TABLES) {
          const rows = all[t.key] ?? [];
          const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "لا توجد بيانات": "" }]);
          // sheet names max 31 chars and must avoid : \ / ? * [ ]
          const safe = t.label.slice(0, 31).replace(/[:\\/?*[\]]/g, " ");
          XLSX.utils.book_append_sheet(wb, ws, safe);
        }
        XLSX.writeFile(wb, `nexa-backup-${stamp}.xlsx`);
      } else {
        setProgress("جاري بناء ملف JSON...");
        const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), data: all }, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nexa-backup-${stamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast.success("تم تصدير النسخة الاحتياطية");
    } catch (e: any) {
      toast.error(e.message ?? "خطأ في التصدير");
    } finally {
      setExporting(false);
      setProgress("");
    }
  };

  return (
    <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-start gap-3">
        <DatabaseBackup className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <div>
          <h2 className="font-bold">نسخة احتياطية شاملة لكل بيانات الشركة</h2>
          <p className="text-sm text-muted-foreground mt-1">
            هينزّل ملف فيه كل البيانات (فروع، فواتير، خزينة، موظفين، عملاء، ... إلخ) لكل الفروع.
            احفظه في مكان آمن — مفيد للأرشيف والمراجعة.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button onClick={() => exportAll("xlsx")} disabled={exporting} className="gap-2" size="lg">
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          تصدير Excel (XLSX)
        </Button>
        <Button onClick={() => exportAll("json")} disabled={exporting} variant="outline" className="gap-2" size="lg">
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          تصدير JSON (للمطورين)
        </Button>
      </div>

      {progress && <p className="text-sm text-muted-foreground text-center">{progress}</p>}

      <div className="text-xs text-muted-foreground bg-surface-2 p-3 rounded">
        <b>ملاحظات:</b>
        <ul className="list-disc pr-5 mt-1 space-y-1">
          <li>التصدير بيلتزم بصلاحيات حسابك — Admin يقدر يصدّر كل البيانات.</li>
          <li>الملف بيتنزّل على جهازك مباشرة، احفظه في مكان آمن.</li>
          <li>عدد الجداول: {TABLES.length} جدول.</li>
        </ul>
      </div>
    </div>
  );
}
