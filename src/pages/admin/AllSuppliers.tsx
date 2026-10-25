import { useEffect, useMemo, useState } from "react";
import { PermCard } from "@/contexts/PermCustomize";
import { PermTable } from "@/components/PermTable";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { searchMatch } from "@/lib/search";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileSpreadsheet, ArrowDown, ArrowUp, Eye, PackagePlus, Truck, Loader2, Receipt, Wallet } from "lucide-react";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { useBranchScope } from "@/lib/branchScope";
import { VoucherDialog } from "@/components/VoucherDialog";
import { FinancialAmount } from "@/components/FinancialAmount";
import { cairoTodayDay } from "@/lib/cairoDate";
import { saveContact, deleteContact } from "@/lib/contactWrites";
import { fetchAllContactsPage, type BalanceFilter, type ContactPageTotals } from "@/lib/ledger";

interface Supplier {
  id: string;
  name: string;
  type: "customer" | "supplier" | "both";
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  customer_balance: number;
  supplier_balance: number;
  customer_overdue: number;
  supplier_overdue: number;
  customer_open: number;
  customer_advance: number;
  supplier_open: number;
  supplier_advance: number;
  created_at: string;
}

interface ShipmentSummary {
  contact_id: string;
  branch_id: string;
  branch_name: string;
  total: number;
  count: number;
}


