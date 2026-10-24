import { useEffect, useState } from "react";
import { PermTable } from "@/components/PermTable";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { Loader2, Package, Phone, User, Calendar, ClipboardList, Truck, Receipt, XCircle, Printer, ArrowRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CancelPurchaseDialog } from "@/components/CancelPurchaseDialog";
import { useAuth } from "@/contexts/AuthContext";
import { ColorChip } from "@/components/ColorPicker";
import { printHtml } from "@/lib/export";
import { ThermalReceiptPrint, printThermalInvoice } from "@/components/ThermalReceiptPrint";
import { RecordAttachments } from "@/components/RecordAttachments";
import { EditableInvoiceDate } from "@/components/EditableInvoiceDate";
import { ClickableImagePreview } from "@/components/ClickableImagePreview";
import { VariantLine } from "@/components/VariantChips";
import { ShipmentPaymentsPanel } from "@/components/ShipmentPaymentsPanel";
import { fetchContactStatement, fetchDocumentStatus, sideBalanceLabel } from "@/lib/ledger";
import { DocumentMoneyMovements } from "@/components/payments/DocumentMoneyMovements";

const escapeHtml = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export default function ShipmentView() {
  const { id: branchId, shipmentId } = useParams<{ id: string; shipmentId: string }>();
  const nav = useNavigate();
  const { isAdmin, hasRole } = useAuth();
  const isManager = hasRole("branch_manager");
  const canCancelDoc = isAdmin || isManager;
  const canEdit = isAdmin || isManager;
  const [ship, setShip] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Supplier balance around this purchase invoice, from the supplier side of the unified ledger
  // (company-wide statement; the customer side of the same contact is never mixed in).
  const [liveBal, setLiveBal] = useState<{ prev: number; curr: number } | null>(null);
  const [docStatus, setDocStatus] = useState<{ paid: number; remaining: number; state: string } | null>(null);
  useEffect(() => {
    if (!ship?.id) { setDocStatus(null); return; }
    fetchDocumentStatus("shipment", [ship.id]).then((m) => setDocStatus(m.get(ship.id) ?? null)).catch(() => setDocStatus(null));
  }, [ship?.id, ship?.total_cost]);
  useEffect(() => {
    if (!ship?.contact_id) { setLiveBal(null); return; }
    let cancelled = false;
    // company-wide for admins; branch staff see this branch's supplier statement
    fetchContactStatement(ship.contact_id, "supplier", isAdmin ? null : ship.branch_id).then((lines) => {
      if (cancelled) return;
      const row = lines.find((r) => r.doc_type === "shipment" && r.doc_id === ship.id);
      if (!row) { setLiveBal(null); return; }
      setLiveBal({ curr: row.balance, prev: Math.round((row.balance - row.debit + row.credit) * 100) / 100 });
    }).catch(() => { if (!cancelled) setLiveBal(null); });
    return () => { cancelled = true; };
  }, [ship?.contact_id, ship?.id, ship?.total_cost, isAdmin]);

  const loadShipment = async () => {
    const { data: s } = await supabase.from("shipments").select("*, contacts:contact_id(name, phone, address)").eq("id", shipmentId!).maybeSingle();
    const { data: it } = await supabase
      .from("shipment_items")
      .select("*, products(name, sku, selling_price, quantity, image, low_stock_alert)")
      .eq("shipment_id", shipmentId!);
    setShip(s);
    setItems(it ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadShipment();
    // realtime: refresh when admin edits this shipment from another tab
    const ch = supabase
      .channel(`ship-view-${shipmentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shipments", filter: `id=eq.${shipmentId}` }, () => loadShipment())
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_items", filter: `shipment_id=eq.${shipmentId}` }, () => loadShipment())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [shipmentId]);

  if (loading) return <BranchLayout><div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></BranchLayout>;
  if (!ship) return <BranchLayout><div className="text-center p-12 text-muted-foreground">فاتورة شراء غير موجودة</div></BranchLayout>;
  const isCancelled = ship.status === "cancelled";

  const customs = Number(ship.customs_cost ?? 0);
  const otherCost = Number(ship.other_cost ?? 0);
  const totalExtras = Number(ship.total_extra_costs ?? 0) || (Number(ship.shipping_cost ?? 0) + customs + otherCost);
  const invoiceDiscount = Number((ship as any).discount_amount ?? 0);
  const vatAmount = Number((ship as any).vat_amount ?? 0);
  const goodsValue = ship.total_cost - ship.shipping_cost - customs - otherCost - ship.admin_cost - vatAmount + invoiceDiscount;
  const itemsGross = items.reduce((s, it) => s + Number(it.quantity) * Number(it.cost_price), 0);
  const itemsDiscount = itemsGross - items.reduce((s, it) => s + Number(it.total ?? 0), 0);

  const handlePrint = () => {
    const rowsHtml = items.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.product_name ?? "")}</td>
        <td>${escapeHtml(it.products?.sku ?? "—")}</td>
        <td>${it.quantity}</td>
        <td>${formatEGP(it.cost_price)}</td>
        <td>${Number(it.discount_percent ?? 0) > 0 ? Number(it.discount_percent) + "%" : "—"}</td>
        <td>${Number(it.discount_amount ?? 0) > 0 ? formatEGP(it.discount_amount) : "—"}</td>
        <td><b>${formatEGP(it.total ?? 0)}</b></td>
      </tr>`).join("");

    const body = `
      <h1>فاتورة شراء ${escapeHtml(ship.shipment_number ?? "#" + ship.id.slice(0,8))}</h1>
      <div class="meta">تاريخ الوصول: ${formatDate(ship.arrival_date)} · أُنشئت: ${formatDate(ship.created_at)}</div>

      <div class="grid-3">
        <div class="card">
          <h3 style="margin-top:0">بيانات المورد</h3>
          <div class="row"><span>الاسم</span><b>${escapeHtml(ship.contacts?.name ?? "—")}</b></div>
          <div class="row"><span>الهاتف</span><b>${escapeHtml(ship.contacts?.phone ?? "—")}</b></div>
          ${ship.contacts?.address ? `<div class="row"><span>العنوان</span><b>${escapeHtml(ship.contacts.address)}</b></div>` : ""}
        </div>
        <div class="card">
          <h3 style="margin-top:0">الاستلام</h3>
          <div class="row"><span>المستلم</span><b>${escapeHtml(ship.received_by ?? "—")}</b></div>
          <div class="row"><span>تاريخ الوصول</span><b>${formatDate(ship.arrival_date)}</b></div>
          ${ship.notes ? `<div class="row"><span>ملاحظات</span><b>${escapeHtml(ship.notes)}</b></div>` : ""}
        </div>
        <div class="card">
          <h3 style="margin-top:0">التكاليف</h3>
          <div class="row"><span>قيمة البضاعة</span><b>${formatEGP(itemsGross)}</b></div>
          ${itemsDiscount > 0 ? `<div class="row"><span>الخصومات</span><b class="neg">− ${formatEGP(itemsDiscount)}</b></div>` : ""}
          <div class="row"><span>صافي البضاعة</span><b>${formatEGP(goodsValue)}</b></div>
          ${invoiceDiscount > 0 ? `<div class="row"><span>خصم على الفاتورة${(ship as any).discount_type === "percent" ? ` (${Number((ship as any).discount_value)}%)` : ""}</span><b class="neg">− ${formatEGP(invoiceDiscount)}</b></div>` : ""}
          <div class="row"><span>الشحن</span><b>${formatEGP(ship.shipping_cost)}</b></div>
          <div class="row"><span>إدارية</span><b>${formatEGP(ship.admin_cost)}</b></div>
          ${vatAmount > 0 ? `<div class="row"><span>ضريبة القيمة المضافة${(ship as any).vat_type === "percent" ? ` (${Number((ship as any).vat_value)}%)` : ""}</span><b>${formatEGP(vatAmount)}</b></div>` : ""}
          <div class="row" style="border-top:1px solid #ddd;padding-top:6px;margin-top:6px"><span><b>الإجمالي</b></span><b style="color:#3b82f6;font-size:15px">${formatEGP(ship.total_cost)}</b></div>
        </div>
      </div>

      <h2>المنتجات (${items.length})</h2>
      <PermTable>
        <thead>
          <tr>
            <th>#</th><th>المنتج</th><th>الكود</th><th>الكمية</th>
            <th>سعر التكلفة</th><th>خصم %</th><th>خصم مبلغ</th><th>الصافي</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </PermTable>
    `;
    printHtml(`فاتورة شراء ${ship.shipment_number ?? ship.id.slice(0,8)}`, body, { landscape: true });
  };

  return (
    <BranchLayout>
      <PageHeader
        title={`فاتورة شراء ${ship.shipment_number ?? `#${ship.id.slice(0, 8)}`}`}
        subtitle={formatDate(ship.arrival_date)}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => nav(`/branch/${branchId}/invoices?tab=purchase`)} className="gap-2">
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
              <Printer className="w-4 h-4" /> تحميل PDF للفاتورة
            </Button>
            <Button size="sm" onClick={printThermalInvoice} className="gap-2 btn-gradient">
              <Printer className="w-4 h-4" /> طباعة الفاتورة
            </Button>
            {canEdit && !isCancelled && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => nav(`/branch/${branchId}/shipments/${ship.id}/edit`)}>
                <Pencil className="w-4 h-4" /> {isAdmin ? "التعديل على الفاتورة" : "طلب تعديل على الفاتورة"}
              </Button>
            )}
            {canCancelDoc && !isCancelled && (
              <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setCancelOpen(true)}>
                <XCircle className="w-4 h-4" /> {isAdmin ? "إلغاء الفاتورة" : "طلب إلغاء الفاتورة"}
              </Button>
            )}
          </div>
        }
      />

      {isCancelled && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <b className="text-destructive">فاتورة ملغاة</b>
          {ship.cancelled_at && <> — بتاريخ {formatDate(ship.cancelled_at)}</>}
          {ship.cancel_reason && <> — السبب: {ship.cancel_reason}</>}
          <div className="text-xs text-muted-foreground mt-1">كمياتها خرجت من المخزن وقيدها اتعكس، وهي خارج كشف حساب المورد.</div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="card-elevated p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Truck className="w-4 h-4 text-primary" /></div>
            <h3 className="font-bold text-sm">بيانات المورد</h3>
          </div>
          <div className="text-sm space-y-2">
            <div className="flex items-center gap-2"><Package className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">الاسم:</span> <b>{ship.contacts?.name ?? "—"}</b></div>
            <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">الهاتف:</span> {ship.contacts?.phone ?? "—"}</div>
            {ship.contacts?.address && <div className="flex items-center gap-2"><ClipboardList className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">العنوان:</span> {ship.contacts.address}</div>}
          </div>

        </div>

        <div className="card-elevated p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><User className="w-4 h-4 text-primary" /></div>
            <h3 className="font-bold text-sm">بيانات الاستلام</h3>
          </div>
          <div className="text-sm space-y-2">
            <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">المستلم:</span> <b>{ship.received_by}</b></div>
            <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">تاريخ فاتورة الشراء:</span> <EditableInvoiceDate table="shipments" recordId={ship.id} value={ship.invoice_date} fallback={ship.created_at} onSaved={(d) => setShip({ ...ship, invoice_date: d })} /></div>
            <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">تاريخ الوصول:</span> {formatDate(ship.arrival_date)}</div>
            <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">تاريخ الإنشاء:</span> {formatDate(ship.created_at)}</div>
            {ship.notes && <div className="flex items-start gap-2"><ClipboardList className="w-3.5 h-3.5 text-muted-foreground mt-0.5" /><span className="text-muted-foreground">ملاحظات:</span> <span className="text-xs">{ship.notes}</span></div>}
          </div>
        </div>

        <div className="card-elevated p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Receipt className="w-4 h-4 text-primary" /></div>
            <h3 className="font-bold text-sm">التكاليف</h3>
          </div>
          <div className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-muted-foreground">قيمة البضاعة (قبل الخصم)</span><b className="font-mono tabular-nums" dir="ltr">{formatEGP(itemsGross)}</b></div>
            {itemsDiscount > 0 && (
              <div className="flex justify-between text-destructive"><span>إجمالي الخصومات</span><b className="font-mono tabular-nums" dir="ltr">− {formatEGP(itemsDiscount)}</b></div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">صافي البضاعة</span><b className="font-mono tabular-nums" dir="ltr">{formatEGP(goodsValue)}</b></div>
            {invoiceDiscount > 0 && (
              <div className="flex justify-between text-destructive">
                <span>خصم على الفاتورة{(ship as any).discount_type === "percent" ? ` (${Number((ship as any).discount_value)}%)` : ""}</span>
                <b className="font-mono tabular-nums" dir="ltr">− {formatEGP(invoiceDiscount)}</b>
              </div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">الشحن</span><b className="font-mono tabular-nums" dir="ltr">{formatEGP(ship.shipping_cost)}</b></div>
            {customs > 0 && <div className="flex justify-between"><span className="text-muted-foreground">الجمارك</span><b className="font-mono tabular-nums" dir="ltr">{formatEGP(customs)}</b></div>}
            {otherCost > 0 && <div className="flex justify-between"><span className="text-muted-foreground">مصاريف أخرى {ship.other_cost_description ? `(${ship.other_cost_description})` : ""}</span><b className="font-mono tabular-nums" dir="ltr">{formatEGP(otherCost)}</b></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">إدارية</span><b className="font-mono tabular-nums" dir="ltr">{formatEGP(ship.admin_cost)}</b></div>
            {vatAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">ضريبة القيمة المضافة{(ship as any).vat_type === "percent" ? ` (${Number((ship as any).vat_value)}%)` : ""}</span>
                <b className="font-mono tabular-nums" dir="ltr">{formatEGP(vatAmount)}</b>
              </div>
            )}
            <div className="border-t border-border pt-2 flex justify-between text-lg"><span>الإجمالي</span><b className="text-primary font-mono tabular-nums font-extrabold" dir="ltr">{formatEGP(ship.total_cost)}</b></div>
          </div>
        </div>
      </div>

      {/* Supplier balance snapshot — captured at shipment creation */}
      {ship.contact_id && liveBal && (() => {
        const prevLbl = sideBalanceLabel("supplier", liveBal.prev);
        const currLbl = sideBalanceLabel("supplier", liveBal.curr);
        return (
          <div className="card-elevated p-4 mb-6">
            <div className="font-bold text-sm mb-2">📒 حساب المورد {isAdmin ? "(كل الفروع)" : "(الفرع ده)"} — من الدفتر الموحد</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-surface-2 p-2 rounded border border-border">
                <div className="text-xs text-muted-foreground">الرصيد السابق</div>
                <div className="font-bold">{formatEGP(prevLbl.amount)}</div>
                <div className={`text-xs ${prevLbl.tone === "good" ? "text-success" : prevLbl.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>{prevLbl.label}</div>
              </div>
              <div className="bg-surface-2 p-2 rounded border border-border">
                <div className="text-xs text-muted-foreground">الرصيد بعد فاتورة الشراء</div>
                <div className="font-bold">{formatEGP(currLbl.amount)}</div>
                <div className={`text-xs ${currLbl.tone === "good" ? "text-success" : currLbl.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>{currLbl.label}</div>
              </div>
            </div>
          </div>
        );
      })()}

      <ShipmentPaymentsPanel shipmentId={ship.id} canEdit={canEdit} onChanged={loadShipment} />


      <div className="card-elevated overflow-hidden">
        <div className="p-4 border-b border-border font-bold flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          المنتجات ({items.length})
        </div>
        <div className="overflow-x-auto">
          <PermTable className="w-full text-sm min-w-[980px] border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b-2 border-border">
                <th className="px-4 py-3 text-right font-bold text-xs text-muted-foreground uppercase tracking-wide w-[26%]">المنتج</th>
                <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide w-[12%]">الكود</th>
                <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide w-[7%]">الكمية</th>
                <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide">سعر التكلفة</th>
                {totalExtras > 0 && <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide">نصيب الشحن/الوحدة</th>}
                {totalExtras > 0 && <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide">التكلفة الحقيقية/الوحدة</th>}
                <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide">خصم %</th>
                <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide">خصم مبلغ</th>
                <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide">سعر البيع الحالي</th>
                <th className="px-3 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide w-[8%]">المخزون</th>
                <th className="px-4 py-3 text-center font-bold text-xs text-muted-foreground uppercase tracking-wide">الصافي</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} className={`border-b border-border/60 last:border-0 hover:bg-primary/5 transition-colors ${i % 2 === 1 ? "bg-surface-2/30" : ""}`}>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-start gap-3">
                      {it.products?.image ? (
                        <ClickableImagePreview src={it.products.image} alt={it.product_name} title={it.product_name} className="w-10 h-10 shrink-0 rounded-lg object-cover border border-border" />
                      ) : (
                        <div className="w-10 h-10 shrink-0 rounded-lg bg-muted flex items-center justify-center text-[10px] text-muted-foreground">صورة</div>
                      )}
                      <div className="min-w-0 space-y-1 text-right">
                        <div className="font-semibold leading-snug flex items-center gap-1.5 flex-wrap">
                          <span className="break-words">{it.product_name}</span>
                          {it.color && <ColorChip name={it.color} />}
                        </div>
                        <VariantLine attrs={{ ...(it as any), color: null }} />
                        {it.products?.name && it.products.name !== it.product_name && (
                          <div className="text-xs text-muted-foreground break-words">{it.products.name}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center align-middle">
                    <span className="font-mono text-xs text-muted-foreground bg-surface-2 border border-border rounded px-2 py-1 inline-block break-all">
                      {it.products?.sku ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center align-middle tabular-nums font-semibold">{it.quantity}</td>
                  <td className="px-3 py-3 text-center align-middle tabular-nums whitespace-nowrap">{formatEGP(it.cost_price)}</td>
                  {totalExtras > 0 && <td className="px-3 py-3 text-center align-middle tabular-nums whitespace-nowrap text-amber-600">+ {formatEGP(it.shipping_cost_per_unit ?? 0)}</td>}
                  {totalExtras > 0 && <td className="px-3 py-3 text-center align-middle tabular-nums whitespace-nowrap font-bold text-primary">{formatEGP(it.true_unit_cost ?? it.cost_price)}</td>}
                  <td className="px-3 py-3 text-center align-middle tabular-nums text-muted-foreground">{Number(it.discount_percent ?? 0) > 0 ? `${Number(it.discount_percent)}%` : "—"}</td>
                  <td className="px-3 py-3 text-center align-middle tabular-nums whitespace-nowrap text-muted-foreground">{Number(it.discount_amount ?? 0) > 0 ? formatEGP(it.discount_amount) : "—"}</td>
                  <td className="px-3 py-3 text-center align-middle tabular-nums whitespace-nowrap text-muted-foreground">{it.products?.selling_price ? formatEGP(it.products.selling_price) : "—"}</td>
                  <td className="px-3 py-3 text-center align-middle">
                    <span className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${(it.products?.quantity ?? 1) <= 0 ? 'bg-destructive/10 text-destructive' : (it.products?.quantity ?? 0) < (it.products?.low_stock_alert ?? 5) ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                      {it.products?.quantity ?? 1}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center align-middle font-bold tabular-nums whitespace-nowrap">{formatEGP(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </PermTable>
        </div>

        {items.length === 1 && (
          <div className="p-4 border-t border-border bg-surface-2/30">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-muted-foreground">المنتج:</span> <b>{items[0].product_name}</b></div>
              <div><span className="text-muted-foreground">الكود:</span> <b>{items[0].products?.sku ?? "—"}</b></div>
              <div><span className="text-muted-foreground">الكمية:</span> <b>{items[0].quantity}</b></div>
              <div><span className="text-muted-foreground">الإجمالي:</span> <b className="text-primary">{formatEGP(items[0].total)}</b></div>
      </div>

      <ThermalReceiptPrint
        kind="purchase"
        invoiceNumber={ship.shipment_number ?? `#${ship.id.slice(0, 8)}`}
        createdAt={ship.created_at}
        paymentType="cash"
        cashier={ship.received_by}
        partyName={ship.contacts?.name}
        notes={ship.notes}
        items={items.map((it: any) => ({
          name: it.product_name ?? it.products?.name ?? "—",
          qty: Number(it.quantity),
          unit_price: Number(it.cost_price ?? 0),
          total: Number(it.total ?? 0),
        }))}
        subtotal={Number(itemsGross)}
        discount={Number(itemsDiscount) > 0 ? Number(itemsDiscount) : 0}
        total={Number(ship.total_cost ?? 0)}
        paid={docStatus && docStatus.state !== "before_ledger" ? docStatus.paid : undefined}
        remaining={docStatus && docStatus.state !== "before_ledger" ? docStatus.remaining : 0}
        previousBalance={liveBal ? liveBal.prev : null}
        currentBalance={liveBal ? liveBal.curr : null}
      />

          </div>
        )}
      </div>

      <div className="card-elevated p-4 print:hidden">
        <DocumentMoneyMovements docId={ship.id} docRecordType="shipment" canEdit={canEdit} onChanged={() => window.location.reload()} />
      </div>

      <div className="card-elevated p-4 print:hidden">
        <RecordAttachments recordType="shipment" recordId={ship.id} canEdit={canEdit} />
      </div>

      <CancelPurchaseDialog open={cancelOpen} onOpenChange={setCancelOpen} shipment={ship} onDone={() => nav(`/branch/${branchId}/invoices?tab=purchase`)} />

    </BranchLayout>
  );
}
