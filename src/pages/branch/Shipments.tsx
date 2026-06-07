import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PermGate } from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { Plus, Eye, Trash2 } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { toast } from "sonner";

export default function Shipments() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { tenantId, user, profile, isAdmin, hasRole } = useAuth();
  const isManager = hasRole("branch_manager");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<any>(null);
  const [reason, setReason] = useState("");

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

      <DataTable
        loading={loading}
        rows={rows}
        empty="لا توجد شحنات بعد"
        columns={[
          { key: "arrival_date", header: "تاريخ الوصول", render: (r: any) => formatDate(r.arrival_date) },
          { key: "supplier", header: "المورد", render: (r: any) => r.contacts?.name ?? "—" },
          { key: "received_by", header: "المستلم" },
          { key: "shipping_cost", header: "شحن", render: (r: any) => formatEGP(r.shipping_cost) },
          { key: "admin_cost", header: "إدارية", render: (r: any) => formatEGP(r.admin_cost) },
          { key: "total_cost", header: "الإجمالي", render: (r: any) => <b className="text-primary">{formatEGP(r.total_cost)}</b> },
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
