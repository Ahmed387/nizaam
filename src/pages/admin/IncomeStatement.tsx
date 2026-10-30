import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { fin } from "@/lib/financeTerms";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCanViewNetProfit, NET_PROFIT_MASK } from "@/lib/netProfitAccess";
import { FinancialAmount } from "@/components/FinancialAmount";
import { cairoTodayDay } from "@/lib/cairoDate";
import { rpcErrorText } from "@/lib/rpcError";
import { accountsOf, statementLines, type ProfitGroup, type ProfitStatement } from "@/lib/profitStatement";

/**
 * قائمة الدخل (migration 0135): `profit_statement(from, to, branch?)` — the books, split into the same lines as the
 * card «الشركة كسبانة / خسرانة» and the profit distribution, so the three numbers are always the same.
 */
export default function IncomeStatement() {
  const canViewNetProfit = useCanViewNetProfit();
  const { tenantId } = useAuth();
  const today = cairoTodayDay();
  const [from, setFrom] = useState<string>(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState<string>(today);
  const [branch, setBranch] = useState<string>("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<ProfitStatement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("branches").select("id, name").eq("is_active", true).eq("is_system", false).order("name")
      .then(({ data }) => setBranches((data ?? []) as any));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let off = false;
    setLoading(true); setErr(null);
    supabase.rpc("profit_statement" as any, { p_from: from, p_to: to, p_branch: branch === "all" ? null : branch } as any)
      .then(({ data, error }) => {
        if (off) return;
        if (error) { setErr(rpcErrorText(error, "قائمة الدخل")); setData(null); } else setData(data as any);
        setLoading(false);
      });
    return () => { off = true; };
  }, [tenantId, from, to, branch]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const t = data?.total;
  const net = Number(t?.net_profit ?? 0);
  const margin = t && t.net_sales > 0 ? (net / t.net_sales) * 100 : 0;
  const lines = statementLines(t);
  const detailOf: Partial<Record<string, ProfitGroup>> = { expenses: "expenses", other_income: "other_income", count_diff: "count_diff" };

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title={fin("incomeStatement")} subtitle="من الدفاتر — نفس رقم كارت «الشركة كسبانة / خسرانة» وتوزيع الأرباح" />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>الفترة</CardTitle>
            <Badge variant="default" className={net >= 0 ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}>
              {net >= 0 ? "ربح" : "خسارة"}
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div><Label>من</Label><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>إلى</Label><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
            <div>
              <Label>الفرع</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفروع</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="text-xs text-muted-foreground">صافي الربح</div>
              <FinancialAmount value={canViewNetProfit ? fmt(net) : NET_PROFIT_MASK} currency={canViewNetProfit} size="md" className={`justify-start ${!canViewNetProfit ? "text-muted-foreground" : net >= 0 ? "text-success" : "text-destructive"}`} />
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="text-xs text-muted-foreground">هامش صافي الربح من صافي المبيعات</div>
              <div className="text-2xl font-bold">{canViewNetProfit ? `${margin.toFixed(1)}%` : NET_PROFIT_MASK}</div>
            </div>
          </CardContent>
        </Card>

        {err && <div className="text-sm text-destructive">{err}</div>}

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-lg">قائمة الدخل</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center text-muted-foreground py-8">جاري التحميل...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right w-10"></TableHead>
                    <TableHead className="text-right">البند</TableHead>
                    <TableHead className="text-right w-48">القيمة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => {
                    const subtotal = l.op === "=";
                    const isNet = l.key === "net_profit";
                    const hidden = isNet && !canViewNetProfit;
                    const g = detailOf[l.key];
                    const detail = g ? accountsOf(data?.accounts, g) : [];
                    return [
                      <TableRow key={l.key} className={subtotal ? "font-bold bg-muted/50" : ""}>
                        <TableCell className="font-mono text-muted-foreground">{l.op}</TableCell>
                        <TableCell>
                          {l.label}
                          {l.hint && !subtotal && <div className="text-[11px] text-muted-foreground font-normal">{l.hint}</div>}
                        </TableCell>
                        <TableCell className={`font-mono ${isNet && !hidden ? (net >= 0 ? "text-success" : "text-destructive") : ""}`}>
                          {hidden ? NET_PROFIT_MASK : `${fmt(l.value)} ج.م`}
                        </TableCell>
                      </TableRow>,
                      ...detail.map((a) => (
                        <TableRow key={`${l.key}-${a.code}`} className="text-xs text-muted-foreground">
                          <TableCell></TableCell>
                          <TableCell className="pr-8">{a.code} — {a.name}</TableCell>
                          <TableCell className="font-mono">{fmt(a.amount)}</TableCell>
                        </TableRow>
                      )),
                    ];
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {branch === "all" && (data?.branches?.length ?? 0) > 1 && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-lg">حسب الفرع</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {["الفرع", "صافي المبيعات", "مجمل الربح", "المصروفات", "ربح التشغيل", "إيرادات أخرى", "فروقات الجرد", "صافي الربح"].map((h) => (
                      <TableHead key={h} className="text-right">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.branches.map((b) => (
                    <TableRow key={b.branch_id ?? "none"}>
                      <TableCell className="font-semibold">{b.branch}</TableCell>
                      <TableCell className="font-mono">{fmt(b.net_sales)}</TableCell>
                      <TableCell className="font-mono">{fmt(b.gross_profit)}</TableCell>
                      <TableCell className="font-mono">{fmt(b.expenses)}</TableCell>
                      <TableCell className="font-mono">{fmt(b.operating_profit)}</TableCell>
                      <TableCell className="font-mono">{fmt(b.other_income)}</TableCell>
                      <TableCell className="font-mono">{fmt(b.count_diff)}</TableCell>
                      <TableCell className={`font-mono font-bold ${b.net_profit >= 0 ? "text-success" : "text-destructive"}`}>
                        {canViewNetProfit ? fmt(b.net_profit) : NET_PROFIT_MASK}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
