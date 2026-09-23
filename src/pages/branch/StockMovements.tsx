import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatDateTime } from "@/lib/format";
import { ArrowRight } from "lucide-react";
import { normalizeForSearch } from "@/lib/search";

type Movement = {
  date: string;
  type: string;
  qty: number; // positive = in, negative = out
  reason: string;
  reference: string;
  party: string;
  linkTo?: string;
};


export default function StockMovements() {
  const { id: branchId, productId } = useParams<{ id: string; productId: string }>();
  const nav = useNavigate();
  const [product, setProduct] = useState<any>(null);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [pendingOutQty, setPendingOutQty] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: p } = await supabase.from("products").select("*").eq("id", productId!).maybeSingle();
      setProduct(p);

      // Sales (out) — only active invoices for this branch
      const { data: invItems } = await supabase
        .from("invoice_items")
        .select("quantity, invoice_id, invoices!inner(id, invoice_number, created_at, invoice_date, branch_id, status, contact_id, contacts:contact_id(name))")
        .eq("product_id", productId!);

      // Returns (in)
      const { data: retItems } = await supabase
        .from("return_items")
        .select("quantity, return_id, returns!inner(id, reason, return_number, created_at, invoice_date, branch_id, invoice_id, invoices:invoice_id(invoice_number, contacts:contact_id(name)))")
        .eq("product_id", productId!);



      // Shipments (in) — to this branch
      const { data: shipItems } = await supabase
        .from("shipment_items")
        .select("quantity, shipment_id, shipments!inner(id, arrival_date, invoice_date, created_at, branch_id, contact_id, contacts:contact_id(name))")
        .eq("product_id", productId!);

      // Purchase returns (out) — from this branch
      const { data: prItems } = await supabase
        .from("purchase_return_items")
        .select("quantity, purchase_return_id, purchase_returns!inner(id, return_number, reason, created_at, invoice_date, branch_id, contacts:contact_id(name))")
        .eq("product_id", productId!);

      // Opening stock batches (in) — initial quantity when product was created
      const { data: openingBatches } = await supabase
        .from("product_batches")
        .select("id, quantity_purchased, created_at, batch_type, branch_id")
        .eq("product_id", productId!)
        .eq("batch_type", "opening_stock");
      const { data: saItems } = await supabase
        .from("stock_adjustment_items")
        .select("difference, adjustment_id, stock_adjustments!inner(id, adjustment_number, reason, created_at, branch_id)")
        .eq("product_id", productId!);
      // تسويات الجرد (جلسات الجرد المعتمدة)
      const { data: invAdj } = await supabase
        .from("inventory_adjustments")
        .select("adjustment_amount, reason, created_at, session_id")
        .eq("product_id", productId!);

      // Transfers — confirmed only, where this branch is from or to.
      // Destination products are separate rows linked by name (see partial_confirm_transfer).
      // Match on normalized name / sku / legacy code so hamza, spacing or casing differences
      // never drop a movement.
      const { data: candidateProducts } = await supabase
        .from("products")
        .select("id, name, sku, legacy_code");
      const selfKeyName = normalizeForSearch(p?.name ?? "");
      const selfCodes = new Set(
        [p?.sku, (p as any)?.legacy_code].map((c) => normalizeForSearch(c)).filter(Boolean)
      );
      const matchedIds = ((candidateProducts ?? []) as any[])
        .filter((x) => {
          if (x.id === productId) return true;
          if (selfKeyName && normalizeForSearch(x.name) === selfKeyName) return true;
          const codes = [x.sku, x.legacy_code].map((c: any) => normalizeForSearch(c)).filter(Boolean);
          return codes.some((c: string) => selfCodes.has(c));
        })
        .map((x) => x.id);
      const productIds = Array.from(new Set([productId!, ...matchedIds]));

      const { data: transfers } = await supabase
        .from("stock_transfers")
        .select("id, quantity, received_quantity, status, created_at, confirmed_at, reason, from_branch_id, to_branch_id, product_id")
        .in("product_id", productIds)
        .eq("status", "confirmed")
        .or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`);

      // تحويلات معلقة صادرة — الكمية اتخصمت من رصيد الفرع بالفعل وبتستنى تأكيد المستلم
      const { data: pendingOut } = await supabase
        .from("stock_transfers")
        .select("id, quantity, created_at, reason, to_branch_id, product_id")
        .in("product_id", productIds)
        .eq("status", "pending")
        .eq("from_branch_id", branchId!);

      // Resolve branch names for transfer rows
      const branchIds = Array.from(new Set([
        ...(transfers ?? []).flatMap((t: any) => [t.from_branch_id, t.to_branch_id]),
        ...(pendingOut ?? []).map((t: any) => t.to_branch_id),
      ]));
      const { data: brs } = branchIds.length
        ? await supabase.from("branches").select("id, name").in("id", branchIds)
        : { data: [] as any[] };
      const brMap = new Map((brs ?? []).map((b: any) => [b.id, b.name]));

      const list: Movement[] = [];

      (invItems ?? []).forEach((it: any) => {
        const inv = it.invoices;
        if (!inv || inv.branch_id !== branchId || inv.status !== "active") return;
        list.push({
          date: inv.invoice_date ?? inv.created_at,
          type: "بيع",
          qty: -Number(it.quantity),
          reason: "—",
          reference: inv.invoice_number,
          party: inv.contacts?.name || "عميل نقدي",
          linkTo: `/branch/${branchId}/sales/${inv.id}`,
        });
      });

      (retItems ?? []).forEach((it: any) => {
        const r = it.returns;
        if (!r || r.branch_id !== branchId) return;
        list.push({
          date: r.invoice_date ?? r.created_at,
          type: "مرتجع",
          qty: Number(it.quantity),
          reason: r.reason ?? "—",
          reference: r.return_number ?? "RET",
          party: r.invoices?.contacts?.name || "عميل نقدي",
          linkTo: r.invoice_id ? `/branch/${branchId}/sales/${r.invoice_id}` : undefined,
        });
      });

      (shipItems ?? []).forEach((it: any) => {
        const s = it.shipments;
        if (!s || s.branch_id !== branchId) return;
        list.push({
          date: s.invoice_date ?? s.arrival_date ?? s.created_at,
          type: "فاتورة شراء واردة",
          qty: Number(it.quantity),
          reason: "—",
          reference: "SHIP",
          party: s.contacts?.name ?? "—",
          linkTo: `/branch/${branchId}/shipments/${s.id}`,
        });
      });

      (prItems ?? []).forEach((it: any) => {
        const r = it.purchase_returns;
        if (!r || r.branch_id !== branchId) return;
        list.push({
          date: r.invoice_date ?? r.created_at,
          type: "مرتجع شراء",
          qty: -Number(it.quantity),
          reason: r.reason ?? "—",
          reference: r.return_number ?? "PR",
          party: r.contacts?.name ?? "—",
          linkTo: `/branch/${branchId}/invoices?tab=purchase_return`,
        });
      });


      (saItems ?? []).forEach((it: any) => {
        const a = it.stock_adjustments;
        if (!a || a.branch_id !== branchId) return;
        const diff = Number(it.difference);
        if (!diff) return;
        list.push({
          date: a.created_at,
          type: "تسوية مخزون",
          qty: diff,
          reason: a.reason ?? "—",
          reference: a.adjustment_number ?? "ADJ",
          party: "—",
        });
      });

      (invAdj ?? []).forEach((a: any) => {
        const q = Number(a.adjustment_amount);
        if (!q) return;
        list.push({ date: a.created_at, type: "تسوية جرد", qty: q, reason: a.reason ?? "جلسة جرد معتمدة", reference: "COUNT", party: "—", linkTo: `/branch/${branchId}/inventory-count/${a.session_id}/report` });
      });

      (openingBatches ?? []).forEach((b: any) => {
        if (b.branch_id !== branchId) return;
        const q = Number(b.quantity_purchased);
        if (!q) return;
        list.push({
          date: b.created_at,
          type: "رصيد افتتاحي",
          qty: q,
          reason: "كمية ابتدائية عند إضافة المنتج",
          reference: "OPEN",
          party: "—",
        });
      });

      (transfers ?? []).forEach((t: any) => {
        // الكمية الفعلية المنقولة = المستلمة (لو فيه قبول جزئي الباقي رجع للمرسل)
        const actualQty = t.received_quantity != null ? Number(t.received_quantity) : Number(t.quantity);
        if (actualQty <= 0) return;
        const sent = Number(t.quantity);
        const partialNote = t.received_quantity != null && t.received_quantity !== sent
          ? ` (مرسل ${sent} / مستلم ${actualQty})` : "";
        if (t.from_branch_id === branchId) {
          list.push({
            date: t.confirmed_at ?? t.created_at,
            type: "نقل صادر",
            qty: -actualQty,
            reason: (t.reason ?? "—") + partialNote,
            reference: "TR-OUT",
            party: `إلى ${brMap.get(t.to_branch_id) ?? "—"}`,
            linkTo: `/branch/${branchId}/transfers/${t.id}`,
          });
        } else if (t.to_branch_id === branchId) {
          list.push({
            date: t.confirmed_at ?? t.created_at,
            type: "نقل وارد",
            qty: actualQty,
            reason: (t.reason ?? "—") + partialNote,
            reference: "TR-IN",
            party: `من ${brMap.get(t.from_branch_id) ?? "—"}`,
            linkTo: `/branch/${branchId}/transfers/${t.id}`,
          });
        }
      });

      // تحويلات معلقة صادرة: الكمية اتخصمت من الرصيد فعلاً — بنوثقها كحركة صادر واضحة
      let pendingTotal = 0;
      (pendingOut ?? []).forEach((t: any) => {
        const q = Number(t.quantity);
        if (!q) return;
        pendingTotal += q;
        list.push({
          date: t.created_at,
          type: "نقل صادر (معلق)",
          qty: -q,
          reason: `${t.reason ?? "—"} — بانتظار تأكيد الاستلام`,
          reference: "TR-PEND",
          party: `إلى ${brMap.get(t.to_branch_id) ?? "—"}`,
          linkTo: `/branch/${branchId}/transfers`,
        });
      });
      setPendingOutQty(pendingTotal);

      // رصيد غير موثق: الكمية الحالية أكبر/أقل مما تفسره الحركات المسجلة
      const net = list.reduce((s, m) => s + m.qty, 0);
      const gap = Number(p?.quantity ?? 0) - net;
      if (gap !== 0) {
        const oldest = list.reduce((d, m) => (m.date && m.date < d ? m.date : d), p?.created_at ?? new Date().toISOString());
        list.push({ date: oldest, type: "رصيد افتتاحي / غير موثق", qty: gap, reason: "فرق بين الرصيد الحالي والحركات المسجلة (رصيد قديم قبل التسجيل)", reference: "OPEN-GAP", party: "—" });
      }

      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setMoves(list);
      setLoading(false);
    })();
  }, [branchId, productId, tick]);

  useRealtimeRefresh(
    ["products", "inventory_adjustments", "invoice_items", "return_items", "shipment_items", "stock_transfers", "purchase_return_items", "stock_adjustment_items", "product_batches"],
    () => setTick((t) => t + 1)
  );

  const [typeFilter, setTypeFilter] = useState("all");
  const [fromD, setFromD] = useState("");
  const [toD, setToD] = useState("");
  const shown = moves.filter((m) => {
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    const d = (m.date ?? "").slice(0, 10);
    if (fromD && d < fromD) return false;
    if (toD && d > toD) return false;
    return true;
  });
  const types = Array.from(new Set(moves.map((m) => m.type)));
  const totalIn = shown.filter((m) => m.qty > 0).reduce((s, m) => s + m.qty, 0);
  const totalOut = shown.filter((m) => m.qty < 0).reduce((s, m) => s + Math.abs(m.qty), 0);

  const typeColor: Record<string, string> = {
    "بيع": "bg-destructive/15 text-destructive",
    "مرتجع": "bg-success/15 text-success",
    "فاتورة شراء واردة": "bg-success/15 text-success",
    "مرتجع شراء": "bg-destructive/15 text-destructive",
    "تسوية مخزون": "bg-muted text-foreground",
    "نقل صادر": "bg-warning/15 text-warning",
    "نقل وارد": "bg-primary/15 text-primary",
    "رصيد افتتاحي": "bg-success/15 text-success",
    "نقل صادر (معلق)": "bg-warning/15 text-warning",
    "تسوية جرد": "bg-muted text-foreground",
    "رصيد افتتاحي / غير موثق": "bg-primary/10 text-primary",
  };


  return (
    <BranchLayout backTo={`/branch/${branchId}/dashboard`} backLabel="القائمة الرئيسية">
      <PageHeader
        title={`حركة المخزون: ${product?.name ?? ""}`}
        subtitle={product ? `الكود: ${product.sku} · الكمية الحالية: ${product.quantity}${pendingOutQty > 0 ? ` · محجوز لتحويلات معلقة: ${pendingOutQty}` : ""}` : ""}
        actions={
          <Button variant="outline" onClick={() => nav(`/branch/${branchId}/inventory`)}>
            <ArrowRight className="w-4 h-4 ml-1" /> رجوع للمخزون
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground mb-1">إجمالي الوارد</div>
          <div className="text-2xl font-extrabold text-success">+{totalIn}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground mb-1">إجمالي الصادر</div>
          <div className="text-2xl font-extrabold text-destructive">-{totalOut}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground mb-1">صافي الحركة</div>
          <div className={`text-2xl font-extrabold ${totalIn - totalOut >= 0 ? "text-success" : "text-destructive"}`}>
            {totalIn - totalOut >= 0 ? "+" : ""}{totalIn - totalOut}
          </div>
        </div>
      </div>

      <div className="card-elevated p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">النوع
          <select className="block mt-1 h-9 rounded-md border border-input bg-background px-2" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">كل الأنواع</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-sm">من
          <input type="date" className="block mt-1 h-9 rounded-md border border-input bg-background px-2" value={fromD} onChange={(e) => setFromD(e.target.value)} />
        </label>
        <label className="text-sm">إلى
          <input type="date" className="block mt-1 h-9 rounded-md border border-input bg-background px-2" value={toD} onChange={(e) => setToD(e.target.value)} />
        </label>
        <Button variant="outline" size="sm" onClick={() => { setTypeFilter("all"); setFromD(""); setToD(""); }}>كل الوقت</Button>
        <span className="text-xs text-muted-foreground">{shown.length} حركة من {moves.length}</span>
      </div>

      <DataTable
        loading={loading}
        rows={shown}
        empty="لا توجد حركات لهذا المنتج"
        onRowClick={(r: any) => { if (r.linkTo) nav(r.linkTo); }}
        columns={[
          { key: "date", header: "التاريخ", render: (r: any) => formatDateTime(r.date) },
          { key: "type", header: "النوع", render: (r: any) => (
            <span className={`px-2 py-1 rounded text-xs font-bold ${typeColor[r.type] ?? "bg-muted"}`}>{r.type}</span>
          )},
          { key: "qty", header: "الكمية", render: (r: any) => (
            <span className={`font-bold ${r.qty > 0 ? "text-success" : "text-destructive"}`}>
              {r.qty > 0 ? "+" : ""}{r.qty}
            </span>
          )},
          { key: "party", header: "العميل / المورد", render: (r: any) => <span className="font-medium">{r.party}</span> },
          { key: "reason", header: "السبب / التفاصيل" },
          { key: "reference", header: "المرجع", render: (r: any) => (
            <span className={`font-mono text-xs ${r.linkTo ? "text-primary underline" : "text-muted-foreground"}`}>{r.reference}</span>
          ) },
        ]}
      />

    </BranchLayout>
  );
}
