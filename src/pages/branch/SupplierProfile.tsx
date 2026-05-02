import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout, AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
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
} from "lucide-react";

export default function SupplierProfile() {
  const { id: branchId, supplierId } = useParams<{ id: string; supplierId: string }>();
  const nav = useNavigate();
  const { user, profile, tenantId, branches, isAdmin } = useAuth();
  const isAdminView = !branchId;
  const Layout = isAdminView ? AdminLayout : BranchLayout;
  const backTo = isAdminView ? `/admin/suppliers` : `/branch/${branchId}/suppliers`;
  const [supplier, setSupplier] = useState<any>(null);
  const [shipments, setShipments] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", branch_id: branchId ?? "", notes: "" });

  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState({ company_name: "", contact_name: "", phone: "", address: "", notes: "" });

  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: ships }, { data: pays }] = await Promise.all([
      supabase.from("suppliers").select("*").eq("id", supplierId!).maybeSingle(),
      supabase
        .from("shipments")
        .select("*, branches(name), shipment_items(id, quantity)")
        .eq("supplier_id", supplierId!)
        .order("arrival_date", { ascending: false }),
      supabase
        .from("supplier_payments" as any)
        .select("*, branches(name), profiles:paid_by(name)")
        .eq("supplier_id", supplierId!)
        .order("paid_at", { ascending: false }),
    ]);
    setSupplier(s);
    setShipments(ships ?? []);
    setPayments((pays as any[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, [supplierId]);

  useEffect(() => {
    if (supplier) {
      setEdit({
        company_name: supplier.company_name ?? "",
        contact_name: supplier.contact_name ?? "",
        phone: supplier.phone ?? "",
        address: supplier.address ?? "",
        notes: supplier.notes ?? "",
      });
    }
  }, [supplier]);

  const totalShipments = shipments.reduce((s, x) => s + Number(x.total_cost), 0);
  const totalPaid = payments.reduce((s, x) => s + Number(x.amount), 0);
  const balance = Number(supplier?.balance ?? 0);
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

  // Unified timeline
  const timeline = useMemo(() => {
    const items: any[] = [];
    shipments.forEach((sh) =>
      items.push({
        kind: "shipment",
        date: sh.arrival_date,
        amount: Number(sh.total_cost),
        title: `شحنة جديدة — ${sh.branches?.name ?? ""}`,
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

  const submitPayment = async () => {
    const amount = Number(pay.amount);
    if (!amount || amount <= 0) return toast.error("أدخل مبلغ صحيح");
    if (!pay.branch_id) return toast.error("اختر الفرع");

    const { data: tr, error: trErr } = await supabase
      .from("treasury")
      .insert({
        branch_id: pay.branch_id,
        type: "expense",
        category: "other",
        amount,
        description: `سداد دفعة للمورد: ${supplier.company_name}${pay.notes ? " — " + pay.notes : ""}`,
        reference_id: supplierId,
        created_by: user!.id,
        tenant_id: tenantId,
      } as any)
      .select()
      .maybeSingle();
    if (trErr) return toast.error(trErr.message);

    const { error: payErr } = await supabase.from("supplier_payments" as any).insert({
      supplier_id: supplierId,
      branch_id: pay.branch_id,
      amount,
      notes: pay.notes || null,
      treasury_id: tr?.id ?? null,
      paid_by: user!.id,
      tenant_id: tenantId,
    } as any);
    if (payErr) return toast.error(payErr.message);
    // ملاحظة: رصيد المورد بيتحدث تلقائياً عبر trigger في قاعدة البيانات

    await logAudit({
      userId: user!.id,
      userName: profile?.name ?? "",
      tenantId,
      branchId: pay.branch_id,
      action: "CREATE",
      entity: "SupplierPayment",
      entityId: supplierId,
      details: { amount, supplier: supplier.company_name, notes: pay.notes },
    });

    toast.success("تم تسجيل السداد");
    setPayOpen(false);
    setPay({ amount: "", branch_id: branchId ?? "", notes: "" });
    load();
  };

  const submitEdit = async () => {
    if (!edit.company_name) return toast.error("اسم الشركة مطلوب");
    const { error } = await supabase.from("suppliers").update(edit).eq("id", supplierId!);
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
      return toast.error("لا يمكن حذف مورد له شحنات. احذف الشحنات أولاً.");
    }
    const { error } = await supabase.from("suppliers").delete().eq("id", supplierId!);
    if (error) return toast.error(error.message);
    await logAudit({
      userId: user!.id,
      userName: profile?.name ?? "",
      tenantId,
      action: "DELETE",
      entity: "Supplier",
      entityId: supplierId,
      details: { company_name: supplier.company_name },
    });
    toast.success("تم الحذف");
    nav(backTo);
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
      <div class="kpi">
        <div>عدد الشحنات <b>${shipments.length}</b></div>
        <div>إجمالي الشحنات <b>${formatEGP(totalShipments)}</b></div>
        <div>إجمالي المدفوع <b class="pos">${formatEGP(totalPaid)}</b></div>
        <div>المتبقي عليك <b class="${balance > 0 ? "neg" : "pos"}">${formatEGP(balance)}</b></div>
      </div>

      <h3>بيانات المورد</h3>
      <table>
        <tr><th>الشركة</th><td>${supplier.company_name}</td><th>المسؤول</th><td>${supplier.contact_name ?? "—"}</td></tr>
        <tr><th>التليفون</th><td dir="ltr">${supplier.phone ?? "—"}</td><th>العنوان</th><td>${supplier.address ?? "—"}</td></tr>
      </table>

      <h3>الشحنات (${shipments.length})</h3>
      <table>
        <thead><tr><th>التاريخ</th><th>الفرع</th><th>المستلم</th><th>شحن</th><th>إدارية</th><th>الإجمالي</th></tr></thead>
        <tbody>${ship || '<tr><td colspan="6" style="text-align:center">لا توجد شحنات</td></tr>'}</tbody>
      </table>

      <h3>المدفوعات (${payments.length})</h3>
      <table>
        <thead><tr><th>التاريخ</th><th>الفرع</th><th>دفع بواسطة</th><th>ملاحظات</th><th>المبلغ</th></tr></thead>
        <tbody>${pays || '<tr><td colspan="5" style="text-align:center">لا توجد مدفوعات</td></tr>'}</tbody>
      </table>
    `;
    printReport(`كشف حساب المورد — ${supplier.company_name}`, html);
  };

  const exportExcel = () => {
    if (!supplier) return;
    const summary = [
      { البيان: "اسم الشركة", القيمة: supplier.company_name },
      { البيان: "المسؤول", القيمة: supplier.contact_name ?? "—" },
      { البيان: "التليفون", القيمة: supplier.phone ?? "—" },
      { البيان: "العنوان", القيمة: supplier.address ?? "—" },
      { البيان: "عدد الشحنات", القيمة: shipments.length },
      { البيان: "عدد الأصناف (إجمالي)", القيمة: totalItemsCount },
      { البيان: "إجمالي الوحدات", القيمة: totalUnits },
      { البيان: "إجمالي الشحنات (جنيه)", القيمة: totalShipments },
      { البيان: "إجمالي المدفوع (جنيه)", القيمة: totalPaid },
      { البيان: "المتبقي عليك (جنيه)", القيمة: balance },
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
    exportToExcel(`كشف حساب — ${supplier.company_name}`, [
      { name: "ملخص", rows: summary },
      { name: "الشحنات", rows: shipRows },
      { name: "المدفوعات", rows: payRows },
    ]);
  };
  return (
    <Layout>
      <PageHeader
        title={supplier?.company_name ?? "ملف المورد"}
        subtitle={supplier?.contact_name ?? ""}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button className="btn-gradient" onClick={() => setPayOpen(true)}>
              <DollarSign className="w-4 h-4 ml-1" /> سداد دفعة
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
            <Button variant="outline" onClick={() => nav(backTo)}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
          </div>
        }
      />

      {supplier && (
        <div className="card-elevated p-5 mb-6 grid md:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" /> {supplier.contact_name ?? "—"}
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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard label="عدد الشحنات" value={shipments.length} icon={<Truck className="w-5 h-5" />} accent="primary" />
        <StatCard label="إجمالي الأصناف" value={`${totalItemsCount} (${totalUnits} وحدة)`} icon={<Package className="w-5 h-5" />} accent="primary" />
        <StatCard label="إجمالي الشحنات" value={formatEGP(totalShipments)} icon={<DollarSign className="w-5 h-5" />} accent="secondary" />
        <StatCard label="إجمالي المدفوع" value={formatEGP(totalPaid)} icon={<Wallet className="w-5 h-5" />} accent="success" />
        <StatCard
          label="المتبقي عليك"
          value={formatEGP(balance)}
          icon={<DollarSign className="w-5 h-5" />}
          accent={balance > 0 ? "warning" : "success"}
        />
      </div>

      <Tabs defaultValue="timeline" className="w-full">
        <TabsList>
          <TabsTrigger value="timeline" className="gap-2"><Activity className="w-4 h-4" /> Timeline</TabsTrigger>
          <TabsTrigger value="shipments" className="gap-2"><Truck className="w-4 h-4" /> الشحنات ({shipments.length})</TabsTrigger>
          <TabsTrigger value="payments" className="gap-2"><Receipt className="w-4 h-4" /> المدفوعات ({payments.length})</TabsTrigger>
        </TabsList>

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
            empty="لا توجد شحنات"
            onRowClick={(r: any) => nav(`/branch/${r.branch_id}/shipments/${r.id}`)}
            columns={[
              { key: "arrival_date", header: "التاريخ", render: (r: any) => formatDate(r.arrival_date) },
              { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
              { key: "received_by", header: "المستلم" },
              { key: "items", header: "أصناف", render: (r: any) => `${shipmentItemCount(r)} (${shipmentUnitsCount(r)})` },
              { key: "shipping_cost", header: "شحن", render: (r: any) => formatEGP(r.shipping_cost) },
              { key: "admin_cost", header: "إدارية", render: (r: any) => formatEGP(r.admin_cost) },
              {
                key: "total_cost",
                header: "الإجمالي",
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

      {/* Pay Dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تسجيل دفعة للمورد</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-surface-2 text-sm">
              <div>
                المتبقي عليك: <span className="font-bold text-warning">{formatEGP(balance)}</span>
              </div>
            </div>
            <div>
              <Label>الفرع (يخصم من خزنته) *</Label>
              <Select value={pay.branch_id} onValueChange={(v) => setPay({ ...pay, branch_id: v })}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المبلغ *</Label>
              <Input
                type="number"
                value={pay.amount}
                onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              إلغاء
            </Button>
            <Button className="btn-gradient" onClick={submitPayment}>
              تأكيد السداد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل بيانات المورد</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>اسم الشركة *</Label>
              <Input value={edit.company_name} onChange={(e) => setEdit({ ...edit, company_name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>المسؤول</Label>
              <Input value={edit.contact_name} onChange={(e) => setEdit({ ...edit, contact_name: e.target.value })} className="mt-1.5" />
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
              هتفقد كل بيانات المورد <b>{supplier?.company_name}</b>. مينفعش الحذف لو ليه شحنات مسجلة.
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