export default function AllSuppliers() {
  const { tenantId, user, profile, isAdmin, hasRole } = useAuth();
  const nav = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const { filterBranches } = useBranchScope();
  const [shipSums, setShipSums] = useState<ShipmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [balanceFilter, setBalanceFilter] = useState<"all" | BalanceFilter>(
    (new URLSearchParams(window.location.search).get("balance") as BalanceFilter) || "all"
  );
  const [totals, setTotals] = useState<ContactPageTotals | null>(null);
  const [counts, setCounts] = useState({ all: 0, customer: 0, supplier: 0, both: 0 });
  const [branchFilter, setBranchFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "customer" | "supplier" | "both">(
    (new URLSearchParams(window.location.search).get("type") as any) || "all"
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: "", contact_person: "", phone: "", address: "", notes: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<Supplier | null>(null);
  const [shipmentsView, setShipmentsView] = useState<Supplier | null>(null);
  const [shipmentsList, setShipmentsList] = useState<any[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipBranchFilter, setShipBranchFilter] = useState("all");
  const [voucherCtx, setVoucherCtx] = useState<{ type: "receipt" | "payment"; contact: Supplier; branchId: string } | null>(null);

  // New shipment dialog
  const [newShipOpen, setNewShipOpen] = useState(false);
  const [shipForm, setShipForm] = useState({
    contact_id: "",
    branch_id: "",
    arrival_date: cairoTodayDay(),
    received_by: "",
    shipping_cost: 0,
    admin_cost: 0,
    notes: "",
  });
  const [shipLines, setShipLines] = useState<{ product_id: string | null; product_name: string; quantity: number; cost_price: number }[]>([]);
  const [branchProducts, setBranchProducts] = useState<any[]>([]);
  const [shipBusy, setShipBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    // Balances from the unified ledger (contacts_page, all branches or one): customer and supplier
    // sides separate, never netted. Purchases total from active purchase invoices.
    const [page, { data: brs }, { data: ships }] = await Promise.all([
      fetchAllContactsPage({ branchId: branchFilter === "all" ? null : branchFilter, type: typeFilter }),
      supabase.from("branches").select("id, name").eq("is_active", true).eq("is_system", false).order("name"),
      fetchAllRows<any>(() => supabase.from("shipments").select("id, contact_id, branch_id, total_cost, branches(name)").eq("status", "active").order("id")).then((data) => ({ data })),
    ]);
    setSuppliers(page.rows as any);
    setTotals(page.totals);
    setCounts(page.counts as any);
    setBranches(filterBranches((brs ?? []) as any) as any);

    // تجميع فواتير الشراء لكل (مورد + فرع)
    const shipMap = new Map<string, ShipmentSummary>();
    for (const s of (ships ?? []) as any[]) {
      if (!s.contact_id || !s.branch_id) continue;
      const key = `${s.contact_id}|${s.branch_id}`;
      const cur = shipMap.get(key) ?? { contact_id: s.contact_id, branch_id: s.branch_id, branch_name: s.branches?.name ?? "—", total: 0, count: 0 };
      cur.total += Number(s.total_cost) || 0;
      cur.count += 1;
      shipMap.set(key, cur);
    }
    setShipSums(Array.from(shipMap.values()));

    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchFilter, typeFilter]);
  useRealtimeRefresh(["contacts", "shipments", "supplier_payments", "invoices", "invoice_payments", "vouchers", "returns", "purchase_returns", "payment_transactions", "branches"], load);

  // إجمالي المشتريات لكل جهة (فواتير شراء سارية، الفرع المختار أو كل الفروع)
  const enriched = useMemo(() => {
    return suppliers.map((s) => {
      const ships = shipSums.filter((x) => x.contact_id === s.id && (branchFilter === "all" || x.branch_id === branchFilter));
      return { ...s, totalShipments: ships.reduce((a, b) => a + b.total, 0) };
    });
  }, [suppliers, shipSums, branchFilter]);

  const filtered = useMemo(() => enriched.filter((s) => {
    if (search && !searchMatch(search, s.name, s.contact_person)) return false;
    // same rules as the server filter (contacts_page): open documents and unused advances are looked at
    // separately, so a contact with an open invoice AND an advance shows under both
    const co = Number(s.customer_open) || 0, ca = Number(s.customer_advance) || 0;
    const so = Number(s.supplier_open) || 0, sa = Number(s.supplier_advance) || 0;
    switch (balanceFilter) {
      case "owe_us": return co > 0.005;
      case "we_owe": return so > 0.005;
      case "customer_advance": return ca > 0.005;
      case "supplier_advance": return sa > 0.005;
      case "overdue": return (Number(s.customer_overdue) || 0) > 0.005 || (Number(s.supplier_overdue) || 0) > 0.005;
      case "settled": return co <= 0.005 && ca <= 0.005 && so <= 0.005 && sa <= 0.005;
      default: return true;
    }
  }), [enriched, search, balanceFilter]);

  const typeCounts = counts;

  const stats = useMemo(() => ({
    totalPurchases: Math.round(filtered.reduce((a, b) => a + b.totalShipments, 0) * 100) / 100,
    count: filtered.length,
  }), [filtered]);

  const openNew = () => { setEditing(null); setForm({ name: "", contact_person: "", phone: "", address: "", notes: "" }); setOpen(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({ name: s.name, contact_person: s.contact_person ?? "", phone: s.phone ?? "", address: s.address ?? "", notes: s.notes ?? "" });
    setOpen(true);
  };

  const openVoucher = (type: "receipt" | "payment", contact: Supplier & { branchIds?: string[] }) => {
    const selectedBranchId = branchFilter !== "all"
      ? branchFilter
      : contact.branchIds?.[0] ?? branches[0]?.id;
    if (!selectedBranchId) return toast.error("لا يوجد فرع متاح لإنشاء السند");
    setVoucherCtx({ type, contact, branchId: selectedBranchId });
  };

  const submit = async () => {
    if (!form.name) return toast.error("اسم الشركة مطلوب");
    const payload = {
      name: form.name,
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      address: form.address || null,
      notes: form.notes || null,
    };
    if (editing) {
      // Branch manager (non-admin) → send approval request instead of direct update
      if (!isAdmin && hasRole("branch_manager")) {
        const ok = await createApprovalRequest({
          tenantId: tenantId!,
          branchId: (editing as any).branch_id ?? null,
          entityType: "contact",
          entityId: editing.id,
          entityLabel: editing.name,
          action: "update",
          payload,
          reason: "تعديل بيانات جهة تواصل",
          requestedBy: user!.id,
          requestedByName: profile?.name ?? "—",
        });
        if (ok) setOpen(false);
        return;
      }
      const { error } = await saveContact(editing.id, payload);
      if (error) return toast.error(error.message);
      toast.success("تم تحديث المورد");
    } else {
      const { error } = await saveContact(null, { ...payload, type: "both" });   // same as before (column default)
      if (error) return toast.error(error.message);
      toast.success("تمت إضافة المورد");
    }
    setOpen(false); load();
  };

  const [deleteReason, setDeleteReason] = useState("");

  const remove = async () => {
    if (!deleteConfirm) return;
    // Branch manager → send approval request
    if (!isAdmin && hasRole("branch_manager")) {
      const ok = await createApprovalRequest({
        tenantId: tenantId!,
        branchId: (deleteConfirm as any).branch_id ?? null,
        entityType: "contact",
        entityId: deleteConfirm.id,
        entityLabel: deleteConfirm.name,
        action: "delete",
        reason: deleteReason || "أرشفة جهة تواصل",
        requestedBy: user!.id,
        requestedByName: profile?.name ?? "—",
      });
      if (ok) { setDeleteConfirm(null); setDeleteReason(""); }
      return;
    }
    const { error } = await deleteContact(deleteConfirm.id);
    if (error) return toast.error(error.message);
    toast.success("تمت أرشفة الجهة — بياناتها ومستنداتها محفوظة");
    setDeleteConfirm(null); load();
  };

  const exportExcel = () => {
    const sideText = (side: "c" | "s", v: number) => Math.abs(v) <= 0.005 ? "مسدد"
      : side === "c" ? (v > 0 ? "مستحق لنا على العميل" : "مقدم من العميل عندنا")
      : (v > 0 ? "مستحق للمورد علينا" : "مقدم لينا عند المورد");
    const data = filtered.map((s) => ({
      "الاسم": s.name,
      "النوع": s.type === "customer" ? "عميل" : s.type === "supplier" ? "مورد" : "عميل ومورد",
      "المسؤول": s.contact_person ?? "—",
      "التليفون": s.phone ?? "—",
      "إجمالي المشتريات": s.totalShipments,
      "حساب العميل": Number(s.customer_balance) || 0,
      "حالة حساب العميل": sideText("c", Number(s.customer_balance) || 0),
      "حساب المورد": Number(s.supplier_balance) || 0,
      "حالة حساب المورد": sideText("s", Number(s.supplier_balance) || 0),
      "تاريخ الإضافة": formatDateTime(s.created_at),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "جهات التعامل");
    XLSX.writeFile(wb, `suppliers-${cairoTodayDay()}.xlsx`);
    toast.success(`تم تصدير ${data.length} جهة`);
  };

  const openShipments = async (s: Supplier) => {
    setShipmentsView(s);
    setShipBranchFilter("all");
    setShipmentsLoading(true);
    setShipmentsList([]);
    try {
      const data = await fetchAllRows<any>(() => supabase
        .from("shipments")
        .select("id, arrival_date, branch_id, total_cost, shipping_cost, admin_cost, received_by, notes, created_at, branches(name), shipment_items(product_name, quantity, cost_price, total)")
        .eq("contact_id", s.id)
        .eq("status", "active")
        .order("arrival_date", { ascending: false })
        .order("id"));
      setShipmentsList(data);
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تحميل فواتير الشراء");
    }
    setShipmentsLoading(false);
  };

  const exportShipments = () => {
    if (!shipmentsView) return;
    const rows: any[] = [];
    for (const sh of shipmentsList) {
      if (shipBranchFilter !== "all" && sh.branch_id !== shipBranchFilter) continue;
      const items = (sh.shipment_items ?? []) as any[];
      if (items.length === 0) {
        rows.push({
          "تاريخ الوصول": sh.arrival_date, "الفرع": sh.branches?.name ?? "—",
          "الصنف": "—", "الكمية": 0, "سعر الوحدة": 0, "الإجمالي": 0,
          "إجمالي فاتورة الشراء": Number(sh.total_cost) || 0, "الشحن": Number(sh.shipping_cost) || 0,
          "مصاريف إدارية": Number(sh.admin_cost) || 0, "المستلم": sh.received_by ?? "—",
        });
      } else {
        for (const it of items) {
          rows.push({
            "تاريخ الوصول": sh.arrival_date, "الفرع": sh.branches?.name ?? "—",
            "الصنف": it.product_name, "الكمية": it.quantity, "سعر الوحدة": Number(it.cost_price) || 0,
            "الإجمالي": Number(it.total) || 0,
            "إجمالي فاتورة الشراء": Number(sh.total_cost) || 0, "الشحن": Number(sh.shipping_cost) || 0,
            "مصاريف إدارية": Number(sh.admin_cost) || 0, "المستلم": sh.received_by ?? "—",
          });
        }
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "فواتير شراء المورد");
    XLSX.writeFile(wb, `shipments-${shipmentsView.name}-${cairoTodayDay()}.xlsx`);
    toast.success(`تم تصدير ${rows.length} سطر`);
  };

  const openNewShipment = (preSupplierId?: string) => {
    setShipForm({
      contact_id: preSupplierId ?? "",
      branch_id: "",
      arrival_date: cairoTodayDay(),
      received_by: "",
      shipping_cost: 0,
      admin_cost: 0,
      notes: "",
    });
    setShipLines([]);
    setBranchProducts([]);
    setNewShipOpen(true);
  };

  useEffect(() => {
    if (!shipForm.branch_id) { setBranchProducts([]); return; }
    supabase.from("products").select("*").eq("branch_id", shipForm.branch_id).is("archived_at", null).order("name")
      .then(({ data }) => setBranchProducts(data ?? []));
  }, [shipForm.branch_id]);

  const addShipLine = () => setShipLines([...shipLines, { product_id: null, product_name: "", quantity: 1, cost_price: 0 }]);
  const updShipLine = (i: number, patch: Partial<typeof shipLines[number]>) => {
    const copy = [...shipLines]; copy[i] = { ...copy[i], ...patch }; setShipLines(copy);
  };
  const rmShipLine = (i: number) => setShipLines(shipLines.filter((_, idx) => idx !== i));
  const onPickProduct = (i: number, pid: string) => {
    if (pid === "__new__") { updShipLine(i, { product_id: null, product_name: "" }); return; }
    const p = branchProducts.find((x) => x.id === pid);
    if (p) updShipLine(i, { product_id: p.id, product_name: p.name, cost_price: Number(p.cost_price) });
  };
  const shipItemsTotal = shipLines.reduce((s, l) => s + (l.quantity * l.cost_price), 0);
  const shipGrandTotal = shipItemsTotal + Number(shipForm.shipping_cost || 0) + Number(shipForm.admin_cost || 0);

  const submitNewShipment = async () => {
    if (!shipForm.contact_id) return toast.error("اختر المورد");
    if (!shipForm.branch_id) return toast.error("اختر الفرع");
    if (!shipForm.received_by.trim()) return toast.error("أدخل اسم المستلم");
    if (!shipLines.length) return toast.error("أضف صنفاً واحداً على الأقل");
    for (const l of shipLines) {
      if (!l.product_name.trim() || l.quantity <= 0 || l.cost_price < 0)
        return toast.error("تأكد من بيانات كل الأصناف");
    }
    setShipBusy(true);
    try {
      // Use the unified record_shipment RPC (same path as NewShipment.tsx)
      const linesPayload = shipLines.map((l) => ({
        product_id: l.product_id,
        product_name: l.product_name.trim(),
        quantity: l.quantity,
        cost_price: l.cost_price,
      }));
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("record_shipment", {
        p_header: {
          branch_id: shipForm.branch_id,
          contact_id: shipForm.contact_id,
          arrival_date: shipForm.arrival_date,
          received_by: shipForm.received_by.trim(),
          shipping_cost: Number(shipForm.shipping_cost || 0),
          admin_cost: Number(shipForm.admin_cost || 0),
          notes: shipForm.notes.trim() || null,
        },
        p_lines: linesPayload,
      });
      if (rpcErr) throw rpcErr;
      const ship = { id: (rpcRes as any).shipment_id } as { id: string };


      // Purchases never move cash: supplier payments go through an explicit payment voucher only.

      toast.success("تم تسجيل فاتورة الشراء وتحديث المخزون");
      setNewShipOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.message ?? "خطأ في حفظ فاتورة الشراء");
    } finally {
      setShipBusy(false);
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="جهات التواصل (كل الفروع)"
        subtitle="عرض موحّد لكل العملاء والموردين عبر فروع الشركة"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
            <Button variant="outline" onClick={() => openNewShipment()}><Truck className="w-4 h-4 ml-1" /> فاتورة شراء جديدة</Button>
            <Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> جهة جديدة</Button>
          </div>
        }
      />

      {/* بطاقات إحصائيات — من الدفتر الموحد: العملاء والموردين كل جانب لوحده */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <PermCard label="عدد الجهات المعروضة"><div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground">عدد الجهات المعروضة</div>
          <div className="text-2xl font-bold mt-1">{stats.count}</div>
        </div></PermCard>
        <PermCard label="إجمالي المشتريات (فواتير شراء سارية)"><div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground">إجمالي المشتريات (فواتير شراء سارية)</div>
          <FinancialAmount value={stats.totalPurchases} size="md" className="mt-1 justify-start text-primary" />
        </div></PermCard>
        <PermCard label="مستحق لنا على العملاء"><button type="button" onClick={() => setBalanceFilter("owe_us")} className="text-right p-4 rounded-lg border bg-warning/5 border-warning/30">
          <div className="text-xs text-warning flex items-center gap-1"><ArrowDown className="w-3 h-3" /> مستحق لنا على العملاء</div>
          <FinancialAmount value={totals?.customers_open ?? 0} size="md" className="mt-1 justify-start text-warning" />
          <div className="text-[11px] text-muted-foreground">{totals?.customers_open_count ?? 0} عميل</div>
        </button></PermCard>
        <PermCard label="مقدمات عملاء عندنا (2150)"><button type="button" onClick={() => setBalanceFilter("customer_advance")} className="text-right p-4 rounded-lg border bg-primary/5 border-primary/30">
          <div className="text-xs text-primary">مقدمات عملاء عندنا (2150)</div>
          <FinancialAmount value={totals?.customer_advances ?? 0} size="md" className="mt-1 justify-start text-primary" />
          <div className="text-[11px] text-muted-foreground">{totals?.customer_advances_count ?? 0} عميل</div>
        </button></PermCard>
        <PermCard label="مستحق للموردين علينا"><button type="button" onClick={() => setBalanceFilter("we_owe")} className="text-right p-4 rounded-lg border bg-destructive/5 border-destructive/30">
          <div className="text-xs text-destructive flex items-center gap-1"><ArrowUp className="w-3 h-3" /> مستحق للموردين علينا</div>
          <FinancialAmount value={totals?.suppliers_open ?? 0} size="md" className="mt-1 justify-start text-destructive" />
          <div className="text-[11px] text-muted-foreground">{totals?.suppliers_open_count ?? 0} مورد</div>
        </button></PermCard>
        <PermCard label="مقدمات لينا عند الموردين (1460)"><button type="button" onClick={() => setBalanceFilter("supplier_advance")} className="text-right p-4 rounded-lg border bg-success/5 border-success/30">
          <div className="text-xs text-success">مقدمات لينا عند الموردين (1460)</div>
          <FinancialAmount value={totals?.supplier_advances ?? 0} size="md" className="mt-1 justify-start text-success" />
          <div className="text-[11px] text-muted-foreground">{totals?.supplier_advances_count ?? 0} مورد</div>
        </button></PermCard>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap">
        {(["all", "customer", "supplier", "both"] as const).map((t) => (
          <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} onClick={() => setTypeFilter(t)}>
            {t === "all" ? "الكل" : t === "customer" ? "عملاء" : t === "supplier" ? "موردين" : "عميل ومورد"}
            <span className="mr-1.5 opacity-70">({typeCounts[t]})</span>
          </Button>
        ))}
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <Input placeholder="ابحث بالاسم أو المسؤول" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={balanceFilter} onValueChange={(v: any) => setBalanceFilter(v)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="owe_us">مستحق لنا على العميل</SelectItem>
            <SelectItem value="customer_advance">العميل له مقدم عندنا</SelectItem>
            <SelectItem value="we_owe">مستحق للمورد علينا</SelectItem>
            <SelectItem value="supplier_advance">لينا مقدم عند المورد</SelectItem>
            <SelectItem value="overdue">أقساط متأخرة</SelectItem>
            <SelectItem value="settled">مسدد (الجانبين صفر)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable loading={loading} rows={filtered}
        onRowClick={(r: any) => window.open(`/admin/contacts/${r.id}`, "_blank", "noopener,noreferrer")}
        columns={[
          { key: "name", header: "الاسم", render: (r: any) => <div><div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.contact_person ?? "—"}</div></div> },
          { key: "type", header: "النوع", render: (r: any) => {
            const t = r.type as "customer" | "supplier" | "both";
            const lbl = t === "customer" ? "عميل" : t === "supplier" ? "مورد" : "عميل ومورد";
            const cls = t === "both" ? "bg-primary/10 text-primary" : t === "customer" ? "bg-success/10 text-success" : "bg-warning/10 text-warning";
            return <span className={`px-2 py-1 rounded text-xs ${cls}`}>{lbl}</span>;
          } },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "totalShipments", header: "إجمالي المشتريات", render: (r: any) => <span className="font-semibold">{formatEGP(r.totalShipments)}</span> },
          { key: "customer_balance", header: "حساب العميل", render: (r: any) => {
            if (r.type === "supplier") return <span className="text-muted-foreground">—</span>;
            const v = Number(r.customer_balance) || 0;
            if (Math.abs(v) <= 0.005) return <span className="text-muted-foreground">مسدد</span>;
            return v > 0
              ? <span className="text-warning font-bold">{formatEGP(v)} <span className="text-xs">لنا عليه</span></span>
              : <span className="text-primary font-bold">{formatEGP(-v)} <span className="text-xs">مقدم منه</span></span>;
          }},
          { key: "supplier_balance", header: "حساب المورد", render: (r: any) => {
            if (r.type === "customer") return <span className="text-muted-foreground">—</span>;
            const v = Number(r.supplier_balance) || 0;
            if (Math.abs(v) <= 0.005) return <span className="text-muted-foreground">مسدد</span>;
            return v > 0
              ? <span className="text-destructive font-bold">{formatEGP(v)} <span className="text-xs">علينا له</span></span>
              : <span className="text-success font-bold">{formatEGP(-v)} <span className="text-xs">مقدم لينا عنده</span></span>;
          }},
          { key: "actions", header: "إجراءات", width: "18rem", className: "min-w-[18rem]", render: (r: any) => (
            <div className="flex min-w-max items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" title="فتح صفحة الجهة في تبويب جديد" onClick={() => window.open(`/admin/contacts/${r.id}`, "_blank", "noopener,noreferrer")}><Eye className="w-3.5 h-3.5" /></Button>
              {(r.type === "customer" || r.type === "both") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-success/50 bg-success/10 text-success hover:bg-success/20 hover:text-success"
                  title="سند قبض"
                  aria-label={`إنشاء سند قبض لـ ${r.name}`}
                  data-voucher-action="receipt"
                  onClick={() => openVoucher("receipt", r)}
                >
                  <Receipt className="w-4 h-4" aria-hidden="true" />
                </Button>
              )}
              {(r.type === "supplier" || r.type === "both") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                  title="سند صرف"
                  aria-label={`إنشاء سند صرف لـ ${r.name}`}
                  data-voucher-action="payment"
                  onClick={() => openVoucher("payment", r)}
                >
                  <Wallet className="w-4 h-4" aria-hidden="true" />
                </Button>
              )}
              <Button size="sm" variant="outline" title="فواتير الشراء" onClick={() => openShipments(r)}><Truck className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" title="إضافة فاتورة شراء جديدة" onClick={() => openNewShipment(r.id)}><PackagePlus className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={() => setDeleteConfirm(r)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          )},
        ]} />

      {voucherCtx && (
        <VoucherDialog
          open
          onOpenChange={(nextOpen) => { if (!nextOpen) setVoucherCtx(null); }}
          branchId={voucherCtx.branchId}
          type={voucherCtx.type}
          initialParty={{
            type: voucherCtx.type === "receipt" ? "customer" : "supplier",
            id: voucherCtx.contact.id,
            name: voucherCtx.contact.name,
          }}
          onSuccess={() => { setVoucherCtx(null); load(); }}
        />
      )}

      {/* Add/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل مورد" : "مورد جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم الشركة *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>المسؤول</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>العنوان</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1.5" /></div>
            <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>{editing ? "حفظ" : "إضافة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Shipments view */}
      <Dialog open={!!shipmentsView} onOpenChange={(o) => !o && setShipmentsView(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>فواتير شراء: {shipmentsView?.name}</DialogTitle>
            <DialogDescription>كل ما نزّله المورد، بالأصناف والكميات والفرع</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 flex-wrap items-center mb-2">
            <Select value={shipBranchFilter} onValueChange={setShipBranchFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="الفرع" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفروع</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportShipments}>
              <FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel
            </Button>
            <div className="text-xs text-muted-foreground mr-auto">
              {shipmentsList.filter((s) => shipBranchFilter === "all" || s.branch_id === shipBranchFilter).length} فاتورة شراء
            </div>
          </div>
          {shipmentsLoading ? (
            <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : shipmentsList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">لا توجد فواتير شراء لهذا المورد.</div>
          ) : (
            <div className="space-y-3">
              {shipmentsList
                .filter((s) => shipBranchFilter === "all" || s.branch_id === shipBranchFilter)
                .map((sh) => {
                  const items = (sh.shipment_items ?? []) as any[];
                  return (
                    <div key={sh.id} className="rounded-md border overflow-hidden">
                      <div className="p-3 bg-muted/40 flex flex-wrap gap-3 items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">{sh.branches?.name ?? "—"}</span>
                          <span className="text-xs text-muted-foreground">وصلت: {sh.arrival_date} • مستلم: {sh.received_by ?? "—"}</span>
                        </div>
                        <div className="flex gap-3 text-xs">
                          <div><span className="text-muted-foreground">إجمالي:</span> <span className="font-bold">{formatEGP(sh.total_cost)}</span></div>
                          {Number(sh.shipping_cost) > 0 && <div><span className="text-muted-foreground">شحن:</span> {formatEGP(sh.shipping_cost)}</div>}
                          {Number(sh.admin_cost) > 0 && <div><span className="text-muted-foreground">إداري:</span> {formatEGP(sh.admin_cost)}</div>}
                        </div>
                      </div>
                      {items.length > 0 ? (
                        <div className="overflow-x-auto">
                        <PermTable className="w-full text-sm">
                          <thead className="bg-background">
                            <tr className="text-xs text-muted-foreground border-b">
                              <th className="text-right p-2">الصنف</th>
                              <th className="text-right p-2">الكمية</th>
                              <th className="text-right p-2">سعر الوحدة</th>
                              <th className="text-right p-2">الإجمالي</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((it, i) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="p-2">{it.product_name}</td>
                                <td className="p-2">{it.quantity}</td>
                                <td className="p-2">{formatEGP(it.cost_price)}</td>
                                <td className="p-2 font-semibold">{formatEGP(it.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </PermTable>
                        </div>
                      ) : (
                        <div className="p-3 text-xs text-muted-foreground">لا توجد أصناف مسجّلة لهذه فاتورة الشراء.</div>
                      )}

                      {sh.notes && <div className="p-2 text-xs text-muted-foreground border-t bg-muted/20">📝 {sh.notes}</div>}
                    </div>
                  );
                })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipmentsView(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New shipment dialog */}
      <Dialog open={newShipOpen} onOpenChange={setNewShipOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تسجيل فاتورة شراء جديدة</DialogTitle>
            <DialogDescription>سيتم إضافة الكميات تلقائياً لمخزون الفرع المحدد</DialogDescription>
          </DialogHeader>

          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <Label>المورد *</Label>
              <Select value={shipForm.contact_id} onValueChange={(v) => setShipForm({ ...shipForm, contact_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="— اختر —" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الفرع المستلم *</Label>
              <Select value={shipForm.branch_id} onValueChange={(v) => setShipForm({ ...shipForm, branch_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="— اختر —" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>تاريخ الوصول</Label>
              <Input type="date" className="mt-1.5" value={shipForm.arrival_date} onChange={(e) => setShipForm({ ...shipForm, arrival_date: e.target.value })} />
            </div>
            <div>
              <Label>اسم المستلم *</Label>
              <Input className="mt-1.5" value={shipForm.received_by} onChange={(e) => setShipForm({ ...shipForm, received_by: e.target.value })} />
            </div>
            <div>
              <Label>تكلفة الشحن</Label>
              <Input type="number" min={0} className="mt-1.5" value={shipForm.shipping_cost} onChange={(e) => setShipForm({ ...shipForm, shipping_cost: Number(e.target.value) })} />
            </div>
            <div>
              <Label>مصاريف إدارية</Label>
              <Input type="number" min={0} className="mt-1.5" value={shipForm.admin_cost} onChange={(e) => setShipForm({ ...shipForm, admin_cost: Number(e.target.value) })} />
            </div>
            <div className="md:col-span-3">
              <Label>ملاحظات</Label>
              <Textarea className="mt-1.5" rows={2} value={shipForm.notes} onChange={(e) => setShipForm({ ...shipForm, notes: e.target.value })} />
            </div>
          </div>

          <div className="rounded-md border mt-3 overflow-hidden">
            <div className="flex items-center justify-between p-3 bg-muted/40 border-b">
              <h4 className="font-bold text-sm">الأصناف</h4>
              <Button size="sm" onClick={addShipLine} disabled={!shipForm.branch_id}>
                <Plus className="w-4 h-4 ml-1" /> إضافة صنف
              </Button>
            </div>
            {!shipForm.branch_id ? (
              <div className="p-6 text-center text-sm text-muted-foreground">اختر الفرع أولاً</div>
            ) : (
              <div className="overflow-x-auto">
                <PermTable className="w-full text-sm">
                  <thead>
                    <tr className="bg-background border-b text-xs text-muted-foreground">
                      <th className="text-right p-2">المنتج</th>
                      <th className="text-right p-2 w-24">الكمية</th>
                      <th className="text-right p-2 w-32">سعر التكلفة</th>
                      <th className="text-right p-2 w-32">الإجمالي</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipLines.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-muted-foreground py-6">اضغط "إضافة صنف"</td></tr>
                    )}
                    {shipLines.map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2">
                          <select
                            value={l.product_id ?? (l.product_name ? "__new__" : "")}
                            onChange={(e) => onPickProduct(i, e.target.value)}
                            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm mb-1"
                          >
                            <option value="">— اختر منتج —</option>
                            {branchProducts.map((p) => (
                              <option key={p.id} value={p.id}>{p.name} (متوفر: {p.quantity})</option>
                            ))}
                            <option value="__new__">+ منتج جديد</option>
                          </select>
                          {l.product_id === null && (
                            <Input placeholder="اسم المنتج الجديد" value={l.product_name} onChange={(e) => updShipLine(i, { product_name: e.target.value })} />
                          )}
                        </td>
                        <td className="p-2"><Input type="number" min={1} value={l.quantity} onChange={(e) => updShipLine(i, { quantity: Number(e.target.value) })} /></td>
                        <td className="p-2"><Input type="number" min={0} step="0.01" value={l.cost_price} onChange={(e) => updShipLine(i, { cost_price: Number(e.target.value) })} /></td>
                        <td className="p-2 font-bold">{formatEGP(l.quantity * l.cost_price)}</td>
                        <td className="p-2">
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => rmShipLine(i)}><Trash2 className="w-4 h-4" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </PermTable>
              </div>
            )}
            <div className="p-3 border-t bg-muted/20 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div><span className="text-muted-foreground">إجمالي البضاعة: </span><b>{formatEGP(shipItemsTotal)}</b></div>
              <div><span className="text-muted-foreground">الشحن: </span><b>{formatEGP(shipForm.shipping_cost)}</b></div>
              <div><span className="text-muted-foreground">إدارية: </span><b>{formatEGP(shipForm.admin_cost)}</b></div>
              <div><span className="text-muted-foreground">الإجمالي: </span><b className="text-primary">{formatEGP(shipGrandTotal)}</b></div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewShipOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient gap-2" onClick={submitNewShipment} disabled={shipBusy}>
              {shipBusy && <Loader2 className="w-4 h-4 animate-spin" />} حفظ فاتورة الشراء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) { setDeleteConfirm(null); setDeleteReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{!isAdmin && hasRole("branch_manager") ? "طلب أرشفة للموافقة" : "أرشفة جهة التعامل"}</AlertDialogTitle>
            <AlertDialogDescription>
              {!isAdmin && hasRole("branch_manager") ? (
                <>سيتم إرسال طلب أرشفة <b>{deleteConfirm?.name}</b> لمدير الشركة للموافقة. سيصلك إشعار بالقرار.</>
              ) : (
                <>هتتأرشف <b>{deleteConfirm?.name}</b> وتختفي من القوائم — مفيش حذف نهائي، وكل مستنداتها وحركاتها محفوظة. الأرشفة مش مسموحة لو عليها أو ليها رصيد مفتوح.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!isAdmin && hasRole("branch_manager") && (
            <div className="px-1">
              <Label>سبب الأرشفة</Label>
              <Textarea className="mt-1.5" value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="اكتب سبب الأرشفة..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={remove}>
              {!isAdmin && hasRole("branch_manager") ? "إرسال طلب الأرشفة" : "أرشفة"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
