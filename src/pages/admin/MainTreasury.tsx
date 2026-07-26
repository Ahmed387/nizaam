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
import { ArrowDownCircle, ArrowUpCircle, Wallet, Store, TrendingUp } from "lucide-react";

type BranchRow = { id: string; name: string; code: string };
type TxRow = {
  id: string; branch_id: string; type: "income" | "expense"; category: string;
  amount: number; description: string | null; payment_method: string; created_at: string;
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function MainTreasury() {
  const { tenantId } = useAuth();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(daysAgoStr(30));
  const [to, setTo] = useState(todayStr());
  const [branchFilter, setBranchFilter] = useState<string>("all");

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    // Only real operational branches — exclude the system partner-cash branch
    const { data: brs } = await supabase
      .from("branches")
      .select("id,name,code")
      .eq("tenant_id", tenantId)
      .neq("code", "PARTNER-CASH")
      .order("name");
    const branchList = (brs ?? []) as BranchRow[];
    setBranches(branchList);

    if (branchList.length === 0) { setRows([]); setLoading(false); return; }

    const { data: tr } = await supabase
      .from("treasury")
      .select("id,branch_id,type,category,amount,description,payment_method,created_at")
      .in("branch_id", branchList.map(b => b.id))
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false });
    setRows((tr ?? []) as TxRow[]);
    setLoading(false);
  }, [tenantId, from, to]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["treasury", "branches"], load);

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
        title="الخزنة الرئيسية"
        subtitle="تجميع الوارد والصادر من الفروع الـ 3 — للعرض فقط (لا تُسجَّل فيها حركات)"
      />

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
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {perBranch.map(({ branch, cin, cout }) => {
          const net = cin - cout;
          return (
            <Link
              key={branch.id}
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
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">وارد:</span>
                  <b className="text-success">{formatEGP(cin)}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">صادر:</span>
                  <b className="text-destructive">{formatEGP(cout)}</b>
                </div>
                <div className="flex justify-between pt-1.5 border-t">
                  <span className="font-bold">الصافي:</span>
                  <b className={net >= 0 ? "text-success" : "text-destructive"}>{formatEGP(net)}</b>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

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
