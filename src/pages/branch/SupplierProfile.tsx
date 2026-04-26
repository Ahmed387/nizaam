import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { toast } from "sonner";
import { ArrowRight, Truck, DollarSign, Wallet, Phone, MapPin, User, Plus } from "lucide-react";

export default function SupplierProfile() {
  const { id: branchId, supplierId } = useParams<{ id: string; supplierId: string }>();
  const nav = useNavigate();
  const { user, profile, tenantId, branches } = useAuth();
  const [supplier, setSupplier] = useState<any>(null);
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", branch_id: branchId ?? "", notes: "" });

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: ships }] = await Promise.all([
      supabase.from("suppliers").select("*").eq("id", supplierId!).maybeSingle(),
      supabase.from("shipments").select("*, branches(name)").eq("supplier_id", supplierId!).order("created_at", { ascending: false }),
    ]);
    setSupplier(s);
    setShipments(ships ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [supplierId]);

  const totalShipments = shipments.reduce((s, x) => s + Number(x.total_cost), 0);
  const balance = Number(supplier?.balance ?? 0);
  const totalPaid = totalShipments - balance;

  const submitPayment = async () => {
    const amount = Number(pay.amount);
    if (!amount || amount <= 0) return toast.error("أدخل مبلغ صحيح");
    if (!pay.branch_id) return toast.error("اختر الفرع");

    // Deduct from treasury (expense)
    const { error: trErr } = await supabase.from("treasury").insert({
      branch_id: pay.branch_id,
      type: "expense",
      category: "other",
      amount,
      description: `سداد دفعة للمورد: ${supplier.company_name}${pay.notes ? " — " + pay.notes : ""}`,
      reference_id: supplierId,
      created_by: user!.id,
      tenant_id: tenantId,
    } as any);
    if (trErr) return toast.error(trErr.message);

    // Reduce supplier balance
    await supabase.from("suppliers").update({ balance: balance - amount }).eq("id", supplierId!);

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

  return (
    <BranchLayout>
      <PageHeader
        title={supplier?.company_name ?? "ملف المورد"}
        subtitle={supplier?.contact_name ?? ""}
        actions={
          <div className="flex gap-2">
            <Button className="btn-gradient" onClick={() => setPayOpen(true)}>
              <DollarSign className="w-4 h-4 ml-1" /> سداد دفعة
            </Button>
            <Button variant="outline" onClick={() => nav(`/branch/${branchId}/suppliers`)}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
          </div>
        }
      />

      {supplier && (
        <div className="card-elevated p-5 mb-6 grid md:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" /> {supplier.contact_name ?? "—"}</div>
          <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /> <span dir="ltr">{supplier.phone ?? "—"}</span></div>
          <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /> {supplier.address ?? "—"}</div>
          {supplier.notes && <div className="md:col-span-3 text-muted-foreground">📝 {supplier.notes}</div>}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="عدد الشحنات" value={shipments.length} icon={<Truck className="w-5 h-5" />} accent="primary" />
        <StatCard label="إجمالي الشحنات" value={formatEGP(totalShipments)} icon={<DollarSign className="w-5 h-5" />} accent="secondary" />
        <StatCard label="إجمالي المدفوع" value={formatEGP(totalPaid)} icon={<Wallet className="w-5 h-5" />} accent="success" />
        <StatCard
          label="المتبقي عليك"
          value={formatEGP(balance)}
          icon={<DollarSign className="w-5 h-5" />}
          accent={balance > 0 ? "warning" : "success"}
        />
      </div>

      <h3 className="font-bold mb-3">سجل الشحنات</h3>
      <DataTable
        loading={loading}
        rows={shipments}
        onRowClick={(r: any) => nav(`/branch/${r.branch_id}/shipments/${r.id}`)}
        columns={[
          { key: "arrival_date", header: "تاريخ الوصول", render: (r: any) => formatDateTime(r.arrival_date) },
          { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
          { key: "received_by", header: "المستلم" },
          { key: "shipping_cost", header: "شحن", render: (r: any) => formatEGP(r.shipping_cost) },
          { key: "admin_cost", header: "إدارية", render: (r: any) => formatEGP(r.admin_cost) },
          { key: "total_cost", header: "الإجمالي", render: (r: any) => <span className="font-bold">{formatEGP(r.total_cost)}</span> },
        ]}
      />

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>تسجيل دفعة للمورد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-surface-2 text-sm">
              <div>المتبقي عليك: <span className="font-bold text-warning">{formatEGP(balance)}</span></div>
            </div>
            <div>
              <Label>الفرع (يخصم من خزنته) *</Label>
              <Select value={pay.branch_id} onValueChange={(v) => setPay({ ...pay, branch_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المبلغ *</Label>
              <Input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submitPayment}>تأكيد السداد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
