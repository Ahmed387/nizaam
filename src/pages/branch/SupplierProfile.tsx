import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchContactLedger, balanceForSelection, type ContactLedger } from "@/lib/contactLedger";
import { VoucherViewDialog } from "@/components/VoucherViewDialog";
import { VOUCHER_TYPE_LABEL } from "@/lib/vouchers";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { BranchLayout, AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { PaymentPlansPanel } from "@/components/PaymentPlansPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime, formatDate } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { printReport, exportToExcel } from "@/lib/export";
import { toast } from "sonner";
import {
  ArrowRight,
  Truck,
  DollarSign,
  Wallet,
  Phone,
  MapPin,
  User,
  Pencil,
  Trash2,
  FileText,
  Receipt,
  Activity,
  Download,
  Package,
  Percent,
  Eye,
  Printer,
  Building2,
} from "lucide-react";
import { MultiMethodPaymentDialog } from "@/components/MultiMethodPaymentDialog";
import { saveContact, deleteContact } from "@/lib/contactWrites";

export default function SupplierProfile() {
  const params = useParams<{ id: string; supplierId: string; contactId: string }>();
  const branchId = params.id;
  const supplierId = params.supplierId || params.contactId;
  const nav = useNavigate();
  const { user, profile, tenantId, branches, isAdmin } = useAuth();
  const isAdminView = !branchId;
  const Layout = isAdminView ? AdminLayout : BranchLayout;
  const backTo = isAdminView ? `/admin/contacts` : `/branch/${branchId}/contacts`;
  const [supplier, setSupplier] = useState<any>(null);
  const [shipmentsAll, setShipments] = useState<any[]>([]);
  const [paymentsAll, setPayments] = useState<any[]>([]);
  const [invoicesAll, setInvoices] = useState<any[]>([]);
  const [custPaymentsAll, setCustPayments] = useState<any[]>([]);
  const [ledger, setLedger] = useState<ContactLedger | null>(null);
  const [selBranches, setSelBranches] = useState<string[]>([]);
  const [branchNameMap, setBranchNameMap] = useState<Record<string, string>>({});
  const [viewVoucher, setViewVoucher] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [payOpen, setPayOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState({ name: "", type: "supplier" as "customer" | "supplier" | "both", contact_person: "", phone: "", address: "", notes: "" });

  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: ships }, { data: ledger }, { data: invs }] = await Promise.all([
      supabase.from("contacts").select("*").eq("id", supplierId!).maybeSingle(),
      supabase
        .from("shipments")
        .select("*, branches(name), shipment_items(id, quantity)")
        .eq("contact_id", supplierId!)
        .eq("status", "active")
        .order("arrival_date", { ascending: false }),
      supabase
        .from("v_supplier_ledger" as any)
        .select("*")
        .eq("contact_id", supplierId!)
        .order("paid_at", { ascending: false }),
      supabase
        .from("invoices")
        .select("*, branches(name)")
        .eq("contact_id", supplierId!)
        .order("created_at", { ascending: false }),
    ]);
    // TODO Phase 2.2B: Remove after contacts.balance column is dropped — override with live ledger balance
    const l = await fetchContactLedger(supplierId!);
    setLedger(l);
    setSupplier(s ? { ...s, balance: l.totalBalance } : s);
    const ids = Array.from(new Set([
      ...l.rows.map((r) => r.branch_id),
      ...((ledger as any[]) ?? []).map((r: any) => r.branch_id),
    ].filter(Boolean))) as string[];
    if (ids.length) {
      const { data: bs } = await supabase.from("branches").select("id, name").in("id", ids);
      setBranchNameMap(Object.fromEntries((bs ?? []).map((b: any) => [b.id, b.name])));
    } else setBranchNameMap({});
    setShipments(ships ?? []);
    setInvoices(invs ?? []);
    // Split unified ledger by direction (server-side view handles merging)
    const rows = ((ledger as any[]) ?? []).map((r) => ({
      id: r.id,
      paid_at: r.paid_at,
      amount: Number(r.amount),
      branches: r.branch_name ? { name: r.branch_name } : null,
      profiles: { name: r.received_by_name },
      notes: r.notes ?? (r.payment_method ? `${r.payment_method}${r.reference_number ? " #" + r.reference_number : ""}` : ""),
      direction: r.direction,
      branch_id: r.branch_id ?? null,
      _new: r.source === "payment_transaction",
    }));
    setPayments(rows.filter((r) => r.direction === "out"));
    setCustPayments(rows.filter((r) => r.direction === "in"));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [supplierId]);

  // Realtime: تحديث تلقائي عند أي دفعة/فاتورة شراء/تعديل للمورد
  useEffect(() => {
    if (!supplierId) return;
    const channel = supabase
      .channel(`supplier-${supplierId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_transactions", filter: `contact_id=eq.${supplierId}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipments", filter: `contact_id=eq.${supplierId}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "contacts", filter: `id=eq.${supplierId}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_plans", filter: `entity_id=eq.${supplierId}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vouchers", filter: `party_id=eq.${supplierId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supplierId]);

  useEffect(() => {
    if (supplier) {
      setEdit({
        name: supplier.name ?? "",
        type: (supplier.type ?? "supplier") as "customer" | "supplier" | "both",
        contact_person: supplier.contact_person ?? "",
        phone: supplier.phone ?? "",
        address: supplier.address ?? "",
        notes: supplier.notes ?? "",
      });
    }
  }, [supplier]);

  const inSel = (bid: string | null | undefined) => !selBranches.length || (!!bid && selBranches.includes(bid));
  const shipments = useMemo(() => shipmentsAll.filter((x) => inSel(x.branch_id)), [shipmentsAll, selBranches]);
  const payments = useMemo(() => paymentsAll.filter((x) => inSel(x.branch_id)), [paymentsAll, selBranches]);
  const invoices = useMemo(() => invoicesAll.filter((x) => inSel(x.branch_id)), [invoicesAll, selBranches]);
  const custPayments = useMemo(() => custPaymentsAll.filter((x) => inSel(x.branch_id)), [custPaymentsAll, selBranches]);
  const vouchers = useMemo(() => (ledger?.vouchers ?? []).filter((v: any) => inSel(v.branch_id)), [ledger, selBranches]);
  const scopedRows = useMemo(() => (ledger?.rows ?? []).filter((r) => r.kind !== "opening" && inSel(r.branch_id)), [ledger, selBranches]);
  const branchOptions = useMemo(() => {
    const ids = new Set<string>();
    (ledger?.rows ?? []).forEach((r) => r.branch_id && ids.add(r.branch_id));
    paymentsAll.forEach((p) => p.branch_id && ids.add(p.branch_id));
    custPaymentsAll.forEach((p) => p.branch_id && ids.add(p.branch_id));
    return Array.from(ids).map((id) => ({ id, name: branchNameMap[id] ?? "فرع" })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [ledger, paymentsAll, custPaymentsAll, branchNameMap]);
  const selLabel = selBranches.length ? selBranches.map((id) => branchNameMap[id] ?? "").join("، ") : "كل الفروع";
  const toggleBranch = (id: string) =>
    setSelBranches((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const paymentVouchersTotal = vouchers.filter((v: any) => v.type === "payment").reduce((s: number, v: any) => s + Number(v.amount ?? 0), 0);
  const purchaseReturnsTotal = scopedRows.filter((r) => r.kind === "purchase_return").reduce((s, r) => s + r.debit, 0);
  const saleReturnsTotal = scopedRows.filter((r) => r.kind === "sale_return").reduce((s, r) => s + r.credit, 0);
  const totalShipments = shipments.reduce((s, x) => s + Number(x.total_cost), 0);
  const supplierPaid = payments.reduce((s, x) => s + Number(x.amount), 0);
  const totalPaid = supplierPaid + paymentVouchersTotal;
  // الاتفاقية الجديدة: +balance = لنا، −balance = علينا.
  // المتبقي علينا = max(0, -balance)
  const balance = balanceForSelection(ledger, selBranches);
  const owedByUs = balance < 0 ? Math.abs(balance) : 0;
  const creditAtSupplier = balance > 0 ? balance : 0;
  const totalItemsCount = shipments.reduce(
    (s, x) => s + ((x.shipment_items ?? []) as any[]).length,
    0
  );
  const totalUnits = shipments.reduce(
    (s, x) =>
      s + ((x.shipment_items ?? []) as any[]).reduce((q, it: any) => q + Number(it.quantity ?? 0), 0),
    0
  );
  const shipmentItemCount = (sh: any) => ((sh.shipment_items ?? []) as any[]).length;
  const shipmentUnitsCount = (sh: any) =>
    ((sh.shipment_items ?? []) as any[]).reduce((q, it: any) => q + Number(it.quantity ?? 0), 0);

  // الخصومات اللي المورد عملها لنا على فواتير الشراء
  const discountShipments = useMemo(
    () => shipments.filter((s) => Number(s.discount_amount ?? 0) > 0),
    [shipments]
  );
  const totalDiscounts = discountShipments.reduce((s, x) => s + Number(x.discount_amount ?? 0), 0);
  const grossBeforeDiscount = totalShipments + totalDiscounts;
  const discountPct = grossBeforeDiscount > 0 ? (totalDiscounts / grossBeforeDiscount) * 100 : 0;
  const lastDiscount = discountShipments[0];


  // Unified timeline
  const timeline = useMemo(() => {
    const items: any[] = [];
    shipments.forEach((sh) =>
      items.push({
        kind: "shipment",
        date: sh.arrival_date,
        amount: Number(sh.total_cost),
        title: `فاتورة شراء جديدة — ${sh.branches?.name ?? ""}`,
        subtitle: `استلمها: ${sh.received_by}`,
        ref: sh,
      })
    );
    payments.forEach((p) =>
      items.push({
        kind: "payment",
        date: p.paid_at,
        amount: Number(p.amount),
        title: `دفعة — ${p.branches?.name ?? ""}`,
        subtitle: `${p.profiles?.name ?? ""}${p.notes ? " — " + p.notes : ""}`,
        ref: p,
      })
    );
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [shipments, payments]);

  // ملاحظة: السداد دلوقتي بيمشي عبر MultiMethodPaymentDialog → RPC record_contact_payment

  const submitEdit = async () => {
    if (!edit.name) return toast.error("اسم الشركة مطلوب");
    const { error } = await saveContact(supplierId!, edit);
    if (error) return toast.error(error.message);
    await logAudit({
      userId: user!.id,
      userName: profile?.name ?? "",
      tenantId,
      action: "UPDATE",
      entity: "Supplier",
      entityId: supplierId,
      details: edit,
    });
    toast.success("تم التعديل");
    setEditOpen(false);
    load();
  };

  const submitDelete = async () => {
    if (shipments.length > 0) {
      return toast.error("لا يمكن حذف مورد له فواتير شراء. احذف فواتير الشراء أولاً.");
    }
    const { error } = await deleteContact(supplierId!);
    if (error) return toast.error(error.message);
    await logAudit({
      userId: user!.id,
      userName: profile?.name ?? "",
      tenantId,
      action: "DELETE",
      entity: "Supplier",
      entityId: supplierId,
      details: { name: supplier.name },
    });
    toast.success("تم الحذف");
    nav(backTo);
  };

  const retRows = scopedRows.filter((r) => r.kind === "purchase_return" || r.kind === "sale_return");
  const printVoucher = (v: any) => {
    const w = window.open("", "_blank", "width=720,height=800");
    if (!w) return toast.error("المتصفح منع نافذة الطباعة");
    const esc = (x: any) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const row = (k: string, val: any) => `<tr><th>${k}</th><td>${esc(val)}</td></tr>`;
    w.document.write(`<html dir="rtl"><head><title>سند ${esc(v.voucher_number)}</title><style>body{font-family:Tahoma,sans-serif;padding:24px}h2{text-align:center}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:8px;text-align:right}th{width:30%;background:#f2f2f2}</style></head><body>
      <h2>${esc((VOUCHER_TYPE_LABEL as any)[v.type])} رقم ${esc(v.voucher_number)}</h2><table>
      ${row("التاريخ", formatDate(v.voucher_date))}${row("المبلغ", formatEGP(Number(v.amount)))}
      ${row("الجهة", v.party_name ?? supplier?.name ?? "")}${row("الفرع", v.branches?.name ?? "")}
      ${row("طريقة الدفع", (PAYMENT_METHOD_LABELS as any)[v.payment_method] ?? "")}${row("الوصف", v.description ?? "")}</table><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const printStatement = () => {
    const ship = shipments
      .map(
        (s) => `<tr>
          <td>${formatDate(s.arrival_date)}</td>
          <td>${s.branches?.name ?? "—"}</td>
          <td>${s.received_by}</td>
          <td>${formatEGP(s.shipping_cost)}</td>
          <td>${formatEGP(s.admin_cost)}</td>
          <td><b>${formatEGP(s.total_cost)}</b></td>
        </tr>`
      )
      .join("");

    const pays = payments
      .map(
        (p) => `<tr>
          <td>${formatDateTime(p.paid_at)}</td>
          <td>${p.branches?.name ?? "—"}</td>
          <td>${p.profiles?.name ?? "—"}</td>
          <td>${p.notes ?? "—"}</td>
          <td class="pos"><b>${formatEGP(p.amount)}</b></td>
        </tr>`
      )
      .join("");

    const html = `
      <div class="meta">الفرع: ${selLabel}</div>
      <div class="kpi">
        <div>عدد فواتير الشراء <b>${shipments.length}</b></div>
        <div>إجمالي فواتير الشراء <b>${formatEGP(totalShipments)}</b></div>
        <div>إجمالي المدفوع <b class="pos">${formatEGP(totalPaid)}</b></div>
        <div>${creditAtSupplier > 0 ? "رصيد لك" : "المتبقي عليك"} <b class="${owedByUs > 0 ? "neg" : "pos"}">${formatEGP(creditAtSupplier > 0 ? creditAtSupplier : owedByUs)}</b></div>
      </div>

      <h3>بيانات المورد</h3>
      <table>
        <tr><th>الشركة</th><td>${supplier.name}</td><th>المسؤول</th><td>${supplier.contact_person ?? "—"}</td></tr>
        <tr><th>التليفون</th><td dir="ltr">${supplier.phone ?? "—"}</td><th>العنوان</th><td>${supplier.address ?? "—"}</td></tr>
      </table>

      <h3>فواتير الشراء (${shipments.length})</h3>
      <table>
        <thead><tr><th>التاريخ</th><th>الفرع</th><th>المستلم</th><th>شحن</th><th>إدارية</th><th>الإجمالي</th></tr></thead>
        <tbody>${ship || '<tr><td colspan="6" style="text-align:center">لا توجد فواتير شراء</td></tr>'}</tbody>
      </table>

      <h3>المدفوعات (${payments.length})</h3>
      <table>
        <thead><tr><th>التاريخ</th><th>الفرع</th><th>دفع بواسطة</th><th>ملاحظات</th><th>المبلغ</th></tr></thead>
        <tbody>${pays || '<tr><td colspan="5" style="text-align:center">لا توجد مدفوعات</td></tr>'}</tbody>
      </table>

      <h3>المرتجعات (${retRows.length})</h3>
      <table>
        <thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>الفرع</th><th>القيمة</th></tr></thead>
        <tbody>${retRows.map((r) => `<tr><td>${formatDate(r.date)}</td><td>${r.type}</td><td>${r.reference}</td><td>${branchNameMap[r.branch_id ?? ""] ?? "—"}</td><td>${formatEGP(r.debit || r.credit)}</td></tr>`).join("") || '<tr><td colspan="5" style="text-align:center">لا توجد مرتجعات</td></tr>'}</tbody>
      </table>

      <h3>سندات القبض والصرف (${vouchers.length})</h3>
      <table>
        <thead><tr><th>رقم السند</th><th>النوع</th><th>التاريخ</th><th>الفرع</th><th>البيان</th><th>المبلغ</th></tr></thead>
        <tbody>${vouchers.map((v: any) => `<tr><td>${v.voucher_number}</td><td>${v.type === "receipt" ? "قبض" : "صرف"}</td><td>${formatDate(v.voucher_date)}</td><td>${v.branches?.name ?? "—"}</td><td>${v.description ?? "—"}</td><td>${formatEGP(v.amount)}</td></tr>`).join("") || '<tr><td colspan="6" style="text-align:center">لا توجد سندات</td></tr>'}</tbody>
      </table>
    `;
    printReport(`كشف حساب المورد — ${supplier.name} — ${selLabel}`, html);
  };

  const exportExcel = () => {
    if (!supplier) return;
    const summary = [
      { البيان: "اسم الشركة", القيمة: supplier.name },
      { البيان: "الفرع", القيمة: selLabel },
      { البيان: "المسؤول", القيمة: supplier.contact_person ?? "—" },
      { البيان: "التليفون", القيمة: supplier.phone ?? "—" },
      { البيان: "العنوان", القيمة: supplier.address ?? "—" },
      { البيان: "عدد فواتير الشراء", القيمة: shipments.length },
      { البيان: "عدد الأصناف (إجمالي)", القيمة: totalItemsCount },
      { البيان: "إجمالي الوحدات", القيمة: totalUnits },
      { البيان: "إجمالي فواتير الشراء (جنيه)", القيمة: totalShipments },
      { البيان: "دفعات للمورد (جنيه)", القيمة: supplierPaid },
      { البيان: "سندات صرف (جنيه)", القيمة: paymentVouchersTotal },
      { البيان: "إجمالي المدفوع (جنيه)", القيمة: totalPaid },
      { البيان: "مرتجعات الشراء (جنيه)", القيمة: purchaseReturnsTotal },
      { البيان: "مرتجعات البيع (جنيه)", القيمة: saleReturnsTotal },
      { البيان: "صافي الرصيد (جنيه)", القيمة: balance },
    ];
    const shipRows = shipments.map((s) => ({
      التاريخ: formatDate(s.arrival_date),
      الفرع: s.branches?.name ?? "—",
      المستلم: s.received_by,
      "عدد الأصناف": shipmentItemCount(s),
      "إجمالي الوحدات": shipmentUnitsCount(s),
      "تكلفة الشحن": Number(s.shipping_cost),
      "مصاريف إدارية": Number(s.admin_cost),
      "الإجمالي": Number(s.total_cost),
      ملاحظات: s.notes ?? "",
    }));
    const payRows = payments.map((p) => ({
      "تاريخ السداد": formatDateTime(p.paid_at),
      الفرع: p.branches?.name ?? "—",
      "دفع بواسطة": p.profiles?.name ?? "—",
      المبلغ: Number(p.amount),
      ملاحظات: p.notes ?? "",
    }));
    exportToExcel(`كشف حساب — ${supplier.name}`, [
      { name: "ملخص", rows: summary },
      { name: "فواتير الشراء", rows: shipRows },
      { name: "المدفوعات", rows: payRows },
      { name: "المبيعات", rows: invoices.map((i) => ({ الرقم: i.invoice_number, الفرع: i.branches?.name ?? "—", التاريخ: formatDate(i.invoice_date ?? i.created_at), الإجمالي: Number(i.total), الحالة: i.status === "active" ? "نشطة" : "ملغاة" })) },
      { name: "المرتجعات", rows: retRows.map((r) => ({ التاريخ: formatDate(r.date), النوع: r.type, المرجع: r.reference, الفرع: branchNameMap[r.branch_id ?? ""] ?? "—", القيمة: r.debit || r.credit })) },
      { name: "السندات", rows: vouchers.map((v: any) => ({ "رقم السند": v.voucher_number, النوع: v.type === "receipt" ? "قبض" : "صرف", التاريخ: formatDate(v.voucher_date), المبلغ: Number(v.amount), الفرع: v.branches?.name ?? "—", البيان: v.description ?? "" })) },
    ]);
  };
  return (
    <Layout>
      <PageHeader
        title={supplier?.name ?? "ملف المورد"}
        subtitle={supplier?.contact_person ?? ""}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button className="btn-gradient" onClick={() => setPayOpen(true)}>
              <DollarSign className="w-4 h-4 ml-1" /> سداد دفعة
            </Button>
            <Button variant="outline" onClick={() => nav(`${isAdminView ? `/admin/contacts/${supplierId}/statement` : `/branch/${branchId}/contacts/${supplierId}/statement`}${selBranches.length ? `?branches=${selBranches.join(",")}` : ""}`)}>
              <Activity className="w-4 h-4 ml-1" /> كشف حساب تفصيلي
            </Button>
            <Button variant="outline" onClick={printStatement}>
              <FileText className="w-4 h-4 ml-1" /> كشف حساب PDF
            </Button>
            <Button variant="outline" onClick={exportExcel}>
              <Download className="w-4 h-4 ml-1" /> تحميل Excel
            </Button>
            {isAdmin && (
              <>
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="w-4 h-4 ml-1" /> تعديل
                </Button>
                <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="w-4 h-4 ml-1" /> حذف
                </Button>
              </>
            )}
            {supplier && supplier.type !== "both" && (
              <Button variant="outline" onClick={async () => {
                const { error } = await saveContact(supplierId!, { type: "both" });
                if (error) return toast.error(error.message);
                toast.success(supplier.type === "supplier" ? "تمت إضافته كعميل أيضاً" : "تمت إضافته كمورد أيضاً");
                load();
              }}>
                <Receipt className="w-4 h-4 ml-1" /> {supplier.type === "supplier" ? "أيضاً عميل" : "أيضاً مورد"}
              </Button>
            )}
            <Button variant="outline" onClick={() => nav(backTo)}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
          </div>
        }
      />

      {supplier && (
        <div className="card-elevated p-5 mb-6 grid md:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" /> {supplier.contact_person ?? "—"}
          </div>
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-muted-foreground" /> <span dir="ltr">{supplier.phone ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" /> {supplier.address ?? "—"}
          </div>
          {supplier.notes && <div className="md:col-span-3 text-muted-foreground">📝 {supplier.notes}</div>}
        </div>
      )}

      {branchOptions.length > 0 && (
        <div className="card-elevated p-3 mb-4 flex flex-wrap items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          <Button size="sm" variant={selBranches.length === 0 ? "default" : "outline"} className="rounded-full" onClick={() => setSelBranches([])}>
            كل الفروع
          </Button>
          {branchOptions.map((b) => (
            <Button key={b.id} size="sm" variant={selBranches.includes(b.id) ? "default" : "outline"} className="rounded-full" onClick={() => toggleBranch(b.id)}>
              {b.name}
            </Button>
          ))}
          {selBranches.length > 0 && <span className="text-xs text-muted-foreground mr-2">الأرقام محسوبة للفروع المختارة فقط</span>}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="عدد فواتير الشراء" value={shipments.length} icon={<Truck className="w-5 h-5" />} accent="primary" />
        <StatCard label="إجمالي الأصناف" value={`${totalItemsCount} (${totalUnits} وحدة)`} icon={<Package className="w-5 h-5" />} accent="primary" />
        <StatCard label="إجمالي فواتير الشراء" value={formatEGP(totalShipments)} icon={<DollarSign className="w-5 h-5" />} accent="secondary" />
        <StatCard label="إجمالي المدفوع (دفعات + سندات صرف)" value={formatEGP(totalPaid)} icon={<Wallet className="w-5 h-5" />} accent="success" />
        <StatCard
          label={`إجمالي الخصومات (${discountPct.toFixed(1)}%)`}
          value={formatEGP(totalDiscounts)}
          icon={<Percent className="w-5 h-5" />}
          accent="success"
        />
        <StatCard
          label={creditAtSupplier > 0 ? "رصيد ليك عند المورد" : "المتبقي عليك"}
          value={formatEGP(creditAtSupplier > 0 ? creditAtSupplier : owedByUs)}
          icon={<DollarSign className="w-5 h-5" />}
          accent={creditAtSupplier > 0 ? "success" : owedByUs > 0 ? "warning" : "success"}
        />
      </div>
      {totalDiscounts > 0 && lastDiscount && (
        <div className="card-elevated p-3 mb-6 bg-success/10 border-success/30 text-sm">
          <span className="font-semibold text-success">
            🎁 المورد ده عملّك خصومات بإجمالي {formatEGP(totalDiscounts)} على {discountShipments.length} فاتورة شراء
          </span>
          <div className="text-xs text-muted-foreground mt-0.5">
            آخر خصم كان يوم {formatDate(lastDiscount.arrival_date)} بقيمة {formatEGP(Number(lastDiscount.discount_amount))}
            {lastDiscount.discount_type === "percent" ? ` (${Number(lastDiscount.discount_value)}%)` : ""}
          </div>
        </div>
      )}
      {creditAtSupplier > 0 && (
        <div className="card-elevated p-3 mb-6 bg-success/10 border-success/30 text-sm flex items-center justify-between">
          <div>
            <span className="font-semibold text-success">💰 ليك رصيد عند المورد قدره {formatEGP(creditAtSupplier)}</span>
            <div className="text-xs text-muted-foreground mt-0.5">هيتخصم تلقائياً من أي فاتورة شراء جديدة من نفس المورد.</div>
          </div>
        </div>
      )}

      <Tabs defaultValue="timeline" className="w-full">
        <TabsList>
          <TabsTrigger value="timeline" className="gap-2"><Activity className="w-4 h-4" /> Timeline</TabsTrigger>
          {(supplier?.type === "supplier" || supplier?.type === "both") && (
            <TabsTrigger value="shipments" className="gap-2"><Truck className="w-4 h-4" /> فواتير الشراء ({shipments.length})</TabsTrigger>
          )}
          {(supplier?.type === "supplier" || supplier?.type === "both") && (
            <TabsTrigger value="payments" className="gap-2"><Receipt className="w-4 h-4" /> المدفوعات ({payments.length})</TabsTrigger>
          )}
          {(supplier?.type === "supplier" || supplier?.type === "both") && (
            <TabsTrigger value="discounts" className="gap-2"><Percent className="w-4 h-4" /> الخصومات ({discountShipments.length})</TabsTrigger>
          )}
          {(supplier?.type === "customer" || supplier?.type === "both") && (
            <TabsTrigger value="sales" className="gap-2"><Receipt className="w-4 h-4" /> المبيعات ({invoices.length})</TabsTrigger>
          )}
          <TabsTrigger value="vouchers" className="gap-2"><FileText className="w-4 h-4" /> سندات القبض والصرف ({vouchers.length})</TabsTrigger>
          <TabsTrigger value="plans" className="gap-2"><DollarSign className="w-4 h-4" /> خطط الدفع</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <DataTable
            rows={invoices}
            empty="لا توجد فواتير بيع لهذه الجهة"
            onRowClick={(r: any) => nav(`/branch/${r.branch_id}/sales/${r.id}`)}
            columns={[
              { key: "invoice_number", header: "رقم الفاتورة", render: (r: any) => <span className="font-semibold">{r.invoice_number}</span> },
              { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
              { key: "total", header: "الإجمالي", render: (r: any) => <span className="font-bold text-success">{formatEGP(r.total)}</span> },
              { key: "status", header: "الحالة", render: (r: any) => (
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${r.status === "active" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
                  {r.status === "active" ? "نشطة" : "ملغاة"}
                </span>
              )},
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
            ]}
          />
          {custPayments.length > 0 && (
            <div className="mt-4">
              <h4 className="font-bold mb-2 text-sm">مدفوعات استلمناها منه كعميل</h4>
              <DataTable
                rows={custPayments}
                columns={[
                  { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
                  { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
                  { key: "payment_method", header: "الطريقة" },
                  { key: "reference_number", header: "المرجع", render: (r: any) => r.reference_number ?? "—" },
                  { key: "amount", header: "المبلغ", render: (r: any) => <span className="font-bold text-success">{formatEGP(r.amount)}</span> },
                ]}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="vouchers" className="mt-4">
          <DataTable
            loading={loading}
            rows={vouchers}
            empty="لا توجد سندات قبض أو صرف"
            columns={[
              { key: "voucher_number", header: "رقم السند", render: (r: any) => <span className="font-mono font-semibold">{r.voucher_number}</span> },
              { key: "type", header: "النوع", render: (r: any) => (
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${r.type === "receipt" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
                  {r.type === "receipt" ? "قبض" : "صرف"}
                </span>
              )},
              { key: "voucher_date", header: "التاريخ", render: (r: any) => formatDate(r.voucher_date) },
              { key: "amount", header: "المبلغ", render: (r: any) => <span className="font-bold">{formatEGP(r.amount)}</span> },
              { key: "branch", header: "الفرع", render: (r: any) => <span className="px-2 py-0.5 rounded bg-muted text-xs">{r.branches?.name ?? "—"}</span> },
              { key: "treasury", header: "الخزينة", render: (r: any) => (r.treasury_id ? `خزينة ${r.branches?.name ?? ""}` : "—") },
              { key: "description", header: "البيان", render: (r: any) => r.description ?? "—" },
              { key: "actions", header: "الإجراءات", render: (r: any) => (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="icon" variant="ghost" title="عرض التفاصيل" onClick={() => setViewVoucher(r)}><Eye className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" title="طباعة السند" onClick={() => printVoucher(r)}><Printer className="w-4 h-4" /></Button>
                </div>
              )},
            ]}
          />
          <VoucherViewDialog voucher={viewVoucher} open={!!viewVoucher} onOpenChange={(o) => !o && setViewVoucher(null)} />
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          {supplierId && <PaymentPlansPanel entityType="supplier" entityId={supplierId} direction="out" />}
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          {timeline.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">لا توجد عمليات بعد</div>
          ) : (
            <div className="space-y-3">
              {timeline.map((item, i) => (
                <div
                  key={i}
                  className={`card-elevated p-4 flex items-center gap-4 border-r-4 ${
                    item.kind === "shipment" ? "border-r-warning" : "border-r-success"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      item.kind === "shipment" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                    }`}
                  >
                    {item.kind === "shipment" ? <Truck className="w-5 h-5" /> : <Receipt className="w-5 h-5" />}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{item.subtitle}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{formatDateTime(item.date)}</div>
                  </div>
                  <div className={`font-bold text-lg ${item.kind === "shipment" ? "text-warning" : "text-success"}`}>
                    {item.kind === "shipment" ? "+" : "−"}
                    {formatEGP(item.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="shipments" className="mt-4">
          <DataTable
            loading={loading}
            rows={shipments}
            empty="لا توجد فواتير شراء"
            onRowClick={(r: any) => nav(`/branch/${r.branch_id}/shipments/${r.id}`)}
            columns={[
              { key: "arrival_date", header: "التاريخ", render: (r: any) => formatDate(r.arrival_date) },
              { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
              { key: "received_by", header: "المستلم" },
              { key: "items", header: "أصناف", render: (r: any) => `${shipmentItemCount(r)} (${shipmentUnitsCount(r)})` },
              { key: "shipping_cost", header: "شحن", render: (r: any) => formatEGP(r.shipping_cost) },
              { key: "admin_cost", header: "إدارية", render: (r: any) => formatEGP(r.admin_cost) },
              {
                key: "discount_amount",
                header: "الخصم",
                render: (r: any) =>
                  Number(r.discount_amount ?? 0) > 0 ? (
                    <span className="font-bold text-success">
                      −{formatEGP(r.discount_amount)}
                      {r.discount_type === "percent" ? ` (${Number(r.discount_value)}%)` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "total_cost",
                header: "الإجمالي",
                render: (r: any) => <span className="font-bold text-warning">{formatEGP(r.total_cost)}</span>,
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="discounts" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <StatCard label="عدد فواتير الشراء اللي فيها خصم" value={discountShipments.length} icon={<Percent className="w-5 h-5" />} accent="primary" />
            <StatCard label="إجمالي الخصومات" value={formatEGP(totalDiscounts)} icon={<Percent className="w-5 h-5" />} accent="success" />
            <StatCard label="متوسط نسبة الخصم" value={`${discountPct.toFixed(2)}%`} icon={<Percent className="w-5 h-5" />} accent="secondary" />
          </div>
          <DataTable
            loading={loading}
            rows={discountShipments}
            empty="المورد ده معملش أي خصم لحد دلوقتي"
            onRowClick={(r: any) => nav(`/branch/${r.branch_id}/shipments/${r.id}`)}
            columns={[
              { key: "arrival_date", header: "تاريخ الخصم", render: (r: any) => formatDate(r.arrival_date) },
              { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
              {
                key: "discount_type",
                header: "نوع الخصم",
                render: (r: any) =>
                  r.discount_type === "percent" ? `نسبة ${Number(r.discount_value)}%` : "مبلغ ثابت",
              },
              {
                key: "gross",
                header: "قبل الخصم",
                render: (r: any) => formatEGP(Number(r.total_cost) + Number(r.discount_amount ?? 0)),
              },
              {
                key: "discount_amount",
                header: "قيمة الخصم",
                render: (r: any) => <span className="font-bold text-success">−{formatEGP(r.discount_amount)}</span>,
              },
              {
                key: "total_cost",
                header: "بعد الخصم",
                render: (r: any) => <span className="font-bold text-warning">{formatEGP(r.total_cost)}</span>,
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <DataTable
            loading={loading}
            rows={payments}
            empty="لا توجد مدفوعات بعد"
            columns={[
              { key: "paid_at", header: "تاريخ الدفع", render: (r: any) => formatDateTime(r.paid_at) },
              { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
              { key: "paid_by", header: "بواسطة", render: (r: any) => r.profiles?.name ?? "—" },
              { key: "notes", header: "ملاحظات", render: (r: any) => r.notes ?? "—" },
              {
                key: "amount",
                header: "المبلغ",
                render: (r: any) => <span className="font-bold text-success">{formatEGP(r.amount)}</span>,
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* Multi-method Pay Dialog */}
      {payOpen && supplierId && (
        <MultiMethodPaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          mode={{ kind: "contact", contactId: supplierId, branchId: branchId ?? branches[0]?.id }}
          defaultAmount={owedByUs}
          direction="out"
          title={`سداد للمورد — ${supplier?.name ?? ""}`}
          onSuccess={load}
        />
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل بيانات المورد</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>النوع *</Label>
              <Select value={edit.type} onValueChange={(v) => setEdit({ ...edit, type: v as any })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">عميل</SelectItem>
                  <SelectItem value="supplier">مورد</SelectItem>
                  <SelectItem value="both">عميل ومورد</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الاسم *</Label>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>المسؤول</Label>
              <Input value={edit.contact_person} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>التليفون</Label>
              <Input dir="ltr" className="text-right mt-1.5" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </div>
            <div>
              <Label>العنوان</Label>
              <Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              إلغاء
            </Button>
            <Button className="btn-gradient" onClick={submitEdit}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المورد؟</AlertDialogTitle>
            <AlertDialogDescription>
              هتفقد كل بيانات المورد <b>{supplier?.name}</b>. مينفعش الحذف لو ليه فواتير شراء مسجلة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={submitDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
