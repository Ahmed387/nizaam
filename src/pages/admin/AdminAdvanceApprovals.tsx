import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { notifyMany } from "@/lib/notifications";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Check, X, Clock, Wallet, HandCoins } from "lucide-react";

const STATUS_INFO: Record<string, { label: string; color: string }> = {
  pending_branch_manager: { label: "بانتظار مدير الفرع", color: "bg-warning/15 text-warning" },
  pending_admin: { label: "بانتظار المدير العام", color: "bg-blue-500/15 text-blue-400" },
  approved_pending_funds: { label: "معتمدة — في انتظار الرصيد", color: "bg-orange-500/15 text-orange-400" },
};

export default function AdminAdvanceApprovals({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, profile, isAdmin } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisionRow, setDecisionRow] = useState<any>(null);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("advance_requests")
      .select("*, employees(name, job_title, user_id), branches(name)")
      .in("status", ["pending_admin", "approved_pending_funds"] as any)
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-adv-approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "advance_requests" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const submitDecision = async () => {
    if (!decisionRow) return;
    if (!isAdmin) return toast.error("الموافقة/الرفض للمدير العام فقط");
    if (decision === "reject" && !note.trim()) return toast.error("سبب الرفض مطلوب");
    setBusy(true);
    try {
      const row = decisionRow;
      const { data, error } = await supabase.rpc("approve_advance_request" as any, {
        p_request_id: row.id,
        p_decision: decision,
        p_note: note || null,
      });
      if (error) throw error;
      const newStatus = (data as any)?.status as string;

      const targets = new Set<string>();
      if (row.requested_by) targets.add(row.requested_by);
      if (row.branch_manager_id) targets.add(row.branch_manager_id);
      if (row.employees?.user_id) targets.add(row.employees.user_id);
      targets.delete(user!.id);
      if (targets.size) {
        const map: Record<string, { title: string; body: string; type: any }> = {
          approved: { title: "✅ تمت الموافقة على طلب السلفة", body: `سلفة ${formatEGP(row.amount)} للموظف ${row.employees?.name ?? ""} تمت الموافقة عليها وصرفها.`, type: "advance_approved" },
          approved_pending_funds: { title: "⏳ السلفة معتمدة — في انتظار الرصيد", body: `سلفة ${formatEGP(row.amount)} معتمدة، وسيتم الصرف فور توفر الرصيد.`, type: "advance_pending_funds" },
          rejected: { title: "❌ تم رفض طلب السلفة", body: `سلفة ${formatEGP(row.amount)} تم رفضها. السبب: ${note}`, type: "advance_rejected" },
        };
        const payload = map[newStatus];
        if (payload) {
          await notifyMany(Array.from(targets), {
            ...payload,
            link: `/branch/${row.branch_id}/advance-requests`,
            relatedEntity: "advance_request",
            relatedEntityId: row.id,
          });
        }
      }

      await logAudit({
        userId: user!.id, userName: profile!.name, branchId: row.branch_id,
        action: "UPDATE", entity: "advance_request", entityId: row.id,
        details: { decision, new_status: newStatus, note },
      });

      toast.success(decision === "approve" ? "تمت الموافقة" : "تم الرفض");
      setDecisionRow(null);
      setNote("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <DataTable
        loading={loading}
        data={rows}
        emptyMessage="لا توجد طلبات سلف بانتظار الموافقة"
        columns={[
          { key: "created_at", label: "التاريخ", render: (r: any) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
          { key: "branch", label: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
          { key: "employee", label: "الموظف", render: (r: any) => (
            <div>
              <div className="font-bold">{r.employees?.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{r.employees?.job_title ?? ""}</div>
            </div>
          ) },
          { key: "amount", label: "المبلغ", render: (r: any) => <span className="font-bold">{formatEGP(r.amount)}</span> },
          { key: "monthly_deduct", label: "الخصم الشهري", render: (r: any) => formatEGP(r.monthly_deduct) },
          { key: "reason", label: "السبب", render: (r: any) => <span className="text-xs">{r.reason || "—"}</span> },
          { key: "status", label: "الحالة", render: (r: any) => {
            const s = STATUS_INFO[r.status] ?? { label: r.status, color: "bg-muted" };
            return <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${s.color}`}>{s.label}</span>;
          } },
          { key: "actions", label: "", render: (r: any) => (
            <div className="flex gap-1 justify-end">
              <Button size="sm" className="gap-1" onClick={() => { setDecisionRow(r); setDecision("approve"); setNote(""); }} disabled={!isAdmin}>
                <Check className="w-3.5 h-3.5" /> موافقة
              </Button>
              <Button size="sm" variant="destructive" className="gap-1" onClick={() => { setDecisionRow(r); setDecision("reject"); setNote(""); }} disabled={!isAdmin}>
                <X className="w-3.5 h-3.5" /> رفض
              </Button>
            </div>
          ) },
        ] as any}
      />

      <Dialog open={!!decisionRow} onOpenChange={(o) => !o && setDecisionRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {decision === "approve" ? <Wallet className="w-5 h-5 text-success" /> : <X className="w-5 h-5 text-destructive" />}
              {decision === "approve" ? "الموافقة على السلفة" : "رفض السلفة"}
            </DialogTitle>
          </DialogHeader>
          {decisionRow && (
            <div className="space-y-3">
              <div className="rounded-lg bg-surface-2 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">الموظف</span><b>{decisionRow.employees?.name}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">الفرع</span><b>{decisionRow.branches?.name ?? "—"}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">المبلغ</span><b>{formatEGP(decisionRow.amount)}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">الخصم الشهري</span><b>{formatEGP(decisionRow.monthly_deduct)}</b></div>
              </div>
              <div>
                <Label>{decision === "reject" ? "سبب الرفض (مطلوب)" : "ملاحظة (اختياري)"}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              </div>
              {decision === "approve" && (
                <div className="text-xs text-muted-foreground flex items-start gap-1">
                  <Clock className="w-3.5 h-3.5 mt-0.5" />
                  لو رصيد خزنة الفرع غير كافٍ، هتتسجل «معتمدة — في انتظار الرصيد» ويتم الصرف تلقائيًا لاحقًا.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionRow(null)}>إلغاء</Button>
            <Button variant={decision === "approve" ? "default" : "destructive"} onClick={submitDecision} disabled={busy}>
              {busy ? "جارٍ..." : decision === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return body;
  return (
    <AdminLayout>
      <PageHeader title="طلبات السلف" subtitle="طلبات سلف الموظفين بانتظار موافقة المدير العام — كل الفروع" icon={<HandCoins className="w-5 h-5" />} />
      {body}
    </AdminLayout>
  );
}
