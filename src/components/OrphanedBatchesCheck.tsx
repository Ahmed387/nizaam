import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ShieldAlert, CheckCircle2 } from "lucide-react";

type OrphanRow = {
  product_id: string;
  product_name: string;
  orphan_batches: number;
  orphan_quantity_remaining: number;
};

export function OrphanedBatchesCheck() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrphanRow[] | null>(null);

  const runCheck = async () => {
    setLoading(true);
    setResult(null);
    const { data, error } = await supabase.rpc("detect_orphaned_batches" as any);
    setLoading(false);
    if (error) {
      toast.error("فشل الفحص: " + error.message);
      return;
    }
    const rows = (data ?? []) as OrphanRow[];
    setResult(rows);
    if (rows.length === 0) toast.success("لا توجد دفعات يتيمة ✅");
    else toast.warning(`تم العثور على ${rows.length} منتج به دفعات يتيمة`);
  };

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-bold">فحص الدفعات اليتيمة</h4>
          <p className="text-xs text-muted-foreground mt-1">
            يفحص وجود أي دفعات مخزون غير مرتبطة بفاتورة شراء (orphaned batches) قد تسبب أرقام مخزون خاطئة.
          </p>
        </div>
      </div>
      <Button onClick={runCheck} disabled={loading} variant="outline" className="gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
        تشغيل الفحص الآن
      </Button>

      {result && result.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          النظام نظيف — لا توجد دفعات يتيمة.
        </div>
      )}

      {result && result.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-right">المنتج</th>
                <th className="px-3 py-2 text-center">عدد الدفعات</th>
                <th className="px-3 py-2 text-center">الكمية المتبقية</th>
              </tr>
            </thead>
            <tbody>
              {result.map((r) => (
                <tr key={r.product_id} className="border-t">
                  <td className="px-3 py-2">{r.product_name}</td>
                  <td className="px-3 py-2 text-center">{r.orphan_batches}</td>
                  <td className="px-3 py-2 text-center">{r.orphan_quantity_remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
