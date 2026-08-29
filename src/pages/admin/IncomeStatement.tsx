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
import { useAuth } from "@/contexts/AuthContext";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useCanViewNetProfit, NET_PROFIT_MASK } from "@/lib/netProfitAccess";

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

function firstOfMonth() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function IncomeStatement() {
  const canViewNetProfit = useCanViewNetProfit();
  const { tenantId } = useAuth();
  const [from, setFrom] = useState<string>(firstOfMonth());
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    supabase.from("journal_entry_lines" as any)
      .select("debit,credit,chart_of_accounts!inner(id,code,name,name_ar,account_type,normal_balance),journal_entries!inner(entry_date,status,tenant_id)")
      .eq("journal_entries.tenant_id", tenantId)
      .eq("journal_entries.status", "posted")
      .gte("journal_entries.entry_date", from)
      .lte("journal_entries.entry_date", to)
      .then(({ data }) => {
        const all = (data ?? []) as any[];
        setLines(all.filter(l => l.chart_of_accounts && ["revenue", "expense"].includes(l.chart_of_accounts.account_type)));
        setLoading(false);
      });
  }, [tenantId, from, to]);

  const { revenues, expenses } = useMemo(() => {
    const map = new Map<string, { code: string; label: string; type: string; nb: string; d: number; c: number }>();
    for (const l of lines) {
      const a = l.chart_of_accounts;
      if (!a) continue;
      const cur = map.get(a.id) || { code: a.code, label: a.name_ar || a.name, type: a.account_type, nb: a.normal_balance, d: 0, c: 0 };
      cur.d += Number(l.debit || 0);
      cur.c += Number(l.credit || 0);
      map.set(a.id, cur);
    }
    const revenues: Row[] = [], expenses: Row[] = [];
    for (const [id, v] of map) {
      const bal = v.nb === "debit" ? v.d - v.c : v.c - v.d;
      if (bal === 0) continue;
      if (v.type === "revenue") revenues.push({ id, code: v.code, label: v.label, amount: bal });
      else if (v.type === "expense") expenses.push({ id, code: v.code, label: v.label, amount: bal });
    }
    revenues.sort((a, b) => a.code.localeCompare(b.code));
    expenses.sort((a, b) => a.code.localeCompare(b.code));
    return { revenues, expenses };
  }, [lines]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalRev = revenues.reduce((s, r) => s + r.amount, 0);
  const totalExp = expenses.reduce((s, r) => s + r.amount, 0);
  const net = totalRev - totalExp;
  const margin = totalRev > 0 ? (net / totalRev) * 100 : 0;

  const Section = ({ title, rows, total, tone }: { title: string; rows: Row[]; total: number; tone: "success" | "destructive" }) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          {tone === "success" ? <TrendingUp className="w-5 h-5 text-success" /> : <TrendingDown className="w-5 h-5 text-destructive" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right w-24">الكود</TableHead>
              <TableHead className="text-right">الحساب</TableHead>
              <TableHead className="text-right w-40">القيمة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لا توجد حركة</TableCell></TableRow>
            )}
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.code}</TableCell>
                <TableCell>{r.label}</TableCell>
                <TableCell className="font-mono">{fmt(r.amount)}</TableCell>
              </TableRow>
            ))}
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
        <PageHeader title={fin("incomeStatement")} subtitle={`${fin("revenue")} − ${fin("expenses")} = ${fin("netProfit")}`} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>الفترة</CardTitle>
            <Badge variant="default" className={net >= 0 ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}>
              {net >= 0 ? "ربح" : "خسارة"}
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div><Label>من</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label>إلى</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="text-xs text-muted-foreground">صافي الربح (Net Profit)</div>
              <div className={"text-2xl font-bold " + (net >= 0 ? "text-success" : "text-destructive")}>{fmt(net)} <span className="text-sm">ج.م</span></div>
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="text-xs text-muted-foreground">هامش الربح (Profit Margin)</div>
              <div className="text-2xl font-bold">{margin.toFixed(1)}%</div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="text-center text-muted-foreground py-8">جاري التحميل...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title={fin("revenue")} rows={revenues} total={totalRev} tone="success" />
            <Section title={fin("expenses")} rows={expenses} total={totalExp} tone="destructive" />
          </div>
        )}

        <Card>
          <CardContent className="py-4 flex items-center justify-between text-lg">
            <span className="font-semibold">صافي الربح للفترة (Net Profit)</span>
            <span className={"font-mono font-bold " + (net >= 0 ? "text-success" : "text-destructive")}>{fmt(net)} ج.م</span>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
