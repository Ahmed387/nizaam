// «القوائم المالية» (migration 0227, owner 2026-11-15 «صفحة او تابه مسماه القوائم المالية وكل تابه فيها قائمة لوحدة … وبعد كدا
// تابه بتحلل القوائم المالية … لو موجودة فى اى حتة بالبرنامج يشيلها ويخليها فى حتة واحدة»): ONE page, ONE filter (period +
// branch) for every tab — income, balance sheet (at the end of the period), cash flow, equity changes, cost of goods sold,
// analysis (against the period before, or two periods the owner picks). The old pages redirect here (?tab=…). The trial
// balance stays with the books (owner's answer). Permission: admin_acc_statements.view (every tab can be hidden alone).
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cairoTodayDay } from "@/lib/cairoDate";
import { STATEMENT_TABS, isStatementTab, previousPeriod, type StatementTab } from "@/lib/financialAnalysis";
import { IncomeStatementView } from "./IncomeStatement";
import { BalanceSheetView } from "./BalanceSheet";
import { CashFlowStatementView } from "./CashFlowStatement";
import { EquityChangesView } from "./EquityChanges";
import { CogsStatementView } from "./CogsStatement";
import { FinancialAnalysisView } from "@/components/statements/FinancialAnalysisView";

const Shell = ({ embedded, children }: { embedded?: boolean; children: React.ReactNode }) =>
  embedded ? <>{children}</> : <AdminLayout>{children}</AdminLayout>;

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const lastOfMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** `embedded`: inside the partners page (owner 2026-11-25) — no layout / header, its tab in `?st=` (the host owns `?tab=`). */
export default function FinancialStatements({ embedded }: { embedded?: boolean } = {}) {
  const tabKey = embedded ? "st" : "tab";
  const { tenantId } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = cairoTodayDay();
  const tab: StatementTab = isStatementTab(params.get(tabKey)) ? (params.get(tabKey) as StatementTab) : "income";
  const [from, setFrom] = useState(params.get("from") || monthStart(today));
  const [to, setTo] = useState(params.get("to") || today);
  const [branch, setBranch] = useState<string>(params.get("branch") || "");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [cmpMode, setCmpMode] = useState<"prev" | "custom">("prev");
  const prev = useMemo(() => (from && to && from <= to ? previousPeriod(from, to) : { from, to }), [from, to]);
  const [cmpFrom, setCmpFrom] = useState(prev.from);
  const [cmpTo, setCmpTo] = useState(prev.to);
  useEffect(() => { if (cmpMode === "prev") { setCmpFrom(prev.from); setCmpTo(prev.to); } }, [prev, cmpMode]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("branches").select("id, name").eq("is_active", true).eq("is_system", false).order("name")
      .then(({ data }) => setBranches((data ?? []) as any));
  }, [tenantId]);

  const setTab = (t: string) => setParams((p) => { p.set(tabKey, t); return p; }, { replace: true });
  const valid = !!from && !!to && from <= to && (cmpMode === "prev" || (!!cmpFrom && !!cmpTo && cmpFrom <= cmpTo));
  const props = { from, to, branch: branch || null };
  const preset = (f: string, t: string) => { setFrom(f); setTo(t); };
  const lastMonth = (() => { const p = previousPeriod(monthStart(today), lastOfMonth(today)); return p; })();

  return (
    <Shell embedded={embedded}>
      <div dir="rtl" className="text-right space-y-5">
        {!embedded && <PageHeader title="القوائم المالية" subtitle="كل القوائم في مكان واحد، من القيود — فلتر واحد للفترة والفرع لكل التابات، وتاب يحلل القوائم" />}

        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label>من</Label><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
            <div className="space-y-1"><Label>إلى</Label><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
            <div className="space-y-1">
              <Label>الفرع</Label>
              <select className="h-10 rounded-md border bg-background px-3 text-sm min-w-[180px]" value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">كل الفروع (الشركة)</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => preset(monthStart(today), today)}>الشهر ده</Button>
              <Button size="sm" variant="ghost" onClick={() => preset(lastMonth.from, lastMonth.to)}>الشهر اللي فات</Button>
              <Button size="sm" variant="ghost" onClick={() => preset(`${today.slice(0, 4)}-01-01`, today)}>من أول السنة</Button>
            </div>
            {tab === "analysis" && (
              <div className="w-full flex flex-wrap items-end gap-3 border-t pt-3">
                <div className="space-y-1">
                  <Label>قارن بـ</Label>
                  <select className="h-10 rounded-md border bg-background px-3 text-sm" value={cmpMode} onChange={(e) => setCmpMode(e.target.value as any)}>
                    <option value="prev">الفترة اللي قبلها ({prev.from} → {prev.to})</option>
                    <option value="custom">فترة أنا أختارها</option>
                  </select>
                </div>
                {cmpMode === "custom" && (
                  <>
                    <div className="space-y-1"><Label>من</Label><Input type="date" value={cmpFrom} max={cmpTo} onChange={(e) => setCmpFrom(e.target.value)} className="w-40" /></div>
                    <div className="space-y-1"><Label>إلى</Label><Input type="date" value={cmpTo} min={cmpFrom} onChange={(e) => setCmpTo(e.target.value)} className="w-40" /></div>
                  </>
                )}
              </div>
            )}
            {!valid && <div className="w-full text-sm text-destructive">الفترة غلط — «من» لازم يكون قبل «إلى».</div>}
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto">
            {STATEMENT_TABS.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
          </TabsList>
          {valid && (
            <>
              <TabsContent value="income" className="mt-4">{tab === "income" && <IncomeStatementView {...props} />}</TabsContent>
              <TabsContent value="balance" className="mt-4">{tab === "balance" && <BalanceSheetView {...props} />}</TabsContent>
              <TabsContent value="cashflow" className="mt-4">{tab === "cashflow" && <CashFlowStatementView {...props} />}</TabsContent>
              <TabsContent value="equity" className="mt-4">{tab === "equity" && <EquityChangesView {...props} />}</TabsContent>
              <TabsContent value="cogs" className="mt-4">{tab === "cogs" && <CogsStatementView {...props} />}</TabsContent>
              <TabsContent value="analysis" className="mt-4">{tab === "analysis" && <FinancialAnalysisView {...props} cmpFrom={cmpFrom} cmpTo={cmpTo} />}</TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </Shell>
  );
}
