import { useEffect, useMemo, useState } from "react";
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
import { Plus, Pencil, Trash2, FileSpreadsheet, ArrowDown, ArrowUp, Eye, PackagePlus, Truck } from "lucide-react";

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

  return (
    <AdminLayout>
      <PageHeader
        title="الموردين (كل الفروع)"
        subtitle="عرض موحّد لكل الموردين عبر فروع الشركة"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
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
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setDetails(r)}><Eye className="w-3.5 h-3.5" /></Button>
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
