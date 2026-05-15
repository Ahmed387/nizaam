import { useEffect, useState, useMemo } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatEGP } from "@/lib/format";
import { PackageOpen, Search, Loader2, FileDown } from "lucide-react";
import { Link } from "react-router-dom";

interface Row {
  id: string;
  product_name: string;
  quantity: number;
  selling_price: number;
  total: number;
  price_list_cost: number | null;
  price_list_item_id: string | null;
  invoice: { id: string; invoice_number: string; created_at: string; branch_id: string } | null;
}

export default function OffStockSales() {
  const [rows, setRows] = useState<Row[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("invoice_items")
        .select("id, product_name, quantity, selling_price, total, price_list_cost, price_list_item_id, invoice:invoices!inner(id, invoice_number, created_at, branch_id, status)")
        .eq("is_off_stock", true)
        .order("created_at", { foreignTable: "invoices", ascending: false })
        .limit(2000);
      setRows((data ?? []) as any);
      const { data: b } = await supabase.from("branches").select("id, name");
      setBranches(Object.fromEntries((b ?? []).map((x: any) => [x.id, x.name])));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search && !r.product_name.toLowerCase().includes(search.toLowerCase()) && !r.invoice?.invoice_number?.includes(search)) return false;
      if (from && r.invoice && new Date(r.invoice.created_at) < new Date(from)) return false;
      if (to && r.invoice && new Date(r.invoice.created_at) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [rows, search, from, to]);

  const totals = useMemo(() => {
    const revenue = filtered.reduce((s, r) => s + Number(r.total || 0), 0);
    const cost = filtered.reduce((s, r) => s + (r.price_list_cost ? Number(r.price_list_cost) * r.quantity : 0), 0);
    const qty = filtered.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const knownCostRows = filtered.filter((r) => r.price_list_cost != null).length;
    return { revenue, cost, profit: revenue - cost, qty, knownCostRows, total: filtered.length };
  }, [filtered]);

  const exportCSV = () => {
    const header = ["التاريخ", "الفاتورة", "الفرع", "المنتج", "الكمية", "سعر البيع", "الإجمالي", "تكلفة (snapshot)", "ربح البند"];
    const rows2 = filtered.map((r) => [
      r.invoice?.created_at ? new Date(r.invoice.created_at).toLocaleString("ar-EG") : "",
      r.invoice?.invoice_number ?? "",
      branches[r.invoice?.branch_id ?? ""] ?? "",
      r.product_name,
      r.quantity,
      r.selling_price,
      r.total,
      r.price_list_cost ?? "",
      r.price_list_cost != null ? Number(r.total) - Number(r.price_list_cost) * r.quantity : "",
    ]);
    const csv = [header, ...rows2].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `off-stock-sales-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="مبيعات خارج المخزون"
        subtitle="بنود تم بيعها من قائمة أسعار الموردين بدون خصم من المخزون — أضف الأصناف المتكررة للمخزن"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="عدد البنود" value={String(totals.total)} />
        <Kpi label="إجمالي القطع" value={String(totals.qty)} />
        <Kpi label="إجمالي المبيعات" value={formatEGP(totals.revenue)} accent="primary" />
        <Kpi label="صافي الربح (للمعروف تكلفته)" value={formatEGP(totals.profit)} accent={totals.profit >= 0 ? "success" : "destructive"} />
      </div>

      <div className="card-elevated p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground">بحث</label>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="منتج / رقم فاتورة" className="pr-10" />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">من</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">إلى</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" onClick={exportCSV} className="gap-2">
          <FileDown className="w-4 h-4" /> تصدير CSV
        </Button>
      </div>

      <div className="card-elevated overflow-hidden">
        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">لا توجد مبيعات خارج المخزون</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs">
              <tr>
                <th className="p-2 text-right">التاريخ</th>
                <th className="p-2 text-right">الفاتورة</th>
                <th className="p-2 text-right">الفرع</th>
                <th className="p-2 text-right">المنتج</th>
                <th className="p-2">الكمية</th>
                <th className="p-2">سعر البيع</th>
                <th className="p-2">الإجمالي</th>
                <th className="p-2">تكلفة (snapshot)</th>
                <th className="p-2">الربح</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const profit = r.price_list_cost != null ? Number(r.total) - Number(r.price_list_cost) * r.quantity : null;
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-surface-2/50">
                    <td className="p-2 text-xs">{r.invoice?.created_at ? new Date(r.invoice.created_at).toLocaleString("ar-EG") : "-"}</td>
                    <td className="p-2 font-mono text-xs">
                      {r.invoice ? (
                        <Link to={`/branch/${r.invoice.branch_id}/sales/${r.invoice.id}`} className="text-primary hover:underline">{r.invoice.invoice_number}</Link>
                      ) : "-"}
                    </td>
                    <td className="p-2 text-xs">{branches[r.invoice?.branch_id ?? ""] ?? "-"}</td>
                    <td className="p-2 font-medium">{r.product_name}</td>
                    <td className="p-2 text-center">{r.quantity}</td>
                    <td className="p-2 text-center">{formatEGP(r.selling_price)}</td>
                    <td className="p-2 text-center font-bold">{formatEGP(r.total)}</td>
                    <td className="p-2 text-center text-muted-foreground">{r.price_list_cost != null ? formatEGP(Number(r.price_list_cost) * r.quantity) : "—"}</td>
                    <td className="p-2 text-center">
                      {profit == null ? <span className="text-muted-foreground text-xs">غير محدد</span> :
                        <span className={profit >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{formatEGP(profit)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "primary" | "success" | "destructive" }) {
  const cls = accent === "primary" ? "text-primary" : accent === "success" ? "text-success" : accent === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="card-elevated p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-xl font-extrabold ${cls}`}>{value}</div>
    </div>
  );
}
