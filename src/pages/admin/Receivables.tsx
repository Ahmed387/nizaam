import { useEffect, useMemo, useState } from "react";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { supabase } from "@/integrations/supabase/client";
import { cairoTodayDay } from "@/lib/cairoDate";
import { fetchAllRows } from "@/lib/fetchAll";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatEGP } from "@/lib/format";
import { AlertCircle, Search, RefreshCw, Calendar, Info, ArrowDownLeft, ArrowUpRight, Users } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Link, useNavigate } from "react-router-dom";
import { useBranchScope } from "@/lib/branchScope";
import { FinancialAmount } from "@/components/FinancialAmount";

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
const ROLE_OPTIONS = [
  { value: "all", label: "جميع الجهات" },
  { value: "customer", label: "عملاء فقط" },
  { value: "supplier", label: "موردين فقط" },
  { value: "both", label: "مورد وعميل معًا" },
] as const;

type RoleFilter = (typeof ROLE_OPTIONS)[number]["value"];

/** قراءة فقط لتصنيف كل جهة (عميل / مورد / الاثنين) من جدول الجهات. */
async function loadContactTypes(rows: any[]): Promise<Record<string, string>> {
  const ids = Array.from(
    new Set(
      (rows ?? [])
        .filter((r: any) => r.entity_id && r.entity_type !== "employee")
        .map((r: any) => String(r.entity_id))
    )
  );
  const types: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("contacts").select("id,type").in("id", ids.slice(i, i + 200));
    ((data ?? []) as any[]).forEach((c: any) => { types[c.id] = c.type; });
  }
  return types;
}

export default function Receivables({ embedded }: { embedded?: boolean } = {}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const { isAllowed, filterBranches } = useBranchScope();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [contactTypes, setContactTypes] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      await supabase.rpc("mark_overdue_installments" as any);
    } catch {}
    // active plans only (cancelled and completed plans are not receivables), every row (no 1,000 cap)
    const [pp, pi, { data: br }] = await Promise.all([
      fetchAllRows<any>(() => supabase.from("payment_plans").select("*").eq("status", "active").order("created_at", { ascending: false }).order("id")),
      fetchAllRows<any>(() => supabase.from("payment_installments").select("*").in("status", ["pending", "overdue", "partial"]).is("cancelled_at", null).order("id")),
      supabase.from("branches").select("id,name").eq("is_system", false),
    ]);
    setPlans((((pp as any) ?? []) as any[]).filter((r: any) => isAllowed(r.branch_id)) as any);
    setInstallments((pi as any) ?? []);
    const map: Record<string, string> = {};
    filterBranches((br ?? []) as any).forEach((b: any) => (map[b.id] = b.name));
    setBranches(map);
    setContactTypes(await loadContactTypes(((pp as any) ?? []) as any[]));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["payment_plans", "payment_installments", "invoice_payments", "invoices"], load);

  const matchesSearchAndBranch = (p: Plan) => {
    if (branchFilter !== "all" && p.branch_id !== branchFilter) return false;
    if (q && !p.entity_name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  };

  /** تصنيف الجهة من جدول الجهات — الموظفين ليهم تبويب مستقل، فملهمش تصنيف جهة. */
  const roleOf = (p: Plan) => (p.entity_type === "employee" ? "" : contactTypes[p.entity_id] ?? "");

  const filtered = useMemo(() => {
    return plans.filter((p) => {
      if (!matchesSearchAndBranch(p)) return false;
      if (roleFilter !== "all" && roleOf(p) !== roleFilter) return false;
      return true;
    });
  }, [plans, q, branchFilter, roleFilter, contactTypes]);

  /** عدد السطور اللي هتظهر لو اخترت كل تصنيف، مع احترام البحث والفلتر الحاليين. */
  const roleCounts = useMemo(() => {
    const counts: Record<RoleFilter, number> = { all: 0, customer: 0, supplier: 0, both: 0 };
    plans.forEach((p) => {
      if (!matchesSearchAndBranch(p)) return;
      counts.all += 1;
      const role = roleOf(p);
      if (role === "customer" || role === "supplier" || role === "both") counts[role] += 1;
    });
    return counts;
  }, [plans, q, branchFilter, contactTypes]);

  const byType = (t: string) => filtered.filter((p) => p.entity_type === t);

  const totals = useMemo(() => {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const sumType = (t: string) =>
      r2(filtered.filter((p) => p.entity_type === t).reduce((s, p) => s + Number(p.remaining_amount || 0), 0));
    // overdue = due before today (Cairo), not paid, on the plans listed here — each side on its own
    const today = cairoTodayDay();
    const planType = new Map(filtered.map((p) => [p.id, p.entity_type]));
    const late = installments.filter((i) => planType.has(i.payment_plan_id) && String(i.due_date) < today
      && Number(i.amount) - Number(i.paid_amount || 0) > 0.005);
    const lateOf = (t: string) => late.filter((i) => planType.get(i.payment_plan_id) === t);
    const sumLate = (rows: Installment[]) => r2(rows.reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount || 0)), 0));
    return {
      due: sumType("customer"),
      oweSuppliers: sumType("supplier"),
      oweEmployees: sumType("employee"),
      overdue: sumLate(lateOf("customer")),
      overdueCount: lateOf("customer").length,
      overdueSuppliers: sumLate(lateOf("supplier")),
      overdueSuppliersCount: lateOf("supplier").length,
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
             <FinancialAmount value={totals.due} size="md" className="mt-2 justify-start font-extrabold text-success" />
            <div className="text-[11px] text-muted-foreground mt-1">فلوس هتدخل الخزنة</div>
          </div>

          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-warning">
              <ArrowUpRight className="w-4 h-4" />مستحق للموردين
            </div>
             <FinancialAmount value={totals.oweSuppliers} size="md" className="mt-2 justify-start font-extrabold text-warning" />
            <div className="text-[11px] text-muted-foreground mt-1">فلوس هتخرج منك</div>
          </div>

          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-warning">
              <Users className="w-4 h-4" />مستحق للموظفين
            </div>
             <FinancialAmount value={totals.oweEmployees} size="md" className="mt-2 justify-start font-extrabold text-warning" />
            <div className="text-[11px] text-muted-foreground mt-1">سلف ومستحقات</div>
          </div>

          <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-warning">
              <AlertCircle className="w-4 h-4" />أقساط موردين متأخرة
            </div>
             <FinancialAmount value={totals.overdueSuppliers} size="md" className="mt-2 justify-start font-extrabold text-warning" />
            <div className="text-[11px] text-muted-foreground mt-1">{totals.overdueSuppliersCount} قسط علينا فات ميعاده</div>
          </div>

          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertCircle className="w-4 h-4" />متأخرات العملاء
            </div>
             <FinancialAmount value={totals.overdue} size="md" className="mt-2 justify-start font-extrabold text-destructive" />
            <div className="text-[11px] text-muted-foreground mt-1">{totals.overdueCount} قسط لنا فات ميعاده</div>
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
          <div className="flex flex-wrap gap-1.5 items-center" role="group" aria-label="فلتر تصنيف الجهة">
            {ROLE_OPTIONS.map((o) => {
              const active = roleFilter === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={active}
                  title="فلتر تصنيف الجهة"
                  onClick={() => setRoleFilter(o.value)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-bold transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-border bg-background text-foreground hover:bg-surface-2"
                  }`}
                >
                  {o.label}
                  <span className="mr-1.5 text-[10px] font-semibold opacity-70">{roleCounts[o.value]}</span>
                </button>
              );
            })}
          </div>
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

