import { useEffect, useMemo, useState } from "react";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatEGP } from "@/lib/format";
import { AlertCircle, Search, RefreshCw, Calendar, Info, ArrowDownLeft, ArrowUpRight, Users, Scale } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Link, useNavigate } from "react-router-dom";
import { useBranchScope } from "@/lib/branchScope";

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

export default function Receivables({ embedded }: { embedded?: boolean } = {}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const { isAllowed, filterBranches } = useBranchScope();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      await supabase.rpc("mark_overdue_installments" as any);
    } catch {}
    const [{ data: pp }, { data: pi }, { data: br }] = await Promise.all([
      supabase.from("payment_plans").select("*").neq("status", "completed").order("created_at", { ascending: false }),
      supabase.from("payment_installments").select("*").in("status", ["pending", "overdue", "partial"]),
      supabase.from("branches").select("id,name").neq("code", "PARTNER-CASH"),
    ]);
    setPlans((((pp as any) ?? []) as any[]).filter((r: any) => isAllowed(r.branch_id)) as any);
    setInstallments((pi as any) ?? []);
    const map: Record<string, string> = {};
    filterBranches((br ?? []) as any).forEach((b: any) => (map[b.id] = b.name));
    setBranches(map);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["payment_plans", "payment_installments", "invoice_payments", "invoices"], load);

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
      <table className="w-full text-sm">
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
              <tr
                key={p.id}
                className="border-t hover:bg-surface-2/50 cursor-pointer"
                onClick={() => navigate(link)}
              >
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
                  <Button asChild size="sm" variant="outline" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </Card>
  );


  const tabCfg = {
    customer: { label: "عملاء عليهم فلوس لينا", color: "text-success", hint: "دول ناس اشتروا منك ولسه مدفعوش كل الفلوس — دي فلوسك اللي برّه." },
    supplier: { label: "موردين إحنا مدينين لهم", color: "text-warning", hint: "دول شركات جبت منهم بضاعة ولسه ما دفعتش تمنها كله." },
    employee: { label: "موظفين ليهم مستحقات", color: "text-warning", hint: "سلف أو مرتبات أو مستحقات لسه ما اتصرفتش للموظفين." },
  } as const;

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <div className="space-y-5" dir="rtl">
        {!embedded && (
          <h1 className="text-2xl font-bold">ذمم العملاء والموردين</h1>
        )}

        {/* دليل سريع لليوزر */}
        <div className="rounded-2xl border border-primary/25 bg-gradient-to-l from-primary/10 via-background to-accent/10 p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center">
              <Info className="w-5 h-5" />
            </div>
            <div className="text-sm leading-6">
              <div className="font-bold mb-0.5">الصفحة دي بتقولك مين ليه فلوس ومين عليه فلوس</div>
              <p className="text-muted-foreground text-[13px]">
                <span className="text-success font-semibold">الأخضر</span> = فلوس هتدخل لك من العملاء ·
                <span className="text-warning font-semibold"> الأصفر</span> = فلوس هتخرج منك للموردين والموظفين ·
                <span className="text-destructive font-semibold"> الأحمر</span> = أقساط فات ميعادها لازم تتحصّل دلوقتي.
                دوس على أي سطر في الجدول عشان تفتح كشف حساب الجهة.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-2xl border border-success/30 bg-success/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-success">
              <ArrowDownLeft className="w-4 h-4" />مستحق لنا (عملاء)
            </div>
            <div className="text-2xl font-extrabold text-success mt-2">{formatEGP(totals.due)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">فلوس هتدخل الخزنة</div>
          </div>

          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-warning">
              <ArrowUpRight className="w-4 h-4" />مستحق للموردين
            </div>
            <div className="text-2xl font-extrabold text-warning mt-2">{formatEGP(totals.oweSuppliers)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">فلوس هتخرج منك</div>
          </div>

          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-warning">
              <Users className="w-4 h-4" />مستحق للموظفين
            </div>
            <div className="text-2xl font-extrabold text-warning mt-2">{formatEGP(totals.oweEmployees)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">سلف ومستحقات</div>
          </div>

          <div className={`rounded-2xl border p-4 ${totals.due - totals.owe >= 0 ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"}`}>
            <div className={`flex items-center gap-2 text-sm font-semibold ${totals.due - totals.owe >= 0 ? "text-primary" : "text-destructive"}`}>
              <Scale className="w-4 h-4" />الصافي
            </div>
            <div className={`text-2xl font-extrabold mt-2 ${totals.due - totals.owe >= 0 ? "text-primary" : "text-destructive"}`}>
              {formatEGP(totals.due - totals.owe)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {totals.due - totals.owe >= 0 ? "اللي ليك أكتر من اللي عليك" : "اللي عليك أكتر من اللي ليك"}
            </div>
          </div>

          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertCircle className="w-4 h-4" />متأخرات
            </div>
            <div className="text-2xl font-extrabold text-destructive mt-2">{formatEGP(totals.overdue)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{totals.overdueCount} قسط فات ميعاده</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pr-9" placeholder="ابحث باسم العميل أو المورد أو الموظف" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input-base px-3 py-2 border rounded-md bg-background" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="all">كل الفروع</option>
            {Object.entries(branches).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <Button variant="outline" onClick={async () => { setRefreshing(true); await load(); setRefreshing(false); }} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ml-1 ${refreshing ? "animate-spin" : ""}`} />تحديث
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">جاري التحميل…</div>
        ) : (
          <Tabs defaultValue="customer" dir="rtl">
            <TabsList className="flex-wrap h-auto">
              {(Object.keys(tabCfg) as (keyof typeof tabCfg)[]).map((k) => (
                <TabsTrigger key={k} value={k} className="gap-2">
                  <span className={tabCfg[k].color}>●</span>
                  {tabCfg[k].label} ({byType(k).length})
                </TabsTrigger>
              ))}
            </TabsList>
            {(Object.keys(tabCfg) as (keyof typeof tabCfg)[]).map((k) => (
              <TabsContent key={k} value={k} className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">{tabCfg[k].hint}</p>
                {renderTable(byType(k))}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </ConditionalLayout>
  );
}

