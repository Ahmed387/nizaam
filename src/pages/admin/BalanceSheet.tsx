import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { fin } from "@/lib/financeTerms";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { Scale } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";
import { cairoTodayDay } from "@/lib/cairoDate";

type Line = {
  debit: number;
  credit: number;
  chart_of_accounts: {
    id: string; code: string; name: string; name_ar: string | null;
    account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
    normal_balance: "debit" | "credit";
  };
  journal_entries: { entry_date: string; status: string };
};

type Row = { id: string; code: string; label: string; amount: number };

const typeLabels: Record<string, string> = {
  asset: "الأصول", liability: "الخصوم", equity: "حقوق الملكية",
};

export default function BalanceSheet() {
  const { tenantId } = useAuth();
  const [asOf, setAsOf] = useState<string>(() => cairoTodayDay());
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    fetchAllRows<any>(() => supabase.from("journal_entry_lines" as any)
      .select("id,debit,credit,chart_of_accounts!inner(id,code,name,name_ar,account_type,normal_balance),journal_entries!inner(entry_date,status,tenant_id)")
      .eq("journal_entries.tenant_id", tenantId)
      .eq("journal_entries.status", "posted")
      .lte("journal_entries.entry_date", asOf)
      .order("id"))
      .then((data) => { setLines((data ?? []) as any); })
      .catch(() => setLines([]))
      .finally(() => setLoading(false));
  }, [tenantId, asOf]);

  const { assets, liabilities, equity, netIncome } = useMemo(() => {
    const map = new Map<string, { code: string; label: string; type: string; nb: string; d: number; c: number }>();
    for (const l of lines) {
      const a = l.chart_of_accounts;
      if (!a) continue;
      const key = a.id;
      const cur = map.get(key) || { code: a.code, label: a.name_ar || a.name, type: a.account_type, nb: a.normal_balance, d: 0, c: 0 };
      cur.d += Number(l.debit || 0);
      cur.c += Number(l.credit || 0);
      map.set(key, cur);
    }
    const assets: Row[] = [], liabilities: Row[] = [], equity: Row[] = [];
    let rev = 0, exp = 0;
    for (const [id, v] of map) {
      const bal = v.nb === "debit" ? v.d - v.c : v.c - v.d;
      if (v.type === "asset" && bal !== 0) assets.push({ id, code: v.code, label: v.label, amount: bal });
      else if (v.type === "liability" && bal !== 0) liabilities.push({ id, code: v.code, label: v.label, amount: bal });
      else if (v.type === "equity" && bal !== 0) equity.push({ id, code: v.code, label: v.label, amount: bal });
      else if (v.type === "revenue") rev += bal;
      else if (v.type === "expense") exp += bal;
    }
    const netIncome = rev - exp;
    assets.sort((a, b) => a.code.localeCompare(b.code));
    liabilities.sort((a, b) => a.code.localeCompare(b.code));
    equity.sort((a, b) => a.code.localeCompare(b.code));
    return { assets, liabilities, equity, netIncome };
  }, [lines]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.amount, 0);

  const totalAssets = sum(assets);
  const totalLiab = sum(liabilities);
  const totalEquity = sum(equity) + netIncome;
  const totalLE = totalLiab + totalEquity;
  const isBalanced = Math.abs(totalAssets - totalLE) < 0.01;

  const Section = ({ title, rows, total, showNI }: { title: string; rows: Row[]; total: number; showNI?: boolean }) => (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right w-24">الكود</TableHead>
              <TableHead className="text-right">الحساب</TableHead>
              <TableHead className="text-right w-40">الرصيد</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.code}</TableCell>
                <TableCell>{r.label}</TableCell>
                <TableCell className="font-mono">{fmt(r.amount)}</TableCell>
              </TableRow>
            ))}
            {showNI && (
              <TableRow>
                <TableCell className="font-mono">—</TableCell>
                <TableCell className="italic text-muted-foreground">صافي الربح (Net Profit) للفترة = المبيعات (Revenue) − المصروفات (Expenses)</TableCell>
                <TableCell className={"font-mono " + (netIncome >= 0 ? "text-success" : "text-destructive")}>{fmt(netIncome)}</TableCell>
              </TableRow>
            )}
            <TableRow className="font-bold bg-muted/50">
              <TableCell colSpan={2}>إجمالي {title}</TableCell>
              <TableCell className="font-mono">{fmt(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title={fin("balanceSheet")} subtitle={`الأصول (Assets) = الخصوم (Liabilities) + ${fin("equity")}`} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Scale className="w-5 h-5" /> كما في تاريخ</CardTitle>
            <Badge variant={isBalanced ? "default" : "destructive"} className={isBalanced ? "bg-green-500/15 text-green-600 border-green-500/30" : ""}>
              {isBalanced ? "متوازنة ✓" : "غير متوازنة ✗"}
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <Label>التاريخ</Label>
              <Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="text-xs text-muted-foreground">إجمالي الأصول</div>
               <FinancialAmount value={fmt(totalAssets)} size="md" className="justify-start" />
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="text-xs text-muted-foreground">إجمالي الخصوم + حقوق الملكية</div>
               <FinancialAmount value={fmt(totalLE)} size="md" className="justify-start" />
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="text-center text-muted-foreground py-8">جاري التحميل...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title={typeLabels.asset} rows={assets} total={totalAssets} />
            <div className="space-y-6">
              <Section title={typeLabels.liability} rows={liabilities} total={totalLiab} />
              <Section title={typeLabels.equity} rows={equity} total={totalEquity} showNI />
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
