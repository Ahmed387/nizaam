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
import { notify, notifyMany, getTenantAdmins } from "@/lib/notifications";
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

export default function AdvanceRequests({ embedded = false }: { embedded?: boolean } = {}) {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, isAdmin, hasRole, tenantId } = useAuth();
  const isBranchManager = hasRole("branch_manager");

  const [rows, setRows] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", amount: "", monthly_deduct: "", reason: "" });
  const [decisionRow, setDecisionRow] = useState<any>(null);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: r }, { data: e }, { data: t }] = await Promise.all([
      supabase.from("advance_requests").select("*, employees(name, job_title, user_id)").eq("branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("employees").select("id, name, job_title, base_salary, user_id").eq("branch_id", branchId).eq("is_active", true).order("name"),
      supabase.from("vouchers" as any).select("type, amount").eq("branch_id", branchId!).eq("status", "active"),
    ]);
    setRows(r ?? []);
    setEmployees(e ?? []);
    setBalance((t ?? []).reduce((s: number, x: any) => s + (x.type === "receipt" ? 1 : -1) * Number(x.amount), 0));
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
    if (isAdmin) return rows.filter((r) => r.status === "pending_admin" || r.status === "approved_pending_funds");
    if (isBranchManager) return rows.filter((r) => r.status === "approved_pending_funds");
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
        status: "pending_admin",
        branch_manager_id: user!.id,
        branch_manager_decision_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;

      // Notify tenant admins directly
      if (tenantId) {
        const admins = await getTenantAdmins(tenantId);
        const targets = admins.filter((id) => id !== user!.id);
        await notifyMany(targets, {
          title: "طلب سلفة بانتظار موافقتك",
          body: `${profile?.name} طلب سلفة بقيمة ${formatEGP(amt)} للموظف ${emp?.name}`,
          type: "advance_request",
          link: `/branch/${branchId}/advance-requests`,
          relatedEntity: "advance_request",
          relatedEntityId: req.id,
        });
      }

      await logAudit({
        userId: user!.id, userName: profile!.name, branchId,
        action: "CREATE", entity: "advance_request", entityId: req.id,
        details: { employee: emp?.name, amount: amt },
      });

      toast.success("تم إرسال الطلب للمدير العام");
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

  const notifyParties = async (row: any, payload: { title: string; body: string; type: "advance_approved" | "advance_pending_funds" | "advance_rejected" | "advance_request" }) => {
    const targets = new Set<string>();
    if (row.requested_by) targets.add(row.requested_by);
    if (row.branch_manager_id) targets.add(row.branch_manager_id);
    if (row.employees?.user_id) targets.add(row.employees.user_id);
    targets.delete(user!.id);
    if (targets.size === 0) return;
    await notifyMany(Array.from(targets), {
      ...payload,
      link: `/branch/${row.branch_id}/advance-requests`,
      relatedEntity: "advance_request",
      relatedEntityId: row.id,
    });
  };

  const submitDecision = async () => {
    if (!decisionRow) return;
    if (decision === "reject" && !decisionNote.trim()) return toast.error("سبب الرفض مطلوب");
    if (!isAdmin) return toast.error("الموافقة/الرفض للمدير العام فقط");
    setBusy(true);
    try {
      const row = decisionRow;
      const { data, error } = await supabase.rpc("approve_advance_request" as any, {
        p_request_id: row.id,
        p_decision: decision,
        p_note: decisionNote || null,
      });
      if (error) throw error;
      const newStatus = (data as any)?.status as Status;

      if (newStatus === "approved") {
        await notifyParties(row, {
          title: "✅ تمت الموافقة على طلب السلفة",
          body: `سلفة بقيمة ${formatEGP(row.amount)} للموظف ${row.employees?.name ?? ""} تمت الموافقة عليها وتم صرف المبلغ.`,
          type: "advance_approved",
        });
      } else if (newStatus === "approved_pending_funds") {
        await notifyParties(row, {
          title: "⏳ السلفة معتمدة — في انتظار توفر الرصيد",
          body: `وافق المدير العام على السلفة بقيمة ${formatEGP(row.amount)} للموظف ${row.employees?.name ?? ""}، لكن رصيد الخزنة غير كافٍ. سيتم الصرف فور توفر الرصيد.`,
          type: "advance_pending_funds",
        });
      } else if (newStatus === "rejected") {
        await notifyParties(row, {
          title: "❌ تم رفض طلب السلفة",
          body: `طلب سلفة بقيمة ${formatEGP(row.amount)} للموظف ${row.employees?.name ?? ""} تم رفضه. السبب: ${decisionNote}`,
          type: "advance_rejected",
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

  const disburse = async (row: any) => {
    if (!confirm(`صرف السلفة بقيمة ${formatEGP(row.amount)}؟ سيتم خصم المبلغ من الخزنة.`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("disburse_pending_advance", { p_request_id: row.id });
      if (error) throw error;
      await notifyParties(row, {
        title: "✅ تم صرف السلفة",
        body: `تم صرف السلفة بقيمة ${formatEGP(row.amount)} للموظف ${row.employees?.name ?? ""}.`,
        type: "advance_approved",
      });
      toast.success("تم صرف السلفة بنجاح");
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
            const canActOnStage = r.status === "pending_admin" && isAdmin;
            const canDisburse = r.status === "approved_pending_funds" && (isAdmin || isBranchManager);
            if (canDisburse) {
              const enough = balance >= Number(r.amount);
              return (
                <div className="flex flex-col gap-1">
                  <Button size="sm" disabled={!enough || busy}
                    className="h-7 btn-gradient" onClick={() => disburse(r)}>
                    <HandCoins className="w-3 h-3 ml-1" /> صرف السلفة
                  </Button>
                  {!enough && (
                    <span className="text-[10px] text-orange-400">
                      الرصيد غير كافٍ ({formatEGP(balance)})
                    </span>
                  )}
                </div>
              );
            }
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

  const canApprove = isAdmin || isBranchManager;
  const canCreate = isBranchManager || isAdmin;

  return (
    <BranchLayout>
      <PageHeader
        title="طلبات السلف"
        subtitle="مدير الفرع يرفع الطلب — المدير العام يوافق أو يرفض"
        actions={canCreate && (
          <Button onClick={() => setOpen(true)} className="gap-2 btn-gradient">
            <Plus className="w-4 h-4" /> طلب سلفة جديد
          </Button>
        )}
      />

      <div className="grid md:grid-cols-3 gap-3 mb-6">
        {!isAdmin && (
          <div className="card-elevated p-4">
            <div className="text-xs text-muted-foreground">طلباتي</div>
            <div className="text-2xl font-extrabold mt-1">{myRequests.length}</div>
          </div>
        )}
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

      <Tabs defaultValue={canApprove && pendingForMe.length > 0 ? "pending" : (isAdmin ? "all" : "mine")}>
        <TabsList>
          {!isAdmin && <TabsTrigger value="mine">طلباتي ({myRequests.length})</TabsTrigger>}
          {canApprove && (
            <TabsTrigger value="pending">
              بانتظار قراري ({pendingForMe.length})
            </TabsTrigger>
          )}
          {canApprove && <TabsTrigger value="all">كل الطلبات ({allRequests.length})</TabsTrigger>}
        </TabsList>

        {!isAdmin && (
          <TabsContent value="mine" className="mt-4">
            {renderTable(myRequests, true)}
          </TabsContent>
        )}
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
              💡 الطلب هيتبعت للمدير العام مباشرة للموافقة. عند الموافقة هيتم خصم المبلغ من الخزنة وتسجيل السلفة على الموظف تلقائياً.
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
              {decision === "approve" && (
                <div className="space-y-2">
                  <div className="bg-surface-2 rounded-lg p-3 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">رصيد خزنة الفرع:</span>
                      <b className={balance >= Number(decisionRow.amount) ? "text-success" : "text-orange-400"}>
                        {formatEGP(balance)}
                      </b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">السلفة المطلوبة:</span>
                      <b>{formatEGP(decisionRow.amount)}</b>
                    </div>
                  </div>
                  {balance >= Number(decisionRow.amount) ? (
                    <div className="text-xs text-success bg-success/10 rounded-lg p-2">
                      ✅ الرصيد كافٍ — هيتم صرف المبلغ من الخزنة فوراً وتسجيل السلفة على الموظف.
                    </div>
                  ) : (
                    <div className="text-xs text-orange-400 bg-orange-500/10 rounded-lg p-2">
                      ⚠️ رصيد الخزنة غير كافٍ. لو وافقت، السلفة هتتسجل بحالة <b>"معتمدة — في انتظار توفر الرصيد"</b> ومش هتتخصم من راتب الموظف لحد ما يتم صرفها فعلياً.
                    </div>
                  )}
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
