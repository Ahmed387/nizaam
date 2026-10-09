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
import { CancelPurchaseDialog } from "@/components/CancelPurchaseDialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { Plus, Eye, XCircle, FileDown } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { toast } from "sonner";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { generateShipmentsReport } from "@/utils/generatePDFReport";

export default function Shipments() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile, isAdmin, hasRole } = useAuth();
  const isManager = hasRole("branch_manager");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<any>(null);
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
    // Cancelled invoices are outside the supplier statement — they take no payment.
    [...ships].filter((s: any) => s.status !== "cancelled").sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
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
      if (s.status === "cancelled") return { ...s, _paid_amount: 0, _payment_status: "cancelled" };
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

  const [branchName, setBranchName] = useState("");
  useEffect(() => {
    if (!branchId) return;
    supabase.from("branches").select("name").eq("id", branchId).maybeSingle()
      .then(({ data }) => setBranchName(data?.name ?? ""));
  }, [branchId]);

  const filtered = useMemo(() => rows.filter((r: any) => {
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
  }), [rows, fSupplier, fStatus, fFrom, fTo, search]);

  const handleExportPdf = async () => {
    if (!branchId) return;
    if (filtered.length === 0) { toast.error("لا توجد فواتير شراء لتصديرها"); return; }
    await generateShipmentsReport({
      branchId, branchName,
      shipments: filtered,
      filters: { from: fFrom || undefined, to: fTo || undefined },
      userName: profile?.name ?? "—",
    });
  };

  return (
    <BranchLayout backTo={`/branch/${branchId}/dashboard`} backLabel="الرئيسية">
      <PageHeader
        title="فواتير الشراء"
        subtitle="استلام البضاعة من الموردين"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportPdf} className="gap-2">
              <FileDown className="w-4 h-4" /> تحميل PDF
            </Button>
            <PermGate perm="shipments.create">
              <Button onClick={() => nav(`/branch/${branchId}/shipments/new`)} className="gap-2">
                <Plus className="w-4 h-4" /> فاتورة شراء جديدة
              </Button>
            </PermGate>
          </div>
        }
      />

      {(() => {
        const suppliers = Array.from(new Map(rows.filter(r => r.contact_id).map(r => [r.contact_id, r.contacts?.name ?? "—"])).entries());
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
                    <SelectItem value="cancelled">ملغاة</SelectItem>
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
              empty="لا توجد فواتير شراء بعد"
              onRowClick={(r: any) => nav(`/branch/${branchId}/shipments/${r.id}`)}
        columns={[
          { key: "arrival_date", header: "تاريخ الوصول", render: (r: any) => formatDate(r.arrival_date) },
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
              if (status === "cancelled") {
                return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-destructive font-semibold" title={r.cancel_reason ?? undefined}>ملغاة</span>;
              }
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
                <AttachmentsDialogButton recordType="shipment" recordId={r.id} count={attCounts[r.id] ?? 0} />
                <Button size="sm" variant="ghost" onClick={() => nav(`/branch/${branchId}/shipments/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                {(isAdmin || isManager) && r.status !== "cancelled" && (
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" title={isAdmin ? "إلغاء فاتورة الشراء" : "طلب إلغاء"} onClick={() => setCancelTarget(r)}>
                    <XCircle className="w-4 h-4" />
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



      <CancelPurchaseDialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null); }} shipment={cancelTarget} onDone={() => { setCancelTarget(null); load(); }} />
    </BranchLayout>
  );
}
