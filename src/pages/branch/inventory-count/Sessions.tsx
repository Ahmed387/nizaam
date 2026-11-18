import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { InventoryStatusBadge, INV_STATUS_LABELS } from "@/components/InventoryStatusBadge";
import { UnifiedDocumentFilters, EMPTY_DOCUMENT_FILTERS, type DocumentFilters } from "@/components/documents/UnifiedDocumentFilters";
import { anyAmountIn, dayIn, hasAny, searchHas } from "@/lib/listFilter";
import { useUserOptions } from "@/lib/docUsers";
import { formatDateTime } from "@/lib/format";
import { Plus, FileText, ClipboardList, ClipboardCheck, ShieldCheck, Camera, Ban } from "lucide-react";
import { toast } from "sonner";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { confirmAlert } from "@/components/ConfirmDialog";
import { useMemo } from "react";

export default function Sessions({ embedded }: { embedded?: boolean } = {}) {
  const { id: branchId } = useParams<{ id: string }>();
  const { hasRole, isAdmin, isOwner } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isManager = isAdmin || hasRole("branch_manager");
  const isWarehouse = hasRole("warehouse");
  const isAccountant = hasRole("accountant");

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    const { data } = await supabase
      .from("inventory_sessions" as any)
      .select("*, branches(name), inventory_session_items(product_name, product_code, unit_cost)")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });
    setRows((data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);
  useRealtimeRefresh(["inventory_sessions"], load);
  // unified filter (owner 2026-11-18): صنف جوه الجلسة، الفترة، الحالة، اللي عملها، الملاحظات، والمبلغ = تكلفة الصنف وقت الجرد (0259)
  const [af, setAf] = useState<DocumentFilters>(EMPTY_DOCUMENT_FILTERS);
  const userOpts = useUserOptions(rows.map((r: any) => r.created_by));
  const shown = useMemo(() => rows.filter((r: any) => {
    const items = r.inventory_session_items ?? [];
    return searchHas(items.flatMap((i: any) => [i.product_name, i.product_code]), af.q) && dayIn(r.created_at, af.from, af.to)
      && (!af.status || r.status === af.status) && (!af.recipient || r.created_by === af.recipient) && searchHas([r.notes], af.notes)
      && anyAmountIn(items.map((i: any) => i.unit_cost), af.amountMin, af.amountMax);
  }), [rows, af]);
  const attCounts = useAttachmentCounts("inventory_adjustment", useMemo(() => rows.map((r: any) => r.id), [rows]));

  const canCancel = (status: string) => ["counting", "reviewing", "pending_approval"].includes(status);
  const canCancelApproved = (r: any) => isOwner && r.status === "closed";

  const cancelSession = async (sessionId: string) => {
    const { error } = await supabase
      .from("inventory_sessions" as any)
      .update({ status: "cancelled" })
      .eq("id", sessionId);
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء الجلسة");
    load();
  };

  const cancelApproved = async (sessionId: string) => {
    const ok = await confirmAlert({
      title: "إلغاء جرد معتمد؟",
      description: "هيتم إرجاع الكميات والدفعات لحالتها قبل الاعتماد وعكس القيد المحاسبي. لو حصلت أي حركة بيع أو شراء على نفس المنتجات بعد الاعتماد، العملية هتترفض.",
      confirmLabel: "أيوه ألغي الجرد",
      tone: "danger",
    });
    if (!ok) return;
    const { data, error } = await supabase.rpc("cancel_inventory_session" as any, {
      p_session_id: sessionId,
      p_reason: "إلغاء بواسطة المالك",
    });
    if (error) return toast.error(error.message, { duration: 12000 });
    const res = data as any;
    toast.success(`تم إلغاء الجرد — رجعنا ${Number(res?.reverted_qty ?? 0)} وحدة وعكسنا قيد بقيمة ${Number(res?.reverted_value ?? 0).toLocaleString("en-EG")} ج.م`);
    load();
  };


  const actionFor = (r: any) => {
    if (isManager && (r.status === "pending_approval")) {
      return <Button size="sm" onClick={() => navigate(`/branch/${branchId}/inventory-count/${r.id}/approve`)}>اعتماد</Button>;
    }
    if (isAccountant && (r.status === "reviewing")) {
      return <Button size="sm" onClick={() => navigate(`/branch/${branchId}/inventory-count/${r.id}/review`)}>مراجعة</Button>;
    }
    if (isWarehouse && r.status === "counting") {
      return <Button size="sm" onClick={() => navigate(`/branch/${branchId}/inventory-count/${r.id}/count`)}>إدخال العد</Button>;
    }
    return null;
  };

  return (
    <ConditionalLayout
      embedded={embedded}
      title="جرد الفرع"
      subtitle="إدارة جلسات الجرد ومراجعة الفروقات"
      actions={
        isManager ? (
          <Button onClick={() => navigate(`/branch/${branchId}/inventory-count/new`)} className="gap-2">
            <Plus className="w-4 h-4" /> بدء جرد جديد
          </Button>
        ) : null
      }
    >
      <UnifiedDocumentFilters
        title="جلسات الجرد" noun="جلسة" shown={{ from: shown.length ? 1 : 0, to: shown.length, total: shown.length }}
        value={af} onChange={setAf} onReset={() => setAf(EMPTY_DOCUMENT_FILTERS)} hasAnyFilter={hasAny(af)}
        searchLabel="بحث (اسم أو كود صنف جوه الجلسة)" searchPlaceholder="اسم الصنف أو كوده..."
        showAmount showNotes recipientOptions={userOpts} recipientLabel="اللي عمل الجلسة"
        statusOptions={Object.entries(INV_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      <DataTable
        rows={shown}
        loading={loading}
        empty={hasAny(af) ? "مفيش جلسات بالفلتر ده" : "لا توجد جلسات جرد"}
        columns={[
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
          { key: "warehouse", header: "المخزن", render: (r: any) => r.branches?.name ?? "—" },
          { key: "status", header: "الحالة", render: (r: any) => <InventoryStatusBadge status={r.status} /> },
          { key: "notes", header: "ملاحظات", render: (r: any) => r.notes ?? "—" },
          {
            key: "actions",
            header: "إجراءات",
            render: (r: any) => (
              <div className="flex gap-2 justify-end flex-wrap items-center">
                {actionFor(r)}
                <AttachmentsDialogButton recordType="inventory_adjustment" recordId={r.id} count={attCounts[r.id] ?? 0} canEdit={isManager || isWarehouse || isAccountant} />
                {isManager && canCancel(r.status) && (
                  <Button size="sm" variant="outline" onClick={() => cancelSession(r.id)} className="gap-1 text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700">
                    <Ban className="w-4 h-4" /> إلغاء
                  </Button>
                )}
                {canCancelApproved(r) && (
                  <Button size="sm" variant="outline" onClick={() => cancelApproved(r.id)} className="gap-1 text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700">
                    <Ban className="w-4 h-4" /> إلغاء الجرد المعتمد
                  </Button>
                )}
                {isAdmin && (
                  <Link to={`/branch/${branchId}/inventory-count/${r.id}/snapshot`}>
                    <Button size="sm" variant="outline" className="gap-1">
                      <Camera className="w-4 h-4" /> Snapshot
                    </Button>
                  </Link>
                )}
                <Link to={`/branch/${branchId}/inventory-count/${r.id}/report`}>
                  <Button size="sm" variant="outline" className="gap-1">
                    <FileText className="w-4 h-4" /> التقرير
                  </Button>
                </Link>
              </div>
            ),
          },
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6 text-sm text-muted-foreground">
        <div className="card-elevated p-4 flex gap-3 items-start"><ClipboardList className="w-5 h-5 text-blue-500" /><div><div className="font-semibold text-foreground">المدير</div>ينشئ الجلسة ويعتمدها في النهاية.</div></div>
        <div className="card-elevated p-4 flex gap-3 items-start"><ClipboardCheck className="w-5 h-5 text-amber-500" /><div><div className="font-semibold text-foreground">أمين المخزن</div>يدخل الكميات الفعلية بدون رؤية كميات النظام.</div></div>
        <div className="card-elevated p-4 flex gap-3 items-start"><ShieldCheck className="w-5 h-5 text-emerald-500" /><div><div className="font-semibold text-foreground">المحاسب</div>يراجع الفروقات ويضيف الأسباب ثم يرسلها للاعتماد.</div></div>
      </div>
    </ConditionalLayout>
  );
}
