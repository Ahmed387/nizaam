import { useEffect, useMemo, useState } from "react";
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
import { searchMatch } from "@/lib/search";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileSpreadsheet, ArrowDown, ArrowUp, Eye, PackagePlus, Truck, Loader2, Receipt, Wallet } from "lucide-react";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { useBranchScope } from "@/lib/branchScope";
import { VoucherDialog } from "@/components/VoucherDialog";

interface Supplier {
  id: string;
  name: string;
  type: "customer" | "supplier" | "both";
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
  created_at: string;
}

interface ShipmentSummary {
  contact_id: string;
  branch_id: string;
  branch_name: string;
  total: number;
  count: number;
}

interface PaymentSummary {
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
  const [paySums, setPaySums] = useState<PaymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [balanceFilter, setBalanceFilter] = useState<"all" | "owed_to_us" | "owed_by_us" | "settled">("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "customer" | "supplier" | "both">(
    (new URLSearchParams(window.location.search).get("type") as any) || "all"
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: "", contact_person: "", phone: "", address: "", notes: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<Supplier | null>(null);
  const [details, setDetails] = useState<Supplier | null>(null);
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
    arrival_date: new Date().toISOString().split("T")[0],
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
    const [{ data: sups }, { data: brs }, { data: ships }, { data: pays }] = await Promise.all([
      supabase.from("contacts").select("*").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name").eq("is_active", true).neq("code", "PARTNER-CASH").order("name"),
      supabase.from("shipments").select("contact_id, branch_id, total_cost, branches(name)"),
      supabase.from("supplier_payments").select("contact_id, branch_id, amount, branches(name)"),
    ]);
    // TODO Phase 2.2B: Remove after contacts.balance column is dropped — merge canonical balances
    const list = (sups ?? []) as any[];
    const { fetchContactBalanceMap, mergeBalancesById } = await import("@/lib/contactBalances");
    const balMap = await fetchContactBalanceMap(list.map((c) => c.id));
    setSuppliers(mergeBalancesById(list, balMap) as any);
    setBranches(filterBranches((brs ?? []) as any) as any);

    // تجميع الشحنات لكل (مورد + فرع)
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

    // تجميع المدفوعات لكل (مورد + فرع)
    const payMap = new Map<string, PaymentSummary>();
    for (const p of (pays ?? []) as any[]) {
      if (!p.contact_id || !p.branch_id) continue;
      const key = `${p.contact_id}|${p.branch_id}`;
      const cur = payMap.get(key) ?? { contact_id: p.contact_id, branch_id: p.branch_id, branch_name: p.branches?.name ?? "—", total: 0, count: 0 };
      cur.total += Number(p.amount) || 0;
      cur.count += 1;
      payMap.set(key, cur);
    }
    setPaySums(Array.from(payMap.values()));

    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["contacts", "shipments", "supplier_payments", "branches"], load);

  // إجمالي مشتريات + مدفوعات + فروع لكل مورد
  const enriched = useMemo(() => {
    return suppliers.map((s) => {
      const ships = shipSums.filter((x) => x.contact_id === s.id);
      const pays = paySums.filter((x) => x.contact_id === s.id);
      const totalShipments = ships.reduce((a, b) => a + b.total, 0);
      const totalPayments = pays.reduce((a, b) => a + b.total, 0);
      const branchesUsed = new Set([...ships.map((x) => x.branch_id), ...pays.map((x) => x.branch_id)]);
      return {
        ...s,
        totalShipments,
        totalPayments,
        branchCount: branchesUsed.size,
        branchIds: Array.from(branchesUsed),
      };
    });
  }, [suppliers, shipSums, paySums]);

