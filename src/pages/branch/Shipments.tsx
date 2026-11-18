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
import { fetchDocumentStatus } from "@/lib/ledger";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatEGP, formatDate } from "@/lib/format";
import { Plus, Eye, XCircle, FileDown } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { UnifiedDocumentFilters, EMPTY_DOCUMENT_FILTERS, type DocumentFilters } from "@/components/documents/UnifiedDocumentFilters";
import { useDocUsers, docUserOptions } from "@/lib/docUsers";
import { movementMatches } from "@/lib/docMeta";
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
  // unified filter (2026-11-18): applied on «بحث» / Enter (partyId = المورد, payState = حالة الدفع)
  const [af, setAf] = useState<DocumentFilters>(EMPTY_DOCUMENT_FILTERS);
  const fFrom = af.from, fTo = af.to;
  const recipientOptions = docUserOptions(useDocUsers(branchId));

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    // every purchase invoice of the branch (no 1,000-row cap); paid / remaining from the unified ledger
    let ships: any[] = [];
    try {
      ships = await fetchAllRows<any>(() => supabase
        .from("shipments")
        .select("*, contacts(name, phone)")
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false })
        .order("id"));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تحميل فواتير الشراء");
    }
    const st = await fetchDocumentStatus("shipment", ships.filter((s: any) => s.status !== "cancelled").map((s: any) => s.id)).catch(() => new Map());
    const enriched = ships.map((s: any) => {
      if (s.status === "cancelled") return { ...s, _paid_amount: 0, _payment_status: "cancelled" };
      const d = st.get(s.id);
      const total = Number(s.total_cost || 0);
      const paid = d ? d.paid : 0;
      const status = d?.state === "before_ledger" ? "before_ledger" : paid >= total - 0.01 ? "paid" : paid > 0.005 ? "partial" : "unpaid";
      return { ...s, _paid_amount: paid, _remaining: d ? d.remaining : total, _payment_status: status };
    });
    setRows(enriched);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["shipments", "supplier_payments", "vouchers", "payment_transactions", "purchase_returns"], load);
  const shipmentIds = useMemo(() => rows.map((r: any) => r.id), [rows]);
  const attCounts = useAttachmentCounts("shipment", shipmentIds);

  const [branchName, setBranchName] = useState("");
  useEffect(() => {
    if (!branchId) return;
    supabase.from("branches").select("name").eq("id", branchId).maybeSingle()
      .then(({ data }) => setBranchName(data?.name ?? ""));
  }, [branchId]);

  const filtered = useMemo(() => rows.filter((r: any) => {
    if (af.partyId && r.contact_id !== af.partyId) return false;
    if (af.payState && r._payment_status !== af.payState) return false;
    const day = String(r.invoice_date ?? r.arrival_date ?? "").slice(0, 10);
    if (fFrom && day && day < fFrom) return false;
    if (fTo && day && day > fTo) return false;
    return movementMatches({ reference: r.shipment_number, party: r.contacts?.name, phone: r.contacts?.phone, notes: r.notes, amount: Number(r.total_cost) || 0 },
      { items: "", method: "", recipient: r.received_by ?? "", total: Number(r.total_cost) || 0, notes: r.notes ?? "", party: r.contacts?.name ?? "", phone: r.contacts?.phone ?? "" },
      af, false);
  }), [rows, af, fFrom, fTo]);

  const [view, setView] = useState<any[] | null>(null); // what the column filters leave (Excel filters), for the exports
  const handleExportPdf = async () => {
    if (!branchId) return;
    const list = view ?? filtered;
    if (list.length === 0) { toast.error("لا توجد فواتير شراء لتصديرها"); return; }
    await generateShipmentsReport({
      branchId, branchName,
      shipments: list,
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
            <UnifiedDocumentFilters
              title="فواتير الشراء"
              noun="فاتورة"
              shown={{ from: filtered.length ? 1 : 0, to: filtered.length, total: filtered.length }}
              value={af}
              onChange={setAf}
              onReset={() => setAf(EMPTY_DOCUMENT_FILTERS)}
              hasAnyFilter={Object.values(af).some(Boolean)}
              showAmount
              showNotes
              payStateOptions={[{ value: "paid", label: "مدفوعة بالكامل" }, { value: "partial", label: "مدفوعة جزئياً" }, { value: "unpaid", label: "غير مدفوعة" }, { value: "cancelled", label: "ملغاة" }]}
              recipientOptions={recipientOptions}
              recipientLabel="المستلم"
              extraFields={(d, set) => (
                <UnifiedDocumentFilters.Field label="المورد">
                  <UnifiedDocumentFilters.Select value={d.partyId} options={suppliers.map(([id, name]) => ({ value: id as string, label: name as string }))} onChange={(v) => set({ partyId: v })} />
                </UnifiedDocumentFilters.Field>
              )}
            />

            <DataTable
              loading={loading}
              rows={filtered}
              onView={setView}
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
              if (status === "before_ledger") {
                return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground font-medium" title="قبل 1 يناير 2026 — رصيدها في الرصيد الافتتاحي">أرشيف (قبل 2026)</span>;
              }
              if (status === "paid") {
                return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-600 font-medium">مدفوعة بالكامل</span>;
              }
              if (status === "partial") {
                const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                return (
                  <div className="flex flex-col gap-0.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-600 font-medium w-fit">مدفوعة جزئياً ({pct}%)</span>
                    <span className="text-[10px] text-muted-foreground">متبقي {formatEGP(r._remaining ?? total - paid)}</span>
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
