import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatEGP } from "@/lib/format";
import { AlertCircle, Search, RefreshCw, Calendar } from "lucide-react";
import { Link } from "react-router-dom";

type Plan = {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  branch_id: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  plan_type: string;
  status: string;
  created_at: string;
};
type Installment = {
  id: string;
  payment_plan_id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: string;
};

export default function Receivables() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: pp }, { data: pi }, { data: br }] = await Promise.all([
      supabase.from("payment_plans").select("*").neq("status", "completed").order("created_at", { ascending: false }),
      supabase.from("payment_installments").select("*").in("status", ["pending", "overdue", "partial"]),
      supabase.from("branches").select("id,name"),
    ]);
    setPlans((pp as any) ?? []);
    setInstallments((pi as any) ?? []);
    const map: Record<string, string> = {};
    (br ?? []).forEach((b: any) => (map[b.id] = b.name));
    setBranches(map);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const runOverdueCheck = async () => {
    setRefreshing(true);
    try {
      await supabase.rpc("mark_overdue_installments" as any);
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    return plans.filter((p) => {
      if (branchFilter !== "all" && p.branch_id !== branchFilter) return false;
      if (q && !p.entity_name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [plans, q, branchFilter]);

  const byType = (t: string) => filtered.filter((p) => p.entity_type === t);

  const totals = useMemo(() => {
    const sumType = (t: string) =>
      filtered.filter((p) => p.entity_type === t)
        .reduce((s, p) => s + Number(p.remaining_amount || 0), 0);
    const overdueAmt = installments.filter((i) => i.status === "overdue")
      .reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount || 0)), 0);
    const due = sumType("customer");
    const oweSuppliers = sumType("supplier");
    const oweEmployees = sumType("employee");
    return {
      due,
      oweSuppliers,
      oweEmployees,
      owe: oweSuppliers + oweEmployees,
      overdue: overdueAmt,
      overdueCount: installments.filter((i) => i.status === "overdue").length,
    };
  }, [filtered, installments]);

  const insByPlan = useMemo(() => {
    const m: Record<string, Installment[]> = {};
    installments.forEach((i) => { (m[i.payment_plan_id] ||= []).push(i); });
    return m;
  }, [installments]);

  const renderTable = (rows: Plan[]) => (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="bg-surface-2">
          <tr>
            <th className="px-3 py-2 text-right">الجهة</th>
            <th className="px-3 py-2 text-right">الفرع</th>
            <th className="px-3 py-2 text-right">النوع</th>
            <th className="px-3 py-2 text-right">الإجمالي</th>
            <th className="px-3 py-2 text-right">مدفوع</th>
            <th className="px-3 py-2 text-right">متبقي</th>
            <th className="px-3 py-2 text-right">متأخر</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const ins = insByPlan[p.id] ?? [];
            const overdue = ins.filter((i) => i.status === "overdue");
            const next = ins.filter((i) => i.status !== "paid").sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
            const link =
              p.entity_type === "customer" ? `/branch/${p.branch_id}/customers/${p.entity_id}` :
              p.entity_type === "supplier" ? `/branch/${p.branch_id}/suppliers/${p.entity_id}` :
              `/admin/employees/${p.entity_id}`;
            return (
              <tr key={p.id} className="border-t hover:bg-surface-2/50">
                <td className="px-3 py-2 font-medium">{p.entity_name}</td>
                <td className="px-3 py-2 text-muted-foreground">{branches[p.branch_id] ?? "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{p.plan_type === "scheduled" ? "أقساط" : "مفتوحة"}</Badge>
                </td>
                <td className="px-3 py-2">{formatEGP(p.total_amount)}</td>
                <td className="px-3 py-2 text-success">{formatEGP(p.paid_amount)}</td>
                <td className="px-3 py-2 font-bold text-warning">{formatEGP(p.remaining_amount)}</td>
                <td className="px-3 py-2">
                  {overdue.length > 0 ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertCircle className="w-3 h-3" />{overdue.length}
                    </Badge>
                  ) : next ? (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />{next.due_date}
                    </span>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-left">
                  <Button asChild size="sm" variant="outline">
                    <Link to={link}>فتح</Link>
                  </Button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">لا توجد خطط نشطة</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-2xl font-bold">الذمم المالية</h1>
          <Button variant="outline" size="sm" onClick={runOverdueCheck} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ml-1 ${refreshing ? "animate-spin" : ""}`} />
            تحديث المتأخرات
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">مستحق للموردين</div>
            <div className="text-2xl font-bold text-warning mt-1">{formatEGP(totals.oweSuppliers)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">مستحق للموظفين</div>
            <div className="text-2xl font-bold text-warning mt-1">{formatEGP(totals.oweEmployees)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">مستحق لنا (عملاء)</div>
            <div className="text-2xl font-bold text-success mt-1">{formatEGP(totals.due)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">صافي المركز</div>
            <div className={`text-2xl font-bold mt-1 ${totals.due - totals.owe >= 0 ? "text-success" : "text-destructive"}`}>
              {formatEGP(totals.due - totals.owe)}
            </div>
          </Card>
          <Card className="p-4 border-destructive/40">
            <div className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="w-4 h-4" />متأخرات</div>
            <div className="text-2xl font-bold text-destructive mt-1">{formatEGP(totals.overdue)}</div>
            <div className="text-xs text-muted-foreground">{totals.overdueCount} قسط</div>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pr-9" placeholder="بحث بالاسم" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input-base px-3 py-2 border rounded-md bg-background" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="all">كل الفروع</option>
            {Object.entries(branches).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">جاري التحميل…</div>
        ) : (
          <Tabs defaultValue="customer">
            <TabsList>
              <TabsTrigger value="customer">العملاء ({byType("customer").length})</TabsTrigger>
              <TabsTrigger value="supplier">الموردين ({byType("supplier").length})</TabsTrigger>
              <TabsTrigger value="employee">الموظفين ({byType("employee").length})</TabsTrigger>
            </TabsList>
            <TabsContent value="customer">{renderTable(byType("customer"))}</TabsContent>
            <TabsContent value="supplier">{renderTable(byType("supplier"))}</TabsContent>
            <TabsContent value="employee">{renderTable(byType("employee"))}</TabsContent>
          </Tabs>
        )}
      </div>
    </AdminLayout>
  );
}
