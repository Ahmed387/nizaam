import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/DataTable";
import { Loader2, CalendarSearch, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import { exportElementToPdf } from "@/lib/inventoryPdf";

type Row = { product_id: string; sku: string; name: string; quantity_at_date: number };

export function HistoricalStockPanel({ branchId }: { branchId: string }) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const toLocal = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);

  const [fromAt, setFromAt] = useState<string>(toLocal(startOfMonth));
  const [toAt, setToAt] = useState<string>(toLocal(now));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<(Row & { qty_to: number; diff: number; supplier?: string | null; last_cost?: number | null; last_purchase_at?: string | null })[]>([]);
  const [search, setSearch] = useState("");
  const [ran, setRan] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const fromLabel = () => (fromAt ? formatDateTime(new Date(fromAt)) : "");
  const toLabel = () => (toAt ? formatDateTime(new Date(toAt)) : "");

  const run = async () => {
    if (!fromAt || !toAt) return toast.error("اختر التاريخ والوقت");
    const fromIso = new Date(fromAt).toISOString();
    const toIso = new Date(toAt).toISOString();
    if (new Date(fromIso) > new Date(toIso)) return toast.error("تاريخ البداية أكبر من النهاية");

    setLoading(true);
    const [{ data: dataFrom, error: e1 }, { data: dataTo, error: e2 }, { data: shipItems, error: e3 }] = await Promise.all([
      (supabase.rpc as any)("historical_stock_at", { _branch_id: branchId, _as_of: fromIso }),
      (supabase.rpc as any)("historical_stock_at", { _branch_id: branchId, _as_of: toIso }),
      supabase
        .from("shipment_items")
        .select("product_id, cost_price, shipments!inner(branch_id, created_at, contacts(name))")
        .eq("shipments.branch_id", branchId)
        .lte("shipments.created_at", toIso)
        .order("created_at", { referencedTable: "shipments", ascending: false })
        .limit(2000),
    ]);
    setLoading(false);
    if (e1 || e2 || e3) return toast.error((e1 || e2 || e3)!.message);

    const mapTo = new Map<string, number>();
    (dataTo ?? []).forEach((r: Row) => mapTo.set(r.product_id, Number(r.quantity_at_date)));

    // Latest purchase per product (within toIso)
    const lastShip = new Map<string, { supplier: string | null; cost: number; at: string }>();
    (shipItems ?? []).forEach((it: any) => {
      if (!it.product_id || !it.shipments) return;
      if (lastShip.has(it.product_id)) return; // already newest due to order desc
      lastShip.set(it.product_id, {
        supplier: it.shipments?.contacts?.name ?? null,
        cost: Number(it.cost_price),
        at: it.shipments.created_at,
      });
    });

    const merged = (dataFrom ?? []).map((r: Row) => {
      const qFrom = Number(r.quantity_at_date);
      const qTo = mapTo.get(r.product_id) ?? qFrom;
      const ls = lastShip.get(r.product_id);
      return {
        ...r,
        quantity_at_date: qFrom,
        qty_to: qTo,
        diff: qTo - qFrom,
        supplier: ls?.supplier ?? null,
        last_cost: ls?.cost ?? null,
        last_purchase_at: ls?.at ?? null,
      };
    });
    setRows(merged);
    setRan(true);
  };

  const filtered = rows.filter((r) => !search || r.name?.includes(search) || r.sku?.includes(search));

  const exportCsv = () => {
    const header = [
      "الكود",
      "الاسم",
      "الكمية من",
      "تاريخ البداية",
      "الكمية إلى",
      "تاريخ النهاية",
      "الفرق",
      "آخر مورد",
      "سعر آخر شراء",
      "تاريخ آخر شراء",
    ].join(",");
    const body = filtered
      .map((r) =>
        [
          r.sku,
          `"${(r.name ?? "").replace(/"/g, '""')}"`,
          r.quantity_at_date,
          `"${fromLabel()}"`,
          r.qty_to,
          `"${toLabel()}"`,
          r.diff > 0 ? `+${r.diff}` : r.diff,
          `"${(r.supplier ?? "").replace(/"/g, '""')}"`,
          r.last_cost ?? "",
          r.last_purchase_at ? `"${formatDateTime(r.last_purchase_at)}"` : "",
        ].join(",")
      )
      .join("\n");
    const csv = "\uFEFF" + header + "\n" + body;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historical-stock-${fromAt}_to_${toAt}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    if (!tableRef.current) return;
    try {
      await exportElementToPdf(tableRef.current, {
        filename: `historical-stock-${fromAt}_to_${toAt}.pdf`,
        sessionId: `${fromAt} → ${toAt}`,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "فشل تصدير PDF");
    }
  };

  return (
    <div className="card-elevated p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <CalendarSearch className="w-5 h-5 text-primary" />
        <h3 className="font-bold">رصيد المخزون خلال فترة</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        حدد تاريخ ووقت البداية والنهاية لمعرفة الكمية التي كانت موجودة لكل منتج في كل لحظة، ومقدار التغيّر بينهما.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">من (تاريخ ووقت)</Label>
          <Input type="datetime-local" value={fromAt} onChange={(e) => setFromAt(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">إلى (تاريخ ووقت)</Label>
          <Input type="datetime-local" value={toAt} onChange={(e) => setToAt(e.target.value)} className="mt-1" />
        </div>
        <Button onClick={run} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarSearch className="w-4 h-4" />}
          عرض الرصيد
        </Button>
        {ran && rows.length > 0 && (
          <>
            <Input
              placeholder="بحث بالاسم أو الكود"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button variant="outline" onClick={exportCsv} className="gap-2">
              <Download className="w-4 h-4" /> تصدير CSV
            </Button>
            <Button variant="outline" onClick={exportPdf} className="gap-2">
              <FileText className="w-4 h-4" /> تصدير PDF
            </Button>
          </>
        )}
      </div>

      {ran && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-2">
            من <span className="font-semibold">{formatDateTime(new Date(fromAt))}</span> إلى{" "}
            <span className="font-semibold">{formatDateTime(new Date(toAt))}</span>
          </div>
          <DataTable
            loading={loading}
            rows={filtered}
            empty="لا توجد منتجات في هذه الفترة"
            columns={[
              {
                key: "sku",
                header: "الكود",
                render: (r: any) => <span className="font-mono text-xs text-muted-foreground">{r.sku}</span>,
              },
              { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
              {
                key: "qty_from",
                header: "الكمية من",
                render: (r: any) => <span className="font-bold">{Number(r.quantity_at_date)}</span>,
              },
              {
                key: "date_from",
                header: "تاريخ البداية",
                render: () => <span className="text-xs text-muted-foreground">{formatDateTime(new Date(fromAt))}</span>,
              },
              {
                key: "qty_to",
                header: "الكمية إلى",
                render: (r: any) => <span className="font-bold">{Number(r.qty_to)}</span>,
              },
              {
                key: "date_to",
                header: "تاريخ النهاية",
                render: () => <span className="text-xs text-muted-foreground">{formatDateTime(new Date(toAt))}</span>,
              },
              {
                key: "diff",
                header: "الفرق",
                render: (r: any) => {
                  const d = Number(r.diff);
                  if (d === 0) return <span className="text-muted-foreground">0</span>;
                  return (
                    <span className={d > 0 ? "text-success font-bold" : "text-destructive font-bold"}>
                      {d > 0 ? `+${d}` : d}
                    </span>
                  );
                },
              },
              {
                key: "supplier",
                header: "آخر مورد",
                render: (r: any) =>
                  r.supplier ? <span>{r.supplier}</span> : <span className="text-muted-foreground">—</span>,
              },
              {
                key: "last_cost",
                header: "سعر آخر شراء",
                render: (r: any) =>
                  r.last_cost != null ? (
                    <span className="font-semibold">{Number(r.last_cost).toLocaleString("ar-EG")}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "last_purchase_at",
                header: "تاريخ آخر شراء",
                render: (r: any) =>
                  r.last_purchase_at ? (
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.last_purchase_at)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
