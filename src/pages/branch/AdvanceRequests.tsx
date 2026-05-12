import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { notify, notifyMany, getBranchManagers, getTenantAdmins } from "@/lib/notifications";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Check, X, Clock, AlertCircle, Wallet, HandCoins } from "lucide-react";

type Status = "pending_branch_manager" | "pending_admin" | "approved" | "approved_pending_funds" | "rejected";

const STATUS_INFO: Record<Status, { label: string; color: string; icon: any }> = {
  pending_branch_manager: { label: "بانتظار مدير الفرع", color: "bg-warning/15 text-warning", icon: Clock },
  pending_admin: { label: "بانتظار المدير العام", color: "bg-blue-500/15 text-blue-400", icon: Clock },
  approved: { label: "معتمدة وتم الصرف ✓", color: "bg-success/15 text-success", icon: Check },
  approved_pending_funds: { label: "معتمدة — في انتظار توفر الرصيد", color: "bg-orange-500/15 text-orange-400", icon: Wallet },
  rejected: { label: "مرفوضة", color: "bg-destructive/15 text-destructive", icon: X },
};

export default function AdvanceRequests() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, isAdmin, hasRole, tenantId } = useAuth();
  const isBranchManager = hasRole("branch_manager");

  const [rows, setRows] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", amount: "", monthly_deduct: "", reason: "" });
  const [decisionRow, setDecisionRow] = useState<any>(null);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: r }, { data: e }] = await Promise.all([
      supabase.from("advance_requests").select("*, employees(name, job_title)").eq("branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("employees").select("id, name, job_title, base_salary").eq("branch_id", branchId).eq("is_active", true).order("name"),
    ]);
    setRows(r ?? []);
    setEmployees(e ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`adv-req-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "advance_requests", filter: `branch_id=eq.${branchId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [branchId]);

  const myRequests = useMemo(() => rows.filter((r) => r.requested_by === user?.id), [rows, user?.id]);
  const pendingForMe = useMemo(() => {
    if (isAdmin) return rows.filter((r) => r.status === "pending_admin");
    if (isBranchManager) return rows.filter((r) => r.status === "pending_branch_manager");
    return [];
  }, [rows, isAdmin, isBranchManager]);
  const allRequests = rows;

  const submit = async () => {
    if (!form.employee_id) return toast.error("اختر الموظف");
    const amt = Number(form.amount);
    const md = Number(form.monthly_deduct);
    if (!amt || amt <= 0) return toast.error("أدخل المبلغ");
    if (!md || md <= 0) return toast.error("أدخل الخصم الشهري");

    setBusy(true);
    try {
      const emp = employees.find((e) => e.id === form.employee_id);
      const { data: req, error } = await supabase.from("advance_requests").insert({
        employee_id: form.employee_id,
        branch_id: branchId!,
        requested_by: user!.id,
        amount: amt,
        monthly_deduct: md,
        reason: form.reason || null,
      }).select().single();
      if (error) throw error;

      // Notify branch managers
      const managerIds = await getBranchManagers(branchId!);
      const targets = managerIds.filter((id) => id !== user!.id);
      await notifyMany(targets, {
        title: "طلب سلفة جديد",
        body: `${profile?.name} طلب سلفة بقيمة ${formatEGP(amt)} للموظف ${emp?.name}`,
        type: "advance_request",
        link: `/branch/${branchId}/advance-requests`,
        relatedEntity: "advance_request",
        relatedEntityId: req.id,
      });

      await logAudit({
        userId: user!.id, userName: profile!.name, branchId,
        action: "CREATE", entity: "advance_request", entityId: req.id,
        details: { employee: emp?.name, amount: amt },
      });

      toast.success("تم إرسال الطلب لمدير الفرع");
      setOpen(false);
      setForm({ employee_id: "", amount: "", monthly_deduct: "", reason: "" });
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openDecision = (row: any, type: "approve" | "reject") => {
    setDecisionRow(row);
    setDecision(type);
    setDecisionNote("");
  };

  const submitDecision = async () => {
    if (!decisionRow) return;
    if (decision === "reject" && !decisionNote.trim()) return toast.error("سبب الرفض مطلوب");
    setBusy(true);
    try {
      const row = decisionRow;
      const isBmStage = row.status === "pending_branch_manager";
      const isAdminStage = row.status === "pending_admin";

      // Validate role for stage
      if (isBmStage && !isBranchManager && !isAdmin) {
        throw new Error("غير مصرح: هذه المرحلة لمدير الفرع");
      }
      if (isAdminStage && !isAdmin) {
        throw new Error("غير مصرح: هذه المرحلة للمدير العام");
      }

      let newStatus: Status;
      const update: any = {};
      if (decision === "reject") {
        newStatus = "rejected";
        update.rejection_reason = decisionNote;
        if (isBmStage) {
          update.branch_manager_id = user!.id;
          update.branch_manager_decision_at = new Date().toISOString();
          update.branch_manager_note = decisionNote;
        } else {
          update.admin_id = user!.id;
          update.admin_decision_at = new Date().toISOString();
          update.admin_note = decisionNote;
        }
      } else {
        if (isBmStage) {
          newStatus = "pending_admin";
          update.branch_manager_id = user!.id;
          update.branch_manager_decision_at = new Date().toISOString();
          update.branch_manager_note = decisionNote || null;
        } else {
          newStatus = "approved";
          update.admin_id = user!.id;
          update.admin_decision_at = new Date().toISOString();
          update.admin_note = decisionNote || null;
        }
      }
      update.status = newStatus;

      const { error: upErr } = await supabase.from("advance_requests").update(update).eq("id", row.id);
      if (upErr) throw upErr;

      // Side effects
      if (newStatus === "approved") {
        // Create the actual advance + treasury expense
        const { data: adv, error: advErr } = await supabase.from("advances").insert({
          employee_id: row.employee_id,
          amount: row.amount,
          monthly_deduct: row.monthly_deduct,
          remaining: row.amount,
          reason: row.reason ?? null,
        }).select().single();
        if (advErr) throw advErr;

        await supabase.from("treasury").insert({
          branch_id: row.branch_id, type: "expense", category: "advance",
          amount: row.amount, description: `سلفة معتمدة - ${row.employees?.name ?? ""}`,
          reference_id: adv.id, created_by: user!.id,
        });

        await supabase.from("advance_requests").update({ resulting_advance_id: adv.id }).eq("id", row.id);

        // Notify requester
        await notify({
          userId: row.requested_by,
          title: "✅ تمت الموافقة على طلب السلفة",
          body: `طلبك بقيمة ${formatEGP(row.amount)} للموظف ${row.employees?.name ?? ""} تمت الموافقة عليه نهائياً وتم صرف المبلغ.`,
          type: "advance_approved",
          link: `/branch/${branchId}/advance-requests`,
          relatedEntity: "advance_request",
          relatedEntityId: row.id,
        });
      } else if (newStatus === "rejected") {
        await notify({
          userId: row.requested_by,
          title: "❌ تم رفض طلب السلفة",
          body: `سبب الرفض: ${decisionNote}`,
          type: "advance_rejected",
          link: `/branch/${branchId}/advance-requests`,
          relatedEntity: "advance_request",
          relatedEntityId: row.id,
        });
      } else if (newStatus === "pending_admin") {
        // Notify tenant admins
        if (tenantId) {
          const admins = await getTenantAdmins(tenantId);
          const targets = admins.filter((id) => id !== user!.id);
          await notifyMany(targets, {
            title: "طلب سلفة بانتظار موافقتك",
            body: `وافق مدير الفرع على طلب سلفة بقيمة ${formatEGP(row.amount)} للموظف ${row.employees?.name ?? ""}`,
            type: "advance_request",
            link: `/branch/${branchId}/advance-requests`,
            relatedEntity: "advance_request",
            relatedEntityId: row.id,
          });
        }
        // Notify requester progress
        await notify({
          userId: row.requested_by,
          title: "تقدم طلب السلفة",
          body: "وافق مدير الفرع على طلبك. الطلب الآن بانتظار المدير العام.",
          type: "advance_request",
          link: `/branch/${branchId}/advance-requests`,
          relatedEntity: "advance_request",
          relatedEntityId: row.id,
        });
      }

      await logAudit({
        userId: user!.id, userName: profile!.name, branchId,
        action: "UPDATE", entity: "advance_request", entityId: row.id,
        details: { decision, new_status: newStatus, note: decisionNote },
      });

      toast.success(decision === "approve" ? "تمت الموافقة" : "تم الرفض");
      setDecisionRow(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const StatusBadge = ({ status }: { status: Status }) => {
    const info = STATUS_INFO[status];
    const Icon = info.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold ${info.color}`}>
        <Icon className="w-3 h-3" /> {info.label}
      </span>
    );
  };

  const renderTable = (data: any[], showActions: boolean) => (
    <DataTable
      loading={loading}
      rows={data}
      empty="لا توجد طلبات"
      columns={[
        { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        { key: "employee", header: "الموظف", render: (r: any) => (
          <div>
            <div className="font-semibold">{r.employees?.name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{r.employees?.job_title ?? ""}</div>
          </div>
        ) },
        { key: "amount", header: "المبلغ", render: (r: any) => <b>{formatEGP(r.amount)}</b> },
        { key: "monthly_deduct", header: "خصم شهري", render: (r: any) => formatEGP(r.monthly_deduct) },
        { key: "reason", header: "السبب", render: (r: any) => r.reason ?? "—" },
        { key: "status", header: "الحالة", render: (r: any) => <StatusBadge status={r.status} /> },
        ...(showActions ? [{
          key: "actions", header: "إجراء", render: (r: any) => {
            const canActOnStage =
              (r.status === "pending_branch_manager" && (isBranchManager || isAdmin)) ||
              (r.status === "pending_admin" && isAdmin);
            if (!canActOnStage) return <span className="text-xs text-muted-foreground">—</span>;
            return (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 text-success border-success/30 hover:bg-success/10" onClick={() => openDecision(r, "approve")}>
                  <Check className="w-3 h-3 ml-1" /> موافقة
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => openDecision(r, "reject")}>
                  <X className="w-3 h-3 ml-1" /> رفض
                </Button>
              </div>
            );
          }
        }] : []),
      ]}
    />
  );

  const canApprove = isBranchManager || isAdmin;

  return (
    <BranchLayout>
      <PageHeader
        title="طلبات السلف"
        subtitle="نظام موافقات: مدير الفرع → المدير العام"
        actions={
          <Button onClick={() => setOpen(true)} className="gap-2 btn-gradient">
            <Plus className="w-4 h-4" /> طلب سلفة جديد
          </Button>
        }
      />

      <div className="grid md:grid-cols-3 gap-3 mb-6">
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">طلباتي</div>
          <div className="text-2xl font-extrabold mt-1">{myRequests.length}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">بانتظار قراري</div>
          <div className="text-2xl font-extrabold mt-1 text-warning flex items-center gap-2">
            {pendingForMe.length}
            {pendingForMe.length > 0 && <AlertCircle className="w-5 h-5" />}
          </div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">إجمالي الطلبات</div>
          <div className="text-2xl font-extrabold mt-1">{allRequests.length}</div>
        </div>
      </div>

      <Tabs defaultValue={canApprove && pendingForMe.length > 0 ? "pending" : "mine"}>
        <TabsList>
          <TabsTrigger value="mine">طلباتي ({myRequests.length})</TabsTrigger>
          {canApprove && (
            <TabsTrigger value="pending">
              بانتظار قراري ({pendingForMe.length})
            </TabsTrigger>
          )}
          {canApprove && <TabsTrigger value="all">كل الطلبات ({allRequests.length})</TabsTrigger>}
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {renderTable(myRequests, false)}
        </TabsContent>
        {canApprove && (
          <TabsContent value="pending" className="mt-4">
            {renderTable(pendingForMe, true)}
          </TabsContent>
        )}
        {canApprove && (
          <TabsContent value="all" className="mt-4">
            {renderTable(allRequests, true)}
          </TabsContent>
        )}
      </Tabs>

      {/* New request dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>طلب سلفة جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الموظف *</Label>
              <select className="w-full bg-input border border-border rounded-lg p-2 mt-1.5"
                value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">— اختر —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.job_title})</option>)}
              </select>
            </div>
            <div><Label>المبلغ *</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" /></div>
            <div><Label>الخصم الشهري *</Label><Input type="number" value={form.monthly_deduct} onChange={(e) => setForm({ ...form, monthly_deduct: e.target.value })} className="mt-1.5" /></div>
            <div><Label>السبب</Label><Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="mt-1.5" /></div>
            <div className="text-xs text-muted-foreground bg-surface-2 rounded-lg p-3">
              💡 الطلب هيتبعت لمدير الفرع للموافقة الأولى، وبعدين للمدير العام للموافقة النهائية. مفيش صرف للفلوس قبل الموافقتين.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" disabled={busy} onClick={submit}>إرسال الطلب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decision dialog */}
      <Dialog open={!!decisionRow} onOpenChange={(o) => !o && setDecisionRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approve" ? "✅ تأكيد الموافقة" : "❌ تأكيد الرفض"}
            </DialogTitle>
          </DialogHeader>
          {decisionRow && (
            <div className="space-y-3">
              <div className="bg-surface-2 rounded-lg p-3 space-y-1 text-sm">
                <div><span className="text-muted-foreground">الموظف:</span> <b>{decisionRow.employees?.name}</b></div>
                <div><span className="text-muted-foreground">المبلغ:</span> <b>{formatEGP(decisionRow.amount)}</b></div>
                <div><span className="text-muted-foreground">الخصم الشهري:</span> {formatEGP(decisionRow.monthly_deduct)}</div>
                {decisionRow.reason && <div><span className="text-muted-foreground">السبب:</span> {decisionRow.reason}</div>}
              </div>
              {decisionRow.status === "pending_branch_manager" && decision === "approve" && (
                <div className="text-xs text-blue-400 bg-blue-500/10 rounded-lg p-2">
                  ℹ️ بعد موافقتك، الطلب هيتنقل للمدير العام للموافقة النهائية.
                </div>
              )}
              {decisionRow.status === "pending_admin" && decision === "approve" && (
                <div className="text-xs text-success bg-success/10 rounded-lg p-2">
                  ⚠️ ده هيصرف المبلغ من الخزنة فوراً ويسجل سلفة على الموظف.
                </div>
              )}
              <div>
                <Label>{decision === "reject" ? "سبب الرفض *" : "ملاحظة (اختياري)"}</Label>
                <Textarea rows={3} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} className="mt-1.5" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionRow(null)}>إلغاء</Button>
            <Button
              className={decision === "approve" ? "btn-gradient" : ""}
              variant={decision === "reject" ? "destructive" : "default"}
              disabled={busy}
              onClick={submitDecision}
            >
              {decision === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
