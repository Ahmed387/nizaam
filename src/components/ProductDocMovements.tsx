import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, ExternalLink, Printer } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatEGP } from "@/lib/format";
import { exportToExcel, printReport } from "@/lib/export";
import { openDocs } from "@/lib/openDocs";
import { PrintDocButton } from "@/components/documents/MoneyCells";
import type { BulkKind } from "@/lib/bulkDocs";

/**
 * «حركة الصنف من المستندات» (owner 2026-11-11, migration 0200): every row is a real document of the item — sale / purchase
 * invoice, a return — with الوارد / الصادر and the running balance; what the documents do not explain is the first row
 * «رصيد أول المدة وتسويات», so the last balance always equals the item's quantity. Clicking a row opens its document.
 */
export interface ProductDocLine {
  line_no: number; line_date: string | null; line_time: string | null; kind: string; doc_number: string | null; contact_name: string | null;
  qty_in: number; qty_out: number; balance: number; unit_price: number | null; src_table: string | null; src_id: string | null;
  branch_id: string | null; branch_name: string | null;
}
/** tag name of the printed sheet's table (a print window, not a screen table) */
const T = "table";
const timeText = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${String(((h + 11) % 12) + 1).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "ص" : "م"}`;
};
const pathOf = (l: ProductDocLine): string | null => {
  if (!l.branch_id || !l.src_id) return null;
  const seg = l.src_table === "invoices" ? "sales" : l.src_table === "shipments" ? "shipments" : l.src_table === "returns" ? "sale-returns"
    : l.src_table === "purchase_returns" ? "purchase-returns" : null;
  return seg ? `/branch/${l.branch_id}/${seg}/${l.src_id}` : null;
};
const printKind = (l: ProductDocLine): BulkKind | null =>
  l.src_table === "invoices" ? "sale" : l.src_table === "shipments" ? "purchase" : l.src_table === "returns" ? "sale_return"
  : l.src_table === "purchase_returns" ? "purchase_return" : null;
const isSaleSide = (l: ProductDocLine) => l.src_table === "invoices" || l.src_table === "returns" || l.src_table === "prior_year_returns";

export function ProductDocMovements({ product, reloadKey }: { product: any; reloadKey?: unknown }) {
  const nav = useNavigate();
  const [lines, setLines] = useState<ProductDocLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [view, setView] = useState<ProductDocLine[] | null>(null);
  const productId: string | undefined = product?.id;

  useEffect(() => {
    if (!productId) return;
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      const out: ProductDocLine[] = [];
      try {
        for (let from = 0; ; from += 1000) {
          const { data, error: e } = await (supabase.rpc as any)("product_document_movements", { p_product: productId }).order("line_no").range(from, from + 999);
          if (e) throw e;
          out.push(...((data ?? []) as any[]).map((r) => ({ ...r, qty_in: Number(r.qty_in) || 0, qty_out: Number(r.qty_out) || 0, balance: Number(r.balance) || 0,
            unit_price: r.unit_price == null ? null : Number(r.unit_price) })));
          if ((data ?? []).length < 1000) break;
        }
        if (alive) { setLines(out); setPicked(new Set()); }
      } catch (e: any) { if (alive) { setLines([]); setError(e?.message ?? "تعذر تحميل حركة الصنف"); } }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [productId, reloadKey]);

  const rows = useMemo(() => lines.slice().reverse(), [lines]);
  const shown = view ?? rows;
  const chosen = useMemo(() => shown.filter((l) => picked.has(l.line_no)), [shown, picked]);
  const unit = Number(product?.pack_size) > 1 ? `${product?.pack_name ?? "كرتونة"} (${product.pack_size})` : "قطعة";
  const avg = Number(product?.avg_cost) > 0 ? Number(product.avg_cost) : Number(product?.cost_price) || 0;
  const totalIn = shown.reduce((s, l) => s + (l.line_no === 0 ? 0 : l.qty_in), 0), totalOut = shown.reduce((s, l) => s + (l.line_no === 0 ? 0 : l.qty_out), 0);

  const flat = (list: ProductDocLine[]) => list.slice().reverse().map((l) => ({
    "التاريخ": l.line_date ? formatDate(l.line_date) : "", "الوقت": l.line_time ? timeText(l.line_time) : "", "رقم الفاتورة": l.doc_number ?? "", "الحركة": l.kind,
    "الحساب": l.contact_name ?? "", "الرصيد": l.balance, "المخزن": l.branch_name ?? "", "الوارد": l.qty_in || "", "الصادر": l.qty_out || "",
    "سعر البيع": isSaleSide(l) && l.unit_price != null ? l.unit_price : "", "متوسط سعر الشراء": avg, "اخر سعر الشراء": !isSaleSide(l) && l.unit_price != null ? l.unit_price : "", "الوحدة": unit,
  }));
  const exportList = (list: ProductDocLine[]) => exportToExcel(`حركة_${product?.name ?? "صنف"}`, [{ name: "حركة الصنف", rows: flat(list) }]);
  const printList = (list: ProductDocLine[]) => {
    const f = flat(list); const keys = Object.keys(f[0] ?? {});
    printReport(`حركة الصنف ${product?.name ?? ""}`, `<h1>${product?.name ?? ""}</h1><div class="meta">الكود ${product?.sku ?? ""} · الكمية الحالية ${product?.quantity ?? ""}</div>
      <${T}><thead><tr>${keys.map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>${f.map((r: any) => `<tr>${keys.map((k) => `<td>${r[k] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></${T}>`, { landscape: true });
  };
  const openChosen = () => {
    const list = chosen.map((l) => ({ path: pathOf(l), label: l.doc_number ?? l.kind })).filter((d): d is { path: string; label: string } => !!d.path);
    if (!list.length) return toast.error("الحركات المحددة ملهاش مستند يتفتح");
    openDocs(list); toast.success(`اتفتح ${list.length} مستند فوق`);
  };

  return (
    <div className="space-y-3" data-testid="product-doc-movements">
      <div className="card-elevated p-3 flex flex-wrap items-center gap-4 text-sm">
        <span>الوارد: <b className="text-success tabular-nums">{totalIn}</b></span>
        <span>الصادر: <b className="text-destructive tabular-nums">{totalOut}</b></span>
        <span>سعر البيع الحالى: <b className="tabular-nums">{formatEGP(Number(product?.selling_price) || 0)}</b></span>
        <span>متوسط سعر الشراء: <b className="tabular-nums">{formatEGP(avg)}</b></span>
        <span>الوحدة: <b>{unit}</b></span>
        <span className="mr-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => printList(shown)}><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
          <Button variant="outline" size="sm" onClick={() => exportList(shown)}><Download className="w-4 h-4 ml-1" /> Excel</Button>
        </span>
      </div>
      {picked.size > 0 && (
        <div className="card-elevated p-2 flex flex-wrap items-center gap-2 border-primary/40 bg-primary/5 text-sm">
          <b>{picked.size} محدد</b>
          <Button size="sm" variant="outline" onClick={openChosen}><ExternalLink className="w-4 h-4 ml-1" /> فتح المحدد</Button>
          <Button size="sm" variant="outline" onClick={() => printList(chosen)}><Printer className="w-4 h-4 ml-1" /> طباعة المحدد</Button>
          <Button size="sm" variant="outline" onClick={() => exportList(chosen)}><Download className="w-4 h-4 ml-1" /> تصدير المحدد</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>إلغاء التحديد</Button>
        </div>
      )}
      {error && <div className="card-elevated p-3 text-sm text-destructive">تعذر تحميل حركة الصنف: {error}</div>}
      <DataTable
        loading={loading} rows={rows} onView={setView as any} indexColumn pageSize={50} permTable="pdocs" minTableWidth="1300px"
        getRowKey={(l: ProductDocLine) => String(l.line_no)} empty="لا توجد حركات"
        onRowClick={(l: ProductDocLine) => { const p = pathOf(l); if (p) nav(p); }}
        columns={[
          { key: "sel", header: "التحديد", filter: false, render: (l: ProductDocLine) => (l.line_no === 0 ? null : (
            <input type="checkbox" aria-label="تحديد الحركة" className="h-4 w-4 cursor-pointer" checked={picked.has(l.line_no)} onClick={(e) => e.stopPropagation()}
              onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(l.line_no)) n.delete(l.line_no); else n.add(l.line_no); return n; })} />
          )) },
          { key: "date", header: "التاريخ", render: (l: ProductDocLine) => (l.line_date ? formatDate(l.line_date) : "—") },
          { key: "time", header: "الوقت", render: (l: ProductDocLine) => <span className="tabular-nums text-xs">{timeText(l.line_time)}</span> },
          { key: "no", header: "رقم الفاتورة", render: (l: ProductDocLine) => <span className="font-mono text-xs">{l.doc_number ?? "—"}</span> },
          { key: "kind", header: "الحركة", render: (l: ProductDocLine) => <span className={l.line_no === 0 ? "font-bold" : ""}>{l.kind}</span> },
          { key: "contact", header: "الحساب", render: (l: ProductDocLine) => l.contact_name ?? (l.src_table === "invoices" ? "عميل نقدي" : "—") },
          { key: "balance", header: "الرصيد", total: false, render: (l: ProductDocLine) => <b className={`tabular-nums ${l.balance < 0 ? "text-destructive" : ""}`}>{l.balance}</b> },
          { key: "store", header: "المخزن", render: (l: ProductDocLine) => l.branch_name ?? "—" },
          { key: "in", header: "الوارد", render: (l: ProductDocLine) => (l.qty_in ? <span className="font-semibold text-success tabular-nums">{l.qty_in}</span> : "—") },
          { key: "out", header: "الصادر", render: (l: ProductDocLine) => (l.qty_out ? <span className="font-semibold text-destructive tabular-nums">{l.qty_out}</span> : "—") },
          { key: "sell", header: "سعر البيع", total: false, render: (l: ProductDocLine) => (isSaleSide(l) && l.unit_price != null ? formatEGP(l.unit_price) : "—") },
          { key: "avg", header: "متوسط سعر الشراء", total: false, render: () => formatEGP(avg) },
          { key: "last", header: "اخر سعر الشراء", total: false, render: (l: ProductDocLine) => (!isSaleSide(l) && l.unit_price != null ? formatEGP(l.unit_price) : "—") },
          { key: "unit", header: "الوحدة", render: () => unit },
          { key: "act", header: "الإجراءات", filter: false, render: (l: ProductDocLine) => {
            const p = pathOf(l), k = printKind(l);
            return p ? (
              <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                {k && l.src_id && <PrintDocButton kind={k} id={l.src_id} />}
                <Button size="sm" variant="ghost" className="h-7 text-xs" title="فتح المستند: التعديل والإلغاء من جواه" onClick={() => nav(p)}><ExternalLink className="w-3.5 h-3.5" /></Button>
              </div>
            ) : null;
          } },
        ]}
      />
    </div>
  );
}
