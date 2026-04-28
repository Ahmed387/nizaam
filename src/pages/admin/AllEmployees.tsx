import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus, FileSpreadsheet, ArrowRight, Users, UserCheck, UserX, Wallet } from "lucide-react";

export default function AllEmployees() {
  const nav = useNavigate();
  const { tenantId } = useAuth();
  const [emps, setEmps] = useState<any[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [advRemaining, setAdvRemaining] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", job_title: "", phone: "", base_salary: "",
    hire_date: new Date().toISOString().slice(0, 10), branch_id: "",
  });

  const load = async () => {
    setLoading(true);
    const [{ data: e }, { data: b }, { data: a }] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("advances").select("employee_id, remaining"),
    ]);
    setEmps(e ?? []);
    setBranches(b ?? []);
    const map: Record<string, number> = {};
    for (const x of (a ?? []) as any[]) {
      map[x.employee_id] = (map[x.employee_id] ?? 0) + Number(x.remaining);
    }
    setAdvRemaining(map);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const enriched = useMemo(() => emps.map((e) => ({
    ...e,
    branch_name: branches.find((b) => b.id === e.branch_id)?.name ?? "—",
    advance_remaining: advRemaining[e.id] ?? 0,
  })), [emps, branches, advRemaining]);

  const filtered = useMemo(() => enriched.filter((e) => {
    if (search && !e.name.includes(search) && !(e.job_title ?? "").includes(search) && !(e.phone ?? "").includes(search)) return false;
    if (branchFilter !== "all" && e.branch_id !== branchFilter) return false;
    if (statusFilter === "active" && !e.is_active) return false;
    if (statusFilter === "inactive" && e.is_active) return false;
    return true;
  }), [enriched, search, branchFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: enriched.length,
    active: enriched.filter((e) => e.is_active).length,
    inactive: enriched.filter((e) => !e.is_active).length,
    salaryTotal: enriched.filter((e) => e.is_active).reduce((s, e) => s + Number(e.base_salary), 0),
  }), [enriched]);

  const submit = async () => {
    if (!form.name || !form.job_title || !form.branch_id) return toast.error("املأ الاسم والوظيفة والفرع");
    const { error } = await supabase.from("employees").insert({
      tenant_id: tenantId,
      branch_id: form.branch_id,
      name: form.name,
      job_title: form.job_title,
      phone: form.phone || null,
      base_salary: Number(form.base_salary) || 0,
      hire_date: form.hire_date,
    });
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setOpen(false);
    setForm({ name: "", job_title: "", phone: "", base_salary: "", hire_date: new Date().toISOString().slice(0, 10), branch_id: "" });
    load();
  };

  const exportExcel = () => {
    const data = filtered.map((e) => ({
      "الاسم": e.name,
      "الوظيفة": e.job_title,
      "الفرع": e.branch_name,
      "التليفون": e.phone ?? "—",
      "الراتب": Number(e.base_salary),
      "سلف متبقية": e.advance_remaining,
      "تاريخ التعيين": e.hire_date,
      "الحالة": e.is_active ? "نشط" : "موقوف",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الموظفين");
    XLSX.writeFile(wb, `employees-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`تم تصدير ${data.length} موظف`);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="الموظفين (كل الفروع)"
        subtitle="عرض موحّد لكل الموظفين عبر فروع الشركة"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
            <Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> موظف جديد</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> إجمالي الموظفين</div>
          <div className="text-2xl font-bold mt-1">{stats.total}</div>
        </div>
        <div className="p-4 rounded-lg border bg-success/5 border-success/30">
          <div className="text-xs text-success flex items-center gap-1"><UserCheck className="w-3 h-3" /> النشطين</div>
          <div className="text-2xl font-bold mt-1 text-success">{stats.active}</div>
        </div>
        <div className="p-4 rounded-lg border bg-muted">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><UserX className="w-3 h-3" /> موقوفين</div>
          <div className="text-2xl font-bold mt-1">{stats.inactive}</div>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="w-3 h-3" /> إجمالي الرواتب الشهرية</div>
          <div className="text-2xl font-bold mt-1 text-primary">{formatEGP(stats.salaryTotal)}</div>
        </div>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <Input placeholder="ابحث بالاسم أو الوظيفة أو التليفون" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="inactive">موقوف</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        empty="لا يوجد موظفين"
        onRowClick={(r: any) => nav(`/admin/employees/${r.id}`)}
        columns={[
          { key: "name", header: "الاسم", render: (r: any) => (
            <div>
              <div className="font-semibold">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.job_title}</div>
            </div>
          )},
          { key: "branch_name", header: "الفرع", render: (r: any) => (
            <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">{r.branch_name}</span>
          )},
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "base_salary", header: "الراتب", render: (r: any) => <b>{formatEGP(r.base_salary)}</b> },
          { key: "advance_remaining", header: "سلف متبقية", render: (r: any) => (
            r.advance_remaining > 0
              ? <span className="text-warning font-bold">{formatEGP(r.advance_remaining)}</span>
              : <span className="text-muted-foreground">—</span>
          )},
          { key: "hire_date", header: "التعيين", render: (r: any) => formatDate(r.hire_date) },
          { key: "is_active", header: "الحالة", render: (r: any) => (
            <span className={`px-2 py-0.5 rounded text-xs ${r.is_active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {r.is_active ? "نشط" : "موقوف"}
            </span>
          )},
          { key: "go", header: "", render: () => <ArrowRight className="w-4 h-4 text-muted-foreground" /> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>موظف جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الفرع *</Label>
              <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="— اختر —" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>الوظيفة *</Label><Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>الراتب الأساسي</Label><Input type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className="mt-1.5" /></div>
            <div><Label>تاريخ التعيين</Label><Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
