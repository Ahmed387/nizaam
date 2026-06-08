import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/DataTable";
import { Loader2, CalendarSearch, Download } from "lucide-react";
import { toast } from "sonner";

export function HistoricalStockPanel({ branchId }: { branchId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(today);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [ran, setRan] = useState(false);

  const run = async () => {
    if (!date) return toast.error("اختر التاريخ");
    setLoading(true);
    // end of selected day
    const asOf = new Date(`${date}T23:59:59.999`).toISOString();
    const { data, error } = await (supabase.rpc as any)("historical_stock_at", {
      _branch_id: branchId,
      _as_of: asOf,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setRows(data ?? []);
    setRan(true);
  };

  const exportCsv = () => {
    const header = "الكود,الاسم,الكمية بتاريخ " + date;
    const body = filtered.map((r: any) => `${r.sku},"${r.name}",${r.quantity_at_date}`).join("\n");
    const csv = "\uFEFF" + header + "\n" + body;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `historical-stock-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = rows.filter((r: any) =>
    !search || r.name?.includes(search) || r.sku?.includes(search)
  );

  return (
    <div className="card-elevated p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <CalendarSearch className="w-5 h-5 text-primary" />
        <h3 className="font-bold">رصيد المخزون في تاريخ سابق</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        اختر تاريخًا لعرض الكمية الفعلية لكل منتج كما كانت في نهاية ذلك اليوم — ثم قارنها بالموجود على أرض الواقع.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">حتى نهاية يوم</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
        </div>
        <Button onClick={run} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarSearch className="w-4 h-4" />}
          عرض الرصيد
        </Button>
        {ran && rows.length > 0 && (
          <>
            <Input placeholder="بحث بالاسم أو الكود" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <Button variant="outline" onClick={exportCsv} className="gap-2">
              <Download className="w-4 h-4" /> تصدير CSV
            </Button>
          </>
        )}
      </div>

      {ran && (
        <div className="mt-4">
          <DataTable
            loading={loading}
            rows={filtered}
            empty="لا توجد منتجات بهذا التاريخ"
            columns={[
              { key: "sku", header: "الكود", render: (r: any) => <span className="font-mono text-xs text-muted-foreground">{r.sku}</span> },
              { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
              { key: "quantity_at_date", header: `الكمية بتاريخ ${date}`, render: (r: any) => <span className="font-bold">{Number(r.quantity_at_date)}</span> },
            ]}
          />
        </div>
      )}
    </div>
  );
}
