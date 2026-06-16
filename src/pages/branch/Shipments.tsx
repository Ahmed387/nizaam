import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PermGate } from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { Plus, Eye, Trash2 } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { toast } from "sonner";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";

export default function Shipments() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { tenantId, user, profile, isAdmin, hasRole } = useAuth();
  const isManager = hasRole("branch_manager");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [fSupplier, setFSupplier] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fFrom, setFFrom] = useState<string>("");
  const [fTo, setFTo] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("shipments")
      .select("*, contacts(name)")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    const ships = data ?? [];
    // Compute paid status per shipment by allocating supplier payments FIFO (oldest shipments first)
    const contactIds = Array.from(new Set(ships.map((s: any) => s.contact_id).filter(Boolean)));
    let paidByContact = new Map<string, number>();
    if (contactIds.length) {
      const { data: pays } = await supabase
        .from("supplier_payments")
        .select("contact_id, amount")
        .in("contact_id", contactIds);
      (pays ?? []).forEach((p: any) => {
        paidByContact.set(p.contact_id, (paidByContact.get(p.contact_id) ?? 0) + Number(p.amount || 0));
      });
    }
    // Allocate FIFO: oldest shipments get paid first
    const byContact = new Map<string, any[]>();
    [...ships].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .forEach((s) => {
        if (!s.contact_id) return;
        const arr = byContact.get(s.contact_id) ?? [];
        arr.push(s);
        byContact.set(s.contact_id, arr);
      });
    const paidStatus = new Map<string, { paid: number; total: number }>();
    byContact.forEach((list, cid) => {
      let remaining = paidByContact.get(cid) ?? 0;
      list.forEach((s) => {
        const total = Number(s.total_cost || 0);
        const applied = Math.max(0, Math.min(remaining, total));
        remaining -= applied;
        paidStatus.set(s.id, { paid: applied, total });
      });
    });
    const enriched = ships.map((s: any) => {
      const ps = paidStatus.get(s.id) ?? { paid: 0, total: Number(s.total_cost || 0) };
      return { ...s, _paid_amount: ps.paid, _payment_status: ps.paid >= ps.total - 0.01 ? "paid" : ps.paid > 0 ? "partial" : "unpaid" };
    });
    setRows(enriched);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["shipments", "supplier_payments"], load);
  const shipmentIds = useMemo(() => rows.map((r: any) => r.id), [rows]);
  const attCounts = useAttachmentCounts("shipment", shipmentIds);

  const doDelete = async () => {
    if (!delTarget) return;
    const label = `شحنة ${delTarget.contacts?.name ?? ""} بتاريخ ${formatDate(delTarget.arrival_date)}`;
    if (isAdmin) {
      const { error } = await supabase.from("shipments").delete().eq("id", delTarget.id);
      if (error) return toast.error(error.message);
      toast.success("تم حذف الشحنة");
    } else if (isManager) {
      if (!reason.trim()) return toast.error("اكتب سبب الحذف");
      const ok = await createApprovalRequest({
        tenantId: tenantId!, branchId: branchId ?? null,
        entityType: "shipment", entityId: delTarget.id, entityLabel: label,
        action: "delete", reason,
        requestedBy: user!.id, requestedByName: profile?.name ?? "—",
      });
      if (!ok) return;
    } else return toast.error("غير مصرح");
    setDelTarget(null); setReason(""); load();
  };

  return (
    <BranchLayout>
      <PageHeader
        title="الشحنات"
        subtitle="استلام البضاعة من الموردين"
        actions={
          <PermGate perm="shipments.create">
            <Button onClick={() => nav(`/branch/${branchId}/shipments/new`)} className="gap-2">
              <Plus className="w-4 h-4" /> شحنة جديدة
            </Button>
          </PermGate>
        }
      />

      {(() => {
        const suppliers = Array.from(new Map(rows.filter(r => r.contact_id).map(r => [r.contact_id, r.contacts?.name ?? "—"])).entries());
        const filtered = rows.filter((r: any) => {
          if (fSupplier !== "all" && r.contact_id !== fSupplier) return false;
          if (fStatus !== "all" && r._payment_status !== fStatus) return false;
          if (fFrom && r.arrival_date && r.arrival_date < fFrom) return false;
          if (fTo && r.arrival_date && r.arrival_date > fTo) return false;
          if (search) {
            const q = search.toLowerCase();
            const hay = `${r.contacts?.name ?? ""} ${r.received_by ?? ""} ${r.notes ?? ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
        return (
          <>
            <Card className="p-3 mb-3 grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">بحث (مورد / مستلم)</Label>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث..." className="h-9" />
              </div>
              <div>
                <Label className="text-xs">المورد</Label>
                <Select value={fSupplier} onValueChange={setFSupplier}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {suppliers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">حالة الدفع</Label>
                <Select value={fStatus} onValueChange={setFStatus}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="paid">مدفوعة بالكامل</SelectItem>
                    <SelectItem value="partial">مدفوعة جزئياً</SelectItem>
                    <SelectItem value="unpaid">غير مدفوعة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">من تاريخ</Label>
                <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">إلى تاريخ</Label>
                <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="h-9" />
              </div>
            </Card>

            <DataTable
              loading={loading}
              rows={filtered}
              empty="لا توجد شحنات بعد"
        columns={[
          { key: "arrival_date", header: "تاريخ الوصول", render: (r: any) => <span className="inline-flex items-center gap-1.5">{formatDate(r.arrival_date)}<AttachmentIndicator count={attCounts[r.id] ?? 0} /></span> },
          { key: "supplier", header: "المورد", render: (r: any) => r.contacts?.name ?? "—" },
          { key: "received_by", header: "المستلم" },
          { key: "shipping_cost", header: "شحن", render: (r: any) => formatEGP(r.shipping_cost) },
          { key: "admin_cost", header: "إدارية", render: (r: any) => formatEGP(r.admin_cost) },
          { key: "total_cost", header: "الإجمالي", render: (r: any) => <b className="text-primary">{formatEGP(r.total_cost)}</b> },
          {
            key: "payment_status",
            header: "حالة الدفع",
            render: (r: any) => {
              const status = r._payment_status;
              const paid = r._paid_amount ?? 0;
              const total = Number(r.total_cost || 0);
              if (status === "paid") {
                return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-600 font-medium">مدفوعة بالكامل</span>;
              }
              if (status === "partial") {
                const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                return (
                  <div className="flex flex-col gap-0.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-600 font-medium w-fit">مدفوعة جزئياً ({pct}%)</span>
                    <span className="text-[10px] text-muted-foreground">متبقي {formatEGP(total - paid)}</span>
                  </div>
                );
              }
              return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-destructive/10 text-destructive font-medium">غير مدفوعة</span>;
            },
          },
          {
            key: "actions",
            header: "",
            render: (r: any) => (
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" onClick={() => nav(`/branch/${branchId}/shipments/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                {(isAdmin || isManager) && (
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" title={isAdmin ? "حذف" : "طلب حذف"} onClick={() => { setDelTarget(r); setReason(""); }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
            />
          </>
        );
      })()}



      <AlertDialog open={!!delTarget} onOpenChange={(o) => { if (!o) { setDelTarget(null); setReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isManager && !isAdmin ? "طلب حذف شحنة للموافقة" : "حذف الشحنة"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isManager && !isAdmin
                ? <>سيتم إرسال الطلب لمدير الشركة للموافقة. سيصلك إشعار بالقرار.</>
                : <>هل أنت متأكد من حذف هذه الشحنة؟ لن يمكن التراجع.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isManager && !isAdmin && (
            <div className="px-1">
              <Label>سبب الحذف *</Label>
              <Textarea className="mt-1.5" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اكتب السبب..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={doDelete}>
              {isManager && !isAdmin ? "إرسال الطلب" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BranchLayout>
  );
}
