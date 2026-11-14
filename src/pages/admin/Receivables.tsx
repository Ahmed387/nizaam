import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { supabase } from "@/integrations/supabase/client";
import { DataTable } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatEGP } from "@/lib/format";
import { Search, RefreshCw, ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { useBranchScope } from "@/lib/branchScope";
import { FinancialAmount } from "@/components/FinancialAmount";
import { fetchAllContactsPage, type ContactPageRow } from "@/lib/ledger";
import { netOf, netLabel } from "@/lib/netBalance";
import { InternalBranchBadge } from "@/components/contact/InternalBranchBadge";

/**
 * «أرصدة المدين والدائن» (owner 2026-11-14 «حساب جاري»): every account by its ONE balance in the chosen branch
 * (or all branches) — tab مدين (لنا عنده) / دائن (علينا له). No payment plans, no instalments, no open invoices:
 * the number is the account's balance (`contacts_page`, same as the contacts list), a row opens the account file.
 */
const typeLabel = (type: string) => (type === "customer" ? "عميل" : type === "supplier" ? "مورد" : "عميل ومورد");

export default function Receivables({ embedded }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { filterBranches } = useBranchScope();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ContactPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    supabase.from("branches").select("id,name").eq("is_system", false)
      .then(({ data }) => setBranches(filterBranches((data ?? []) as any) as any));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAllContactsPage({ branchId: branchFilter === "all" ? null : branchFilter, type: "all", balance: ["debit", "credit"] })
      .then((p) => { if (alive) setRows(p.rows); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [branchFilter, tick]);

  const netOfRow = (r: ContactPageRow) => netOf(r.customer_balance, r.supplier_balance); // + دائن / − مدين
  const shown = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("ar-EG");
    return rows.filter((r) => !s || `${r.name} ${r.phone ?? ""} ${(r as any).account_no ?? ""}`.toLocaleLowerCase("ar-EG").includes(s));
  }, [rows, q]);
  const debit = useMemo(() => shown.filter((r) => netOfRow(r) < -0.005).sort((a, b) => netOfRow(a) - netOfRow(b)), [shown]);
  const credit = useMemo(() => shown.filter((r) => netOfRow(r) > 0.005).sort((a, b) => netOfRow(b) - netOfRow(a)), [shown]);
  const sum = (list: ContactPageRow[]) => Math.round(list.reduce((s, r) => s + Math.abs(netOfRow(r)), 0) * 100) / 100;
  const dTotal = sum(debit), cTotal = sum(credit), net = cTotal - dTotal;

  const table = (list: ContactPageRow[], kind: "debit" | "credit") => (
    <DataTable
      loading={loading}
      rows={list}
      empty="مفيش حسابات"
      onRowClick={(r: any) => navigate(`/admin/contacts/${r.id}`)}
      columns={[
        { key: "account_no", header: "رقم الحساب", align: "center", render: (r: any) => r.account_no ?? "—" },
        { key: "name", header: "اسم الحساب", align: "right", render: (r: any) => <span className="font-semibold">{r.name}<InternalBranchBadge id={r.id} /></span> },
        { key: "type", header: "طبيعة الحساب", align: "center", render: (r: any) => typeLabel(r.type) },
        { key: "phone", header: "التليفون", align: "center", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
        { key: "bal", header: "الرصيد الحالى", align: "center", numeric: true, total: true,
          render: (r: any) => <b className={kind === "debit" ? "text-success" : "text-destructive"}>{formatEGP(Math.abs(netOfRow(r)))} {kind === "debit" ? "مدين" : "دائن"}</b> },
      ]}
    />
  );

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <div className="space-y-5" dir="rtl">
        {!embedded && <h1 className="text-2xl font-bold">أرصدة المدين والدائن</h1>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-success/30 bg-success/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-success"><ArrowDownLeft className="w-4 h-4" />إجمالي المدين (لنا)</div>
            <FinancialAmount value={dTotal} size="md" className="mt-2 justify-start font-extrabold text-success" />
            <div className="text-[11px] text-muted-foreground mt-1">{debit.length} حساب رصيده مدين</div>
          </div>
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive"><ArrowUpRight className="w-4 h-4" />إجمالي الدائن (علينا)</div>
            <FinancialAmount value={cTotal} size="md" className="mt-2 justify-start font-extrabold text-destructive" />
            <div className="text-[11px] text-muted-foreground mt-1">{credit.length} حساب رصيده دائن</div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="w-4 h-4" />الصافي — {netLabel(net)}</div>
            <FinancialAmount value={Math.abs(net)} size="md" className={`mt-2 justify-start font-extrabold ${net > 0.005 ? "text-destructive" : net < -0.005 ? "text-success" : ""}`} />
            <div className="text-[11px] text-muted-foreground mt-1">إجمالي الدائن − إجمالي المدين</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pr-9" placeholder="ابحث بالاسم أو رقم الحساب أو التليفون" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input-base px-3 py-2 border rounded-md bg-background" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="all">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <Button variant="outline" onClick={() => setTick((t) => t + 1)} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ml-1 ${loading ? "animate-spin" : ""}`} />تحديث
          </Button>
        </div>

        <Tabs defaultValue="debit" dir="rtl">
          <TabsList>
            <TabsTrigger value="debit"><span className="text-success ml-1">●</span>مدين — لنا عنده ({debit.length})</TabsTrigger>
            <TabsTrigger value="credit"><span className="text-destructive ml-1">●</span>دائن — علينا له ({credit.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="debit" className="mt-3">{table(debit, "debit")}</TabsContent>
          <TabsContent value="credit" className="mt-3">{table(credit, "credit")}</TabsContent>
        </Tabs>
      </div>
    </ConditionalLayout>
  );
}
