import { getCairoDayBounds } from "@/lib/cairoDate";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP, formatDate } from "@/lib/format";
import { ArrowDownCircle, ArrowUpCircle, Wallet, Store, TrendingUp, Building2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { FinancialAmount } from "@/components/FinancialAmount";

type BranchRow = { id: string; name: string; code: string };
type TxRow = {
  id: string; branch_id: string; type: "income" | "expense"; category: string;
  amount: number; description: string | null; payment_method: string; created_at: string;
};
type ViewBal = { branch_id: string; current_balance: number; last_transaction_date: string | null };

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function MainTreasury() {
  const { tenantId } = useAuth();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [glBalances, setGlBalances] = useState<Record<string, ViewBal>>({});
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(daysAgoStr(30));
  const [to, setTo] = useState(todayStr());
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [notes, setNotes] = useState("");
  const [notesQ, setNotesQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setNotesQ(notes.trim()), 300);
    return () => clearTimeout(t);
  }, [notes]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    // كل الخزائن الحقيقية: الفروع + خزينة الشركاء (النظامية)
    const { data: brs } = await supabase
      .from("branches")
      .select("id,name,code")
      .eq("tenant_id", tenantId)
      .order("name");
    const branchList = (brs ?? []) as BranchRow[];
    setBranches(branchList);

    if (branchList.length === 0) { setRows([]); setLoading(false); return; }

    let tq = supabase
      .from("treasury")
      .select("id,branch_id,type,category,amount,description,payment_method,created_at")
      .in("branch_id", branchList.map(b => b.id))
      .gte("created_at", getCairoDayBounds(from).startIso!)
      .lte("created_at", getCairoDayBounds(undefined, to).endIso!)
      .order("created_at", { ascending: false });
    if (notesQ) tq = tq.ilike("description", `%${notesQ.replace(/[%_,()\\]/g, " ")}%`);
    const [{ data: tr }, { data: vb }] = await Promise.all([
      tq,
      // Live GL cash balance per branch (accounts 1100+1110) — sourced from journal_entries
      supabase
        .from("v_treasury_balances" as any)
        .select("branch_id,current_balance,last_transaction_date")
        .in("branch_id", branchList.map(b => b.id)),
    ]);
    setRows((tr ?? []) as TxRow[]);
    const map: Record<string, ViewBal> = {};
    for (const r of ((vb ?? []) as any[])) map[r.branch_id] = r as ViewBal;
    setGlBalances(map);
    setLoading(false);
  }, [tenantId, from, to, notesQ]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["treasury", "branches", "journal_entries", "journal_entry_lines"], load);

  const filtered = useMemo(
    () => branchFilter === "all" ? rows : rows.filter(r => r.branch_id === branchFilter),
    [rows, branchFilter],
  );

  const totals = useMemo(() => {
    let cin = 0, cout = 0;
    for (const r of filtered) {
      const amt = Number(r.amount);
      if (r.type === "income") cin += amt; else cout += amt;
    }
    return { cin, cout, net: cin - cout };
  }, [filtered]);

  // Per-branch rollup (uses filtered range, ignores branchFilter to always show all branches)
  const perBranch = useMemo(() => {
    const map = new Map<string, { branch: BranchRow; cin: number; cout: number; lastAt: string | null }>();
    for (const b of branches) map.set(b.id, { branch: b, cin: 0, cout: 0, lastAt: null });
    for (const r of rows) {
      const entry = map.get(r.branch_id);
      if (!entry) continue;
      const amt = Number(r.amount);
      if (r.type === "income") entry.cin += amt; else entry.cout += amt;
      if (!entry.lastAt || r.created_at > entry.lastAt) entry.lastAt = r.created_at;
    }
    return Array.from(map.values());
  }, [rows, branches]);

  return (
    <AdminLayout>
      <PageHeader
        title="ملخص الخزائن (Treasury Overview)"
        subtitle="نظرة عامة على أرصدة وحركات كل الخزائن — للعرض فقط"
        actions={
          <Button asChild className="btn-gradient">
            <Link to="/admin/accounting/branch-capital">
              <Building2 className="w-4 h-4 ml-1" /> تحويل فلوس من خزنة الشركاء للفروع
            </Link>
          </Button>
        }
      />

      <div className="card-elevated p-4 mb-6 border-r-4 border-primary bg-primary/5 text-sm leading-7">
        الصفحة دي <b>للعرض بس</b>، وبتجمّعلك أرصدة كل الخزائن الحقيقية (الفروع + خزينة الشركاء) في مكان واحد.
        <b> لتحويل فلوس فعلي</b>، استخدم زرار <b>«تحويل فلوس من خزنة الشركاء للفروع»</b> فوق، أو روح لخزنة الفرع نفسه.
      </div>


      {/* Filters */}
      <div className="card-elevated p-4 mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">من تاريخ</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">إلى تاريخ</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">بحث الملاحظات</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="كلمة من الوصف…" className="w-48" />
        </div>
        <div className="flex gap-2 mr-auto">
          <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoStr(7)); setTo(todayStr()); }}>آخر 7 أيام</Button>
          <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoStr(30)); setTo(todayStr()); }}>30 يوم</Button>
          <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoStr(90)); setTo(todayStr()); }}>90 يوم</Button>
        </div>
      </div>

      {/* Overall totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="إجمالي الوارد" value={formatEGP(totals.cin)} icon={<ArrowDownCircle className="w-5 h-5" />} accent="success" />
        <StatCard label="إجمالي الصادر" value={formatEGP(totals.cout)} icon={<ArrowUpCircle className="w-5 h-5" />} accent="destructive" />
        <StatCard label="صافي التدفق" value={formatEGP(totals.net)} icon={<TrendingUp className="w-5 h-5" />} accent={totals.net >= 0 ? "success" : "destructive"} />
        <StatCard label="عدد الفروع" value={branches.length} icon={<Store className="w-5 h-5" />} accent="primary" />
      </div>

      {/* Per-branch rollup cards */}
      <h3 className="font-bold mb-3 flex items-center gap-2"><Wallet className="w-4 h-4" /> تفصيل الفروع</h3>
      <TooltipProvider delayDuration={200}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {perBranch.map(({ branch, cin, cout, lastAt }) => {
          const net = cin - cout;
          const gl = glBalances[branch.id];
          const glBal = Number(gl?.current_balance ?? 0);
          return (
            <Tooltip key={branch.id}>
              <TooltipTrigger asChild>
                <Link
                  to={`/branch/${branch.id}/treasury`}
                  className="card-elevated p-4 hover:shadow-lg transition-shadow block"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-bold text-base">{branch.name}</div>
                      <div className="text-xs text-muted-foreground">{branch.code}</div>
                    </div>
                    <Wallet className="w-5 h-5 text-primary" />
                  </div>
                  <div className="text-xs text-muted-foreground mb-1">الرصيد الحالى (دفتر الأستاذ)</div>
                   <FinancialAmount value={glBal} size="md" className={`mb-1 justify-start font-extrabold ${glBal >= 0 ? "text-success" : "text-destructive"}`} />
                  <div className="text-[11px] text-muted-foreground">
                    صافي حركة الفترة: <b className={net >= 0 ? "text-success" : "text-destructive"}>{formatEGP(net)}</b>
                    {" · "}
                    {lastAt ? `آخر تحديث: ${formatDate(lastAt)}` : "لا حركات فى الفترة"}
                  </div>
                  <div className="mt-2 pt-2 border-t flex justify-between text-xs">
                    <span className="text-success">وارد: <b>{formatEGP(cin)}</b></span>
                    <span className="text-destructive">صادر: <b>{formatEGP(cout)}</b></span>
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs space-y-1">
                <div className="font-bold">{branch.name}</div>
                <div>الرصيد الحالى (GL): <b className={glBal >= 0 ? "text-success" : "text-destructive"}>{formatEGP(glBal)}</b></div>
                <div>إجمالي الوارد (الفترة): <b className="text-success">{formatEGP(cin)}</b></div>
                <div>إجمالي الصادر (الفترة): <b className="text-destructive">{formatEGP(cout)}</b></div>
                <div>صافي حركة الفترة: <b className={net >= 0 ? "text-success" : "text-destructive"}>{formatEGP(net)}</b></div>
                <div className="text-muted-foreground pt-1 border-t">{lastAt ? `آخر حركة: ${formatDate(lastAt)}` : "لا حركات"}</div>
              </TooltipContent>

            </Tooltip>
          );
        })}
      </div>
      </TooltipProvider>

      {/* Movements table with filter */}
      <div className="card-elevated p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-bold">حركات الخزنة</h3>
          <Tabs value={branchFilter} onValueChange={setBranchFilter}>
            <TabsList>
              <TabsTrigger value="all">كل الفروع</TabsTrigger>
              {branches.map(b => (
                <TabsTrigger key={b.id} value={b.id}>{b.name}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <DataTable
          loading={loading}
          rows={filtered}
          empty="لا توجد حركات في الفترة المحددة"
          columns={[
            { key: "created_at", header: "التاريخ", render: (r: TxRow) => formatDate(r.created_at) },
            { key: "branch", header: "الفرع", render: (r: TxRow) => branches.find(b => b.id === r.branch_id)?.name ?? "—" },
            { key: "type", header: "النوع", render: (r: TxRow) => (
              <span className={r.type === "income" ? "text-success font-bold" : "text-destructive font-bold"}>
                {r.type === "income" ? "وارد ↓" : "صادر ↑"}
              </span>
            )},
            { key: "category", header: "التصنيف" },
            { key: "payment_method", header: "طريقة الدفع" },
            { key: "description", header: "الوصف", render: (r: TxRow) => r.description ?? "—" },
            { key: "amount", header: "المبلغ", render: (r: TxRow) => (
              <b className={r.type === "income" ? "text-success" : "text-destructive"}>{formatEGP(Number(r.amount))}</b>
            )},
          ]}
        />
      </div>
    </AdminLayout>
  );
}
