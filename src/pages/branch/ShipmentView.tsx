import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate, balanceLabel } from "@/lib/format";
import { Loader2, Package, Phone, User, Calendar, ClipboardList, Truck, Receipt, Trash2, Printer, ArrowRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { ColorChip } from "@/components/ColorPicker";
import { toast } from "sonner";
import { printHtml } from "@/lib/export";
import { ThermalReceiptPrint, printThermalInvoice } from "@/components/ThermalReceiptPrint";
import { RecordAttachments } from "@/components/RecordAttachments";
import { EditableInvoiceDate } from "@/components/EditableInvoiceDate";

const escapeHtml = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export default function ShipmentView() {
  const { id: branchId, shipmentId } = useParams<{ id: string; shipmentId: string }>();
  const nav = useNavigate();
  const { isAdmin, hasRole, tenantId, user, profile } = useAuth();
  const isManager = hasRole("branch_manager");
  const canDelete = isAdmin || isManager;
  const canEdit = isAdmin || isManager;
  const [ship, setShip] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [delOpen, setDelOpen] = useState(false);
  const [delReason, setDelReason] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editReason, setEditReason] = useState("");
  const [edit, setEdit] = useState({ arrival_date: "", received_by: "", shipping_cost: 0, admin_cost: 0, notes: "" });

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

  const handleDelete = async () => {
    if (!ship) return;
    setDelBusy(true);
    const label = `شحنة ${ship.shipment_number ?? ship.id.slice(0, 8)} - ${ship.contacts?.name ?? ""}`;
    if (isAdmin) {
      const { error } = await supabase.from("shipments").delete().eq("id", ship.id);
      setDelBusy(false);
      if (error) return toast.error(error.message);
      toast.success(`تم حذف ${label}`);
      nav(`/branch/${branchId}/invoices?tab=purchase`);
    } else if (isManager) {
      if (!delReason.trim()) { setDelBusy(false); return toast.error("اكتب سبب الحذف"); }
      const ok = await createApprovalRequest({
        tenantId: tenantId!, branchId: branchId ?? null,
        entityType: "shipment", entityId: ship.id, entityLabel: label,
        action: "delete", reason: delReason,
        requestedBy: user!.id, requestedByName: profile?.name ?? "—",
      });
      setDelBusy(false);
      if (!ok) return;
      toast.success("تم إرسال طلب الحذف للموافقة");
      setDelOpen(false); setDelReason("");
    } else { setDelBusy(false); return toast.error("غير مصرح"); }
  };

  const openEdit = () => {
    setEdit({
      arrival_date: (ship.arrival_date ?? "").slice(0, 10),
      received_by: ship.received_by ?? "",
      shipping_cost: Number(ship.shipping_cost ?? 0),
      admin_cost: Number(ship.admin_cost ?? 0),
      notes: ship.notes ?? "",
    });
    setEditReason("");
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!ship) return;
    setEditBusy(true);
    const goods = Number(ship.total_cost) - Number(ship.shipping_cost) - Number(ship.admin_cost);
    const newTotal = goods + Number(edit.shipping_cost || 0) + Number(edit.admin_cost || 0);
    const updates = {
      arrival_date: edit.arrival_date,
      received_by: edit.received_by,
      shipping_cost: Number(edit.shipping_cost || 0),
      admin_cost: Number(edit.admin_cost || 0),
      notes: edit.notes || null,
      total_cost: newTotal,
    };
    const label = `شحنة ${ship.shipment_number ?? ship.id.slice(0, 8)} - ${ship.contacts?.name ?? ""}`;
    if (isAdmin) {
      const { error } = await supabase.from("shipments").update(updates).eq("id", ship.id);
      setEditBusy(false);
      if (error) return toast.error(error.message);
      toast.success("تم حفظ التعديلات");
      setEditOpen(false);
      setShip({ ...ship, ...updates });
    } else if (isManager) {
      if (!editReason.trim()) { setEditBusy(false); return toast.error("اكتب سبب التعديل"); }
      const ok = await createApprovalRequest({
        tenantId: tenantId!, branchId: branchId ?? null,
        entityType: "shipment", entityId: ship.id, entityLabel: label,
        action: "update", payload: updates, reason: editReason,
        requestedBy: user!.id, requestedByName: profile?.name ?? "—",
      });
      setEditBusy(false);
      if (!ok) return;
      setEditOpen(false);
    } else { setEditBusy(false); return toast.error("غير مصرح"); }
  };

  if (loading) return <BranchLayout><div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></BranchLayout>;
  if (!ship) return <BranchLayout><div className="text-center p-12 text-muted-foreground">شحنة غير موجودة</div></BranchLayout>;

  const customs = Number(ship.customs_cost ?? 0);
  const otherCost = Number(ship.other_cost ?? 0);
  const totalExtras = Number(ship.total_extra_costs ?? 0) || (Number(ship.shipping_cost ?? 0) + customs + otherCost);
  const goodsValue = ship.total_cost - ship.shipping_cost - customs - otherCost - ship.admin_cost;
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
      <h1>شحنة ${escapeHtml(ship.shipment_number ?? "#" + ship.id.slice(0,8))}</h1>
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
          <div class="row"><span>الشحن</span><b>${formatEGP(ship.shipping_cost)}</b></div>
          <div class="row"><span>إدارية</span><b>${formatEGP(ship.admin_cost)}</b></div>
          <div class="row" style="border-top:1px solid #ddd;padding-top:6px;margin-top:6px"><span><b>الإجمالي</b></span><b style="color:#3b82f6;font-size:15px">${formatEGP(ship.total_cost)}</b></div>
        </div>
      </div>

      <h2>المنتجات (${items.length})</h2>
      <table>
        <thead>
          <tr>
            <th>#</th><th>المنتج</th><th>الكود</th><th>الكمية</th>
            <th>سعر التكلفة</th><th>خصم %</th><th>خصم مبلغ</th><th>الصافي</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
    printHtml(`شحنة ${ship.shipment_number ?? ship.id.slice(0,8)}`, body, { landscape: true });
  };

  return (
    <BranchLayout>
      <PageHeader
        title={`شحنة ${ship.shipment_number ?? `#${ship.id.slice(0, 8)}`}`}
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
            {canEdit && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => nav(`/branch/${branchId}/shipments/${ship.id}/edit`)}>
                <Pencil className="w-4 h-4" /> {isAdmin ? "التعديل على الفاتورة" : "طلب تعديل على الفاتورة"}
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setDelOpen(true)}>
                <Trash2 className="w-4 h-4" /> {isAdmin ? "حذف نهائي للفاتورة" : "طلب حذف للفاتورة"}
              </Button>
            )}
          </div>
        }
      />

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
            <div className="flex justify-between"><span className="text-muted-foreground">قيمة البضاعة (قبل الخصم)</span><b>{formatEGP(itemsGross)}</b></div>
            {itemsDiscount > 0 && (
              <div className="flex justify-between text-destructive"><span>إجمالي الخصومات</span><b>− {formatEGP(itemsDiscount)}</b></div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">صافي البضاعة</span><b>{formatEGP(goodsValue)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الشحن</span><b>{formatEGP(ship.shipping_cost)}</b></div>
            {customs > 0 && <div className="flex justify-between"><span className="text-muted-foreground">الجمارك</span><b>{formatEGP(customs)}</b></div>}
            {otherCost > 0 && <div className="flex justify-between"><span className="text-muted-foreground">مصاريف أخرى {ship.other_cost_description ? `(${ship.other_cost_description})` : ""}</span><b>{formatEGP(otherCost)}</b></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">إدارية</span><b>{formatEGP(ship.admin_cost)}</b></div>
            <div className="border-t border-border pt-2 flex justify-between text-lg"><span>الإجمالي</span><b className="text-primary">{formatEGP(ship.total_cost)}</b></div>
          </div>
        </div>
      </div>

      {/* Supplier balance snapshot — captured at shipment creation */}
      {ship.contact_id && (ship.previous_balance != null || ship.current_balance != null) && (() => {
        const prevLbl = balanceLabel(Number(ship.previous_balance ?? 0));
        const currLbl = balanceLabel(Number(ship.current_balance ?? 0));
        return (
          <div className="card-elevated p-4 mb-6">
            <div className="font-bold text-sm mb-2">📒 رصيد المورد (لحظة استلام الشحنة)</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-surface-2 p-2 rounded border border-border">
                <div className="text-xs text-muted-foreground">الرصيد السابق</div>
                <div className="font-bold">{formatEGP(prevLbl.amount)}</div>
                <div className={`text-xs ${prevLbl.tone === "good" ? "text-success" : prevLbl.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>{prevLbl.label}</div>
              </div>
              <div className="bg-surface-2 p-2 rounded border border-border">
                <div className="text-xs text-muted-foreground">الرصيد بعد الشحنة</div>
                <div className="font-bold">{formatEGP(currLbl.amount)}</div>
                <div className={`text-xs ${currLbl.tone === "good" ? "text-success" : currLbl.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>{currLbl.label}</div>
              </div>
            </div>
          </div>
        );
      })()}


      <div className="card-elevated overflow-hidden">
        <div className="p-4 border-b border-border font-bold flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          المنتجات ({items.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="px-4 py-3 text-right">المنتج</th>
                <th className="px-4 py-3 text-right">الكود</th>
                <th className="px-4 py-3 text-right">الكمية</th>
                <th className="px-4 py-3 text-right">سعر التكلفة</th>
                {totalExtras > 0 && <th className="px-4 py-3 text-right">نصيب الشحن/الوحدة</th>}
                {totalExtras > 0 && <th className="px-4 py-3 text-right">التكلفة الحقيقية/الوحدة</th>}
                <th className="px-4 py-3 text-right">خصم %</th>
                <th className="px-4 py-3 text-right">خصم مبلغ</th>
                <th className="px-4 py-3 text-right">سعر البيع الحالي</th>
                <th className="px-4 py-3 text-right">المخزون</th>
                <th className="px-4 py-3 text-right">الصافي</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-border hover:bg-surface-2/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {it.products?.image ? (
                        <img src={it.products.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-border" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground">صورة</div>
                      )}
                      <div>
                        <div className="font-medium">{it.product_name}</div>
                        {it.products?.name && it.products.name !== it.product_name && (
                          <div className="text-xs text-muted-foreground">{it.products.name}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{it.products?.sku ?? "—"}</td>
                  <td className="px-4 py-3">{it.quantity}</td>
                  <td className="px-4 py-3">{formatEGP(it.cost_price)}</td>
                  {totalExtras > 0 && <td className="px-4 py-3 text-amber-600">+ {formatEGP(it.shipping_cost_per_unit ?? 0)}</td>}
                  {totalExtras > 0 && <td className="px-4 py-3 font-bold text-primary">{formatEGP(it.true_unit_cost ?? it.cost_price)}</td>}
                  <td className="px-4 py-3 text-muted-foreground">{Number(it.discount_percent ?? 0) > 0 ? `${Number(it.discount_percent)}%` : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{Number(it.discount_amount ?? 0) > 0 ? formatEGP(it.discount_amount) : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{it.products?.selling_price ? formatEGP(it.products.selling_price) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${(it.products?.quantity ?? 1) <= 0 ? 'bg-destructive/10 text-destructive' : (it.products?.quantity ?? 0) < (it.products?.low_stock_alert ?? 5) ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                      {it.products?.quantity ?? 1}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold">{formatEGP(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        paid={Number(ship.total_cost ?? 0)}
        previousBalance={ship.previous_balance != null ? Number(ship.previous_balance) : null}
        currentBalance={ship.current_balance != null ? Number(ship.current_balance) : null}
      />

          </div>
        )}
      </div>

      <div className="card-elevated p-4 print:hidden">
        <RecordAttachments recordType="shipment" recordId={ship.id} canEdit={canEdit} />
      </div>

      <AlertDialog open={delOpen} onOpenChange={(o) => { if (!o) { setDelOpen(false); setDelReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              {isManager && !isAdmin ? "طلب حذف شحنة للموافقة" : "حذف الشحنة"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isManager && !isAdmin
                ? <>سيتم إرسال طلب حذف الشحنة لمدير الشركة للموافقة.</>
                : <>هل أنت متأكد من حذف هذه الشحنة؟ لن يمكن التراجع.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isManager && !isAdmin && (
            <div className="px-1">
              <Label>سبب الحذف *</Label>
              <Input className="mt-1.5" value={delReason} onChange={(e) => setDelReason(e.target.value)} placeholder="اكتب السبب..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delBusy}>تراجع</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={delBusy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {delBusy ? "جاري..." : (isManager && !isAdmin ? "إرسال الطلب" : "احذف")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isManager && !isAdmin ? "طلب تعديل شحنة" : "تعديل بيانات الشحنة"}</DialogTitle>
            <DialogDescription>
              {isManager && !isAdmin ? "سيتم إرسال التعديلات للمدير للموافقة." : "تعديل البيانات الأساسية للشحنة."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>تاريخ الوصول</Label>
              <Input type="date" className="mt-1.5" value={edit.arrival_date} onChange={(e) => setEdit({ ...edit, arrival_date: e.target.value })} />
            </div>
            <div>
              <Label>المستلم</Label>
              <Input className="mt-1.5" value={edit.received_by} onChange={(e) => setEdit({ ...edit, received_by: e.target.value })} />
            </div>
            <div>
              <Label>الشحن</Label>
              <Input type="number" min={0} className="mt-1.5" value={edit.shipping_cost} onChange={(e) => setEdit({ ...edit, shipping_cost: Number(e.target.value) })} />
            </div>
            <div>
              <Label>مصاريف إدارية</Label>
              <Input type="number" min={0} className="mt-1.5" value={edit.admin_cost} onChange={(e) => setEdit({ ...edit, admin_cost: Number(e.target.value) })} />
            </div>
            <div className="col-span-2">
              <Label>ملاحظات</Label>
              <Textarea className="mt-1.5" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </div>
            {isManager && !isAdmin && (
              <div className="col-span-2">
                <Label>سبب التعديل *</Label>
                <Input className="mt-1.5" value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="اكتب السبب..." />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editBusy}>تراجع</Button>
            <Button onClick={handleEdit} disabled={editBusy}>
              {editBusy ? "جاري..." : (isManager && !isAdmin ? "إرسال الطلب" : "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
