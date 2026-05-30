import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus, LogIn, LogOut } from "lucide-react";

const STATUS = {
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
  leave: "إجازة",
};

export default function Attendance({ embedded = false }: { embedded?: boolean } = {}) {
  const { id: branchId } = useParams<{ id: string }>();
  const { tenant, user, roles, isAdmin } = useAuth();

  // Determine which target employee roles the current user can manage
  const canManageRole = (targetRole: string | null) => {
    if (isAdmin || roles.includes("super_admin") || roles.includes("supervisor")) return true;
    if (!targetRole) return false;
    if (["worker", "driver"].includes(targetRole)) {
      return roles.includes("accountant") || roles.includes("warehouse");
    }
    if (targetRole === "cashier") return roles.includes("branch_manager");
    return false;
  };
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [employees, setEmployees] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", status: "present", notes: "" });

  const [presence, setPresence] = useState<Record<string, { last_login_at: string | null; last_seen_at: string }>>({});

  const load = async () => {
    setLoading(true);
    const [{ data: emps }, { data: att }] = await Promise.all([
      supabase.from("employees").select("id,name,job_title,role,user_id,has_system_access").eq("branch_id", branchId).eq("is_active", true).order("name"),
      supabase.from("attendance").select("*").eq("branch_id", branchId).eq("date", date).order("created_at"),
    ]);
    setEmployees(emps ?? []);
    setRows(att ?? []);
    const uids = (emps ?? []).map((e: any) => e.user_id).filter(Boolean);
    if (uids.length) {
      const { data: pres } = await supabase
        .from("user_presence" as any)
        .select("user_id, last_login_at, last_seen_at")
        .in("user_id", uids);
      const m: Record<string, any> = {};
      (pres ?? []).forEach((p: any) => { m[p.user_id] = p; });
      setPresence(m);
    } else setPresence({});
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId, date]);

  const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—";
  const isToday = (iso?: string | null) => iso ? new Date(iso).toISOString().slice(0, 10) === date : false;

  const byEmployee = useMemo(() => {
    const m = new Map<string, any>();
    rows.forEach((r) => m.set(r.employee_id, r));
    return m;
  }, [rows]);

  const upsert = async (employeeId: string, patch: any) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    const existing = byEmployee.get(employeeId);
    if (existing) {
      const { error } = await supabase.from("attendance").update(patch).eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("attendance").insert({
        branch_id: branchId!,
        tenant_id: tenant?.id ?? null,
        employee_id: employeeId,
        employee_name: emp.name,
        date,
        created_by: user?.id ?? null,
        ...patch,
      });
      if (error) return toast.error(error.message);
    }
    load();
  };

  const checkIn = (employeeId: string) => upsert(employeeId, { check_in: new Date().toISOString(), status: "present" });
  const checkOut = (employeeId: string) => upsert(employeeId, { check_out: new Date().toISOString() });

  const submitManual = async () => {
    if (!form.employee_id) return toast.error("اختر الموظف");
    await upsert(form.employee_id, { status: form.status, notes: form.notes || null });
    toast.success("تم تسجيل الحالة");
    setOpen(false);
    setForm({ employee_id: "", status: "present", notes: "" });
  };

  const controls = (
    <div className="flex gap-2 items-center">
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
      <Button onClick={() => setOpen(true)} className="gap-1"><Plus className="w-4 h-4" /> تسجيل يدوي</Button>
    </div>
  );

  const body = (
    <>
      {embedded && <div className="flex justify-end mb-3">{controls}</div>}


      <DataTable
        loading={loading}
        rows={employees}
        empty="لا يوجد موظفين"
        columns={[
          { key: "name", header: "الموظف", render: (e: any) => <span className="font-semibold">{e.name}</span> },
          { key: "job_title", header: "الوظيفة" },
          {
            key: "status", header: "الحالة",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              const status = a?.status ?? "absent";
              const color = status === "present" ? "text-success" : status === "late" ? "text-warning" : status === "leave" ? "text-info" : "text-muted-foreground";
              return <span className={color}>{STATUS[status as keyof typeof STATUS] ?? status}</span>;
            },
          },
          {
            key: "check_in", header: "وقت الحضور",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              return a?.check_in ? <span dir="ltr" className="text-xs">{new Date(a.check_in).toLocaleTimeString("ar-EG")}</span> : "—";
            },
          },
          {
            key: "check_out", header: "وقت الانصراف",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              return a?.check_out ? <span dir="ltr" className="text-xs">{new Date(a.check_out).toLocaleTimeString("ar-EG")}</span> : "—";
            },
          },
          {
            key: "actions", header: "",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              const allowed = canManageRole(e.role);
              if (!allowed) return <span className="text-xs text-muted-foreground">—</span>;
              return (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => checkIn(e.id)} disabled={!!a?.check_in}>
                    <LogIn className="w-3.5 h-3.5 ml-1" /> حضور
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => checkOut(e.id)} disabled={!a?.check_in || !!a?.check_out}>
                    <LogOut className="w-3.5 h-3.5 ml-1" /> انصراف
                  </Button>
                </div>
              );
            },
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>تسجيل حالة يدوي</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الموظف</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submitManual}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return body;
  return (
    <BranchLayout>
      <PageHeader title="الحضور والانصراف" subtitle={formatDate(date)} actions={controls} />
      {body}
    </BranchLayout>
  );
}