  const filtered = useMemo(() => enriched.filter((s) => {
    if (search && !searchMatch(search, s.name, s.contact_person)) return false;
    const bal = Number(s.balance) || 0;
    if (balanceFilter === "owed_to_us" && bal <= 0) return false;
    if (balanceFilter === "owed_by_us" && bal >= 0) return false;
    if (balanceFilter === "settled" && bal !== 0) return false;
    if (branchFilter !== "all" && !s.branchIds.includes(branchFilter)) return false;
    if (typeFilter !== "all") {
      if (typeFilter === "customer" && s.type !== "customer" && s.type !== "both") return false;
      if (typeFilter === "supplier" && s.type !== "supplier" && s.type !== "both") return false;
      if (typeFilter === "both" && s.type !== "both") return false;
    }
    return true;
  }), [enriched, search, balanceFilter, branchFilter, typeFilter]);

  const typeCounts = useMemo(() => ({
    all: enriched.length,
    customer: enriched.filter((s) => s.type === "customer" || s.type === "both").length,
    supplier: enriched.filter((s) => s.type === "supplier" || s.type === "both").length,
    both: enriched.filter((s) => s.type === "both").length,
  }), [enriched]);

  const stats = useMemo(() => {
    const owedByUs = enriched.filter((s) => Number(s.balance) < 0).reduce((a, b) => a + Math.abs(Number(b.balance)), 0);
    const owedToUs = enriched.filter((s) => Number(s.balance) > 0).reduce((a, b) => a + Number(b.balance), 0);
    const totalPurchases = enriched.reduce((a, b) => a + b.totalShipments, 0);
    const totalPaid = enriched.reduce((a, b) => a + b.totalPayments, 0);
    return { owedByUs, owedToUs, totalPurchases, totalPaid, count: enriched.length };
  }, [enriched]);

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
      const { error } = await supabase.from("contacts").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("تم تحديث المورد");
    } else {
      const { error } = await supabase.from("contacts").insert({ ...payload, tenant_id: tenantId });
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
        reason: deleteReason || "حذف جهة تواصل",
        requestedBy: user!.id,
        requestedByName: profile?.name ?? "—",
      });
      if (ok) { setDeleteConfirm(null); setDeleteReason(""); }
      return;
    }
    const { error } = await supabase.from("contacts").delete().eq("id", deleteConfirm.id);
    if (error) return toast.error(error.message);
    toast.success("تم حذف المورد");
    setDeleteConfirm(null); load();
  };

  const exportExcel = () => {
    const data = filtered.map((s) => ({
      "اسم الشركة": s.name,
      "المسؤول": s.contact_person ?? "—",
      "التليفون": s.phone ?? "—",
      "الفروع": s.branchCount,
      "إجمالي المشتريات": s.totalShipments,
      "إجمالي المدفوعات": s.totalPayments,
      "الرصيد": Number(s.balance) || 0,
      "الحالة": Number(s.balance) < 0 ? "علينا (مدينين)" : Number(s.balance) > 0 ? "لينا (دفعنا زيادة)" : "مسدد",
      "تاريخ الإضافة": formatDateTime(s.created_at),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الموردين");
    XLSX.writeFile(wb, `suppliers-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`تم تصدير ${data.length} مورد`);
  };

  const openShipments = async (s: Supplier) => {
    setShipmentsView(s);
    setShipBranchFilter("all");
    setShipmentsLoading(true);
    setShipmentsList([]);
    const { data, error } = await supabase
      .from("shipments")
      .select("id, arrival_date, branch_id, total_cost, shipping_cost, admin_cost, received_by, notes, created_at, branches(name), shipment_items(product_name, quantity, cost_price, total)")
      .eq("contact_id", s.id)
      .order("arrival_date", { ascending: false });
    if (error) toast.error(error.message);
    setShipmentsList(data ?? []);
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
          "إجمالي الشحنة": Number(sh.total_cost) || 0, "الشحن": Number(sh.shipping_cost) || 0,
          "مصاريف إدارية": Number(sh.admin_cost) || 0, "المستلم": sh.received_by ?? "—",
        });
      } else {
        for (const it of items) {
          rows.push({
            "تاريخ الوصول": sh.arrival_date, "الفرع": sh.branches?.name ?? "—",
            "الصنف": it.product_name, "الكمية": it.quantity, "سعر الوحدة": Number(it.cost_price) || 0,
            "الإجمالي": Number(it.total) || 0,
            "إجمالي الشحنة": Number(sh.total_cost) || 0, "الشحن": Number(sh.shipping_cost) || 0,
            "مصاريف إدارية": Number(sh.admin_cost) || 0, "المستلم": sh.received_by ?? "—",
          });
        }
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "شحنات المورد");
    XLSX.writeFile(wb, `shipments-${shipmentsView.name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`تم تصدير ${rows.length} سطر`);
  };

  const openNewShipment = (preSupplierId?: string) => {
    setShipForm({
      contact_id: preSupplierId ?? "",
      branch_id: "",
      arrival_date: new Date().toISOString().split("T")[0],
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


      await supabase.from("treasury").insert({
        tenant_id: tenantId,
        branch_id: shipForm.branch_id,
        type: "expense",
        category: "shipment",
        amount: shipGrandTotal,
        description: `شحنة #${ship.id.slice(0, 8)}`,
        reference_id: ship.id,
        created_by: user!.id,
      });

      toast.success("تم تسجيل الشحنة وتحديث المخزون");
      setNewShipOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.message ?? "خطأ في حفظ الشحنة");
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
            <Button variant="outline" onClick={() => openNewShipment()}><Truck className="w-4 h-4 ml-1" /> شحنة جديدة</Button>
            <Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> جهة جديدة</Button>
          </div>
        }
      />

      {/* بطاقات إحصائيات */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground">عدد الموردين</div>
          <div className="text-2xl font-bold mt-1">{stats.count}</div>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground">إجمالي المشتريات</div>
          <div className="text-2xl font-bold mt-1 text-primary">{formatEGP(stats.totalPurchases)}</div>
        </div>
        <div className="p-4 rounded-lg border bg-destructive/5 border-destructive/30">
          <div className="text-xs text-destructive flex items-center gap-1"><ArrowUp className="w-3 h-3" /> اللي علينا (نسددها)</div>
          <div className="text-2xl font-bold mt-1 text-destructive">{formatEGP(stats.owedByUs)}</div>
        </div>
        <div className="p-4 rounded-lg border bg-success/5 border-success/30">
          <div className="text-xs text-success flex items-center gap-1"><ArrowDown className="w-3 h-3" /> اللي لينا (دفعنا زيادة)</div>
          <div className="text-2xl font-bold mt-1 text-success">{formatEGP(stats.owedToUs)}</div>
        </div>
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
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="owed_by_us">عليّنا (مدينين)</SelectItem>
            <SelectItem value="owed_to_us">لينا (دفعنا زيادة)</SelectItem>
            <SelectItem value="settled">مسدد</SelectItem>
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
          { key: "branches", header: "الفروع", render: (r: any) => <span className="px-2 py-1 rounded text-xs bg-primary/10 text-primary">{r.branchCount} فرع</span> },
          { key: "totalShipments", header: "إجمالي المشتريات", render: (r: any) => <span className="font-semibold">{formatEGP(r.totalShipments)}</span> },
          { key: "totalPayments", header: "المدفوع", render: (r: any) => <span className="text-success">{formatEGP(r.totalPayments)}</span> },
          { key: "balance", header: "الرصيد", render: (r: any) => {
            const bal = Number(r.balance) || 0;
            if (bal === 0) return <span className="text-muted-foreground">— مسدد —</span>;
            if (bal < 0) return <span className="text-destructive font-bold">{formatEGP(Math.abs(bal))} <span className="text-xs">علينا</span></span>;
            return <span className="text-success font-bold">{formatEGP(bal)} <span className="text-xs">لينا</span></span>;
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
              <Button size="sm" variant="outline" title="الشحنات" onClick={() => openShipments(r)}><Truck className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" title="إضافة شحنة جديدة" onClick={() => openNewShipment(r.id)}><PackagePlus className="w-3.5 h-3.5" /></Button>
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

      {/* Details dialog: per-branch breakdown */}
      <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{details?.name}</DialogTitle>
            <DialogDescription>تفصيل الحركة على كل فرع</DialogDescription>
          </DialogHeader>
          {details && (() => {
            const ships = shipSums.filter((x) => x.contact_id === details.id);
            const pays = paySums.filter((x) => x.contact_id === details.id);
            const branchIds = Array.from(new Set([...ships.map((x) => x.branch_id), ...pays.map((x) => x.branch_id)]));
            return (
              <div className="space-y-3">
                {branchIds.length === 0 && <div className="text-sm text-muted-foreground">لا توجد حركة لهذا المورد بعد.</div>}
                {branchIds.map((bid) => {
                  const branchName = branches.find((b) => b.id === bid)?.name ?? "—";
                  const ship = ships.find((x) => x.branch_id === bid);
                  const pay = pays.find((x) => x.branch_id === bid);
                  return (
                    <div key={bid} className="p-3 rounded-md border">
                      <div className="font-semibold mb-2 flex items-center gap-2">
                        <PackagePlus className="w-4 h-4 text-primary" /> {branchName}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <div className="text-muted-foreground text-xs">المشتريات</div>
                          <div className="font-bold">{formatEGP(ship?.total ?? 0)} <span className="text-xs text-muted-foreground">({ship?.count ?? 0} شحنة)</span></div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">المدفوعات</div>
                          <div className="font-bold text-success">{formatEGP(pay?.total ?? 0)} <span className="text-xs text-muted-foreground">({pay?.count ?? 0} دفعة)</span></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="p-3 rounded-md border-2 border-primary/30 bg-primary/5">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">الرصيد الإجمالي:</span>
                    <span className={`font-bold text-lg ${Number(details.balance) < 0 ? "text-destructive" : Number(details.balance) > 0 ? "text-success" : ""}`}>
                      {formatEGP(Math.abs(Number(details.balance) || 0))}
                      <span className="text-xs mr-2">{Number(details.balance) < 0 ? "علينا" : Number(details.balance) > 0 ? "لينا" : "مسدد"}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetails(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shipments view */}
      <Dialog open={!!shipmentsView} onOpenChange={(o) => !o && setShipmentsView(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>شحنات: {shipmentsView?.name}</DialogTitle>
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
              {shipmentsList.filter((s) => shipBranchFilter === "all" || s.branch_id === shipBranchFilter).length} شحنة
            </div>
          </div>
          {shipmentsLoading ? (
            <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : shipmentsList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">لا توجد شحنات لهذا المورد.</div>
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
                        <table className="w-full text-sm">
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
                        </table>
                        </div>
                      ) : (
                        <div className="p-3 text-xs text-muted-foreground">لا توجد أصناف مسجّلة لهذه الشحنة.</div>
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
            <DialogTitle>تسجيل شحنة جديدة</DialogTitle>
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
                <table className="w-full text-sm">
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
                </table>
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
              {shipBusy && <Loader2 className="w-4 h-4 animate-spin" />} حفظ الشحنة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) { setDeleteConfirm(null); setDeleteReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{!isAdmin && hasRole("branch_manager") ? "طلب حذف للموافقة" : "حذف المورد"}</AlertDialogTitle>
            <AlertDialogDescription>
              {!isAdmin && hasRole("branch_manager") ? (
                <>سيتم إرسال طلب حذف <b>{deleteConfirm?.name}</b> لمدير الشركة للموافقة. سيصلك إشعار بالقرار.</>
              ) : (
                <>هل أنت متأكد من حذف <b>{deleteConfirm?.name}</b>؟<br />لن يمكن التراجع. (الشحنات والمدفوعات المرتبطة لن تُحذف).</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!isAdmin && hasRole("branch_manager") && (
            <div className="px-1">
              <Label>سبب الحذف</Label>
              <Textarea className="mt-1.5" value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="اكتب سبب طلب الحذف..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={remove}>
              {!isAdmin && hasRole("branch_manager") ? "إرسال طلب الحذف" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
