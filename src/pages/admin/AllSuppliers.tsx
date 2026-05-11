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
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileSpreadsheet, ArrowDown, ArrowUp, Eye, PackagePlus, Truck, Loader2 } from "lucide-react";

interface Supplier {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
  created_at: string;
}

interface ShipmentSummary {
  supplier_id: string;
  branch_id: string;
  branch_name: string;
  total: number;
  count: number;
}

interface PaymentSummary {
  supplier_id: string;
  branch_id: string;
  branch_name: string;
  total: number;
  count: number;
}

export default function AllSuppliers() {
  const { tenantId, user } = useAuth();
  const nav = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [shipSums, setShipSums] = useState<ShipmentSummary[]>([]);
  const [paySums, setPaySums] = useState<PaymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [balanceFilter, setBalanceFilter] = useState<"all" | "owed_to_us" | "owed_by_us" | "settled">("all");
  const [branchFilter, setBranchFilter] = useState("all");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ company_name: "", contact_name: "", phone: "", address: "", notes: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<Supplier | null>(null);
  const [details, setDetails] = useState<Supplier | null>(null);
  const [shipmentsView, setShipmentsView] = useState<Supplier | null>(null);
  const [shipmentsList, setShipmentsList] = useState<any[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipBranchFilter, setShipBranchFilter] = useState("all");

  // New shipment dialog
  const [newShipOpen, setNewShipOpen] = useState(false);
  const [shipForm, setShipForm] = useState({
    supplier_id: "",
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
      supabase.from("suppliers").select("*").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("shipments").select("supplier_id, branch_id, total_cost, branches(name)"),
      supabase.from("supplier_payments").select("supplier_id, branch_id, amount, branches(name)"),
    ]);
    setSuppliers((sups ?? []) as any);
    setBranches(brs ?? []);

    // تجميع الشحنات لكل (مورد + فرع)
    const shipMap = new Map<string, ShipmentSummary>();
    for (const s of (ships ?? []) as any[]) {
      if (!s.supplier_id || !s.branch_id) continue;
      const key = `${s.supplier_id}|${s.branch_id}`;
      const cur = shipMap.get(key) ?? { supplier_id: s.supplier_id, branch_id: s.branch_id, branch_name: s.branches?.name ?? "—", total: 0, count: 0 };
      cur.total += Number(s.total_cost) || 0;
      cur.count += 1;
      shipMap.set(key, cur);
    }
    setShipSums(Array.from(shipMap.values()));

    // تجميع المدفوعات لكل (مورد + فرع)
    const payMap = new Map<string, PaymentSummary>();
    for (const p of (pays ?? []) as any[]) {
      if (!p.supplier_id || !p.branch_id) continue;
      const key = `${p.supplier_id}|${p.branch_id}`;
      const cur = payMap.get(key) ?? { supplier_id: p.supplier_id, branch_id: p.branch_id, branch_name: p.branches?.name ?? "—", total: 0, count: 0 };
      cur.total += Number(p.amount) || 0;
      cur.count += 1;
      payMap.set(key, cur);
    }
    setPaySums(Array.from(payMap.values()));

    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // إجمالي مشتريات + مدفوعات + فروع لكل مورد
  const enriched = useMemo(() => {
    return suppliers.map((s) => {
      const ships = shipSums.filter((x) => x.supplier_id === s.id);
      const pays = paySums.filter((x) => x.supplier_id === s.id);
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
    if (search && !s.company_name.includes(search) && !(s.contact_name ?? "").includes(search)) return false;
    const bal = Number(s.balance) || 0;
    if (balanceFilter === "owed_to_us" && bal >= 0) return false; // المورد مدين لنا (دفعنا أكتر) → balance سالب
    if (balanceFilter === "owed_by_us" && bal <= 0) return false; // إحنا مدينين (لسه ندفع) → balance موجب
    if (balanceFilter === "settled" && bal !== 0) return false;
    if (branchFilter !== "all" && !s.branchIds.includes(branchFilter)) return false;
    return true;
  }), [enriched, search, balanceFilter, branchFilter]);

  // إحصائيات إجمالية
  const stats = useMemo(() => {
    const owedByUs = enriched.filter((s) => Number(s.balance) > 0).reduce((a, b) => a + Number(b.balance), 0);
    const owedToUs = enriched.filter((s) => Number(s.balance) < 0).reduce((a, b) => a + Math.abs(Number(b.balance)), 0);
    const totalPurchases = enriched.reduce((a, b) => a + b.totalShipments, 0);
    const totalPaid = enriched.reduce((a, b) => a + b.totalPayments, 0);
    return { owedByUs, owedToUs, totalPurchases, totalPaid, count: enriched.length };
  }, [enriched]);

  const openNew = () => { setEditing(null); setForm({ company_name: "", contact_name: "", phone: "", address: "", notes: "" }); setOpen(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({ company_name: s.company_name, contact_name: s.contact_name ?? "", phone: s.phone ?? "", address: s.address ?? "", notes: s.notes ?? "" });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.company_name) return toast.error("اسم الشركة مطلوب");
    const payload = {
      company_name: form.company_name,
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      address: form.address || null,
      notes: form.notes || null,
    };
    if (editing) {
      const { error } = await supabase.from("suppliers").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("تم تحديث المورد");
    } else {
      const { error } = await supabase.from("suppliers").insert({ ...payload, tenant_id: tenantId });
      if (error) return toast.error(error.message);
      toast.success("تمت إضافة المورد");
    }
    setOpen(false); load();
  };

  const remove = async () => {
    if (!deleteConfirm) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", deleteConfirm.id);
    if (error) return toast.error(error.message);
    toast.success("تم حذف المورد");
    setDeleteConfirm(null); load();
  };

  const exportExcel = () => {
    const data = filtered.map((s) => ({
      "اسم الشركة": s.company_name,
      "المسؤول": s.contact_name ?? "—",
      "التليفون": s.phone ?? "—",
      "الفروع": s.branchCount,
      "إجمالي المشتريات": s.totalShipments,
      "إجمالي المدفوعات": s.totalPayments,
      "الرصيد": Number(s.balance) || 0,
      "الحالة": Number(s.balance) > 0 ? "علينا (مدينين)" : Number(s.balance) < 0 ? "لينا (دفعنا زيادة)" : "مسدد",
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
      .eq("supplier_id", s.id)
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
    XLSX.writeFile(wb, `shipments-${shipmentsView.company_name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`تم تصدير ${rows.length} سطر`);
  };

  const openNewShipment = (preSupplierId?: string) => {
    setShipForm({
      supplier_id: preSupplierId ?? "",
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
    supabase.from("products").select("*").eq("branch_id", shipForm.branch_id).order("name")
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
    if (!shipForm.supplier_id) return toast.error("اختر المورد");
    if (!shipForm.branch_id) return toast.error("اختر الفرع");
    if (!shipForm.received_by.trim()) return toast.error("أدخل اسم المستلم");
    if (!shipLines.length) return toast.error("أضف صنفاً واحداً على الأقل");
    for (const l of shipLines) {
      if (!l.product_name.trim() || l.quantity <= 0 || l.cost_price < 0)
        return toast.error("تأكد من بيانات كل الأصناف");
    }
    setShipBusy(true);
    try {
      const { data: ship, error: e1 } = await supabase.from("shipments").insert({
        tenant_id: tenantId,
        branch_id: shipForm.branch_id,
        supplier_id: shipForm.supplier_id,
        arrival_date: shipForm.arrival_date,
        received_by: shipForm.received_by.trim(),
        shipping_cost: Number(shipForm.shipping_cost || 0),
        admin_cost: Number(shipForm.admin_cost || 0),
        total_cost: shipGrandTotal,
        notes: shipForm.notes.trim() || null,
      }).select().single();
      if (e1) throw e1;

      for (const l of shipLines) {
        let pid = l.product_id;
        if (!pid) {
          const sku = `P-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
          const { data: np, error: ep } = await supabase.from("products").insert({
            tenant_id: tenantId,
            branch_id: shipForm.branch_id,
            name: l.product_name.trim(),
            sku,
            cost_price: l.cost_price,
            selling_price: l.cost_price * 1.3,
            market_price: l.cost_price * 1.3,
            quantity: 0,
          }).select().single();
          if (ep) throw ep;
          pid = np.id;
        }
        await supabase.from("shipment_items").insert({
          tenant_id: tenantId,
          shipment_id: ship.id,
          product_id: pid,
          product_name: l.product_name,
          quantity: l.quantity,
          cost_price: l.cost_price,
          total: l.quantity * l.cost_price,
        });
        const cur = branchProducts.find((p) => p.id === pid);
        const newQty = (cur?.quantity ?? 0) + l.quantity;
        await supabase.from("products").update({ quantity: newQty, cost_price: l.cost_price }).eq("id", pid);
      }

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
        title="الموردين (كل الفروع)"
        subtitle="عرض موحّد لكل الموردين عبر فروع الشركة"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
            <Button variant="outline" onClick={() => openNewShipment()}><Truck className="w-4 h-4 ml-1" /> شحنة جديدة</Button>
            <Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> مورد جديد</Button>
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
        onRowClick={(r: any) => nav(`/admin/suppliers/${r.id}`)}
        columns={[
          { key: "company_name", header: "الشركة", render: (r: any) => <div><div className="font-semibold">{r.company_name}</div><div className="text-xs text-muted-foreground">{r.contact_name ?? "—"}</div></div> },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "branches", header: "الفروع", render: (r: any) => <span className="px-2 py-1 rounded text-xs bg-primary/10 text-primary">{r.branchCount} فرع</span> },
          { key: "totalShipments", header: "إجمالي المشتريات", render: (r: any) => <span className="font-semibold">{formatEGP(r.totalShipments)}</span> },
          { key: "totalPayments", header: "المدفوع", render: (r: any) => <span className="text-success">{formatEGP(r.totalPayments)}</span> },
          { key: "balance", header: "الرصيد", render: (r: any) => {
            const bal = Number(r.balance) || 0;
            if (bal === 0) return <span className="text-muted-foreground">— مسدد —</span>;
            if (bal > 0) return <span className="text-destructive font-bold">{formatEGP(bal)} <span className="text-xs">علينا</span></span>;
            return <span className="text-success font-bold">{formatEGP(Math.abs(bal))} <span className="text-xs">لينا</span></span>;
          }},
          { key: "actions", header: "إجراءات", render: (r: any) => (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" title="فتح صفحة المورد" onClick={() => nav(`/admin/suppliers/${r.id}`)}><Eye className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" title="شحنات المورد" onClick={() => openShipments(r)}><Truck className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" title="إضافة شحنة جديدة" onClick={() => openNewShipment(r.id)}><PackagePlus className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={() => setDeleteConfirm(r)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          )},
        ]} />

      {/* Add/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل مورد" : "مورد جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم الشركة *</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>المسؤول</Label><Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="mt-1.5" /></div>
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
            <DialogTitle>{details?.company_name}</DialogTitle>
            <DialogDescription>تفصيل الحركة على كل فرع</DialogDescription>
          </DialogHeader>
          {details && (() => {
            const ships = shipSums.filter((x) => x.supplier_id === details.id);
            const pays = paySums.filter((x) => x.supplier_id === details.id);
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
                    <span className={`font-bold text-lg ${Number(details.balance) > 0 ? "text-destructive" : Number(details.balance) < 0 ? "text-success" : ""}`}>
                      {formatEGP(Math.abs(Number(details.balance) || 0))}
                      <span className="text-xs mr-2">{Number(details.balance) > 0 ? "علينا" : Number(details.balance) < 0 ? "لينا" : "مسدد"}</span>
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
            <DialogTitle>شحنات: {shipmentsView?.company_name}</DialogTitle>
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
              <Select value={shipForm.supplier_id} onValueChange={(v) => setShipForm({ ...shipForm, supplier_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="— اختر —" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.company_name}</SelectItem>)}
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
                        <td className="p-2 min-w-[260px]">
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
      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المورد</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف <b>{deleteConfirm?.company_name}</b>؟
              <br />لن يمكن التراجع. (الشحنات والمدفوعات المرتبطة لن تُحذف).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={remove}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
