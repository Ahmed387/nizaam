// tab «تحليل القوائم المالية» (migration 0227, owner 2026-11-15): the period against another one — summary of what needs
// attention, the ratios (meaning, formula, verdict), the income statement side by side (horizontal: change, vertical: % of
// net sales), the balance items at both ends, and the last 12 months. Numbers from `financial_analysis` (the books).
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { rpcErrorText } from "@/lib/rpcError";
import { useCanViewNetProfit, NET_PROFIT_MASK } from "@/lib/netProfitAccess";
import { ArrowDownRight, ArrowUpRight, Loader2, Info } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BALANCE_ROWS, INCOME_ROWS, VERDICT, balanceOf, change, incomeOf, ratioText, ratiosOf, share,
  type Analysis, type Ratio, type StatementProps,
} from "@/lib/financialAnalysis";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctText = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

function Delta({ cur, prev, higherBetter = true }: { cur: number; prev: number; higherBetter?: boolean }) {
  const { diff, pct } = change(cur, prev);
  if (Math.abs(diff) < 0.005) return <span className="text-muted-foreground">بدون تغيير</span>;
  const up = diff > 0;
  const good = up === higherBetter;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${good ? "text-success" : "text-destructive"}`}>
      {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      <span className="font-mono tabular-nums">{fmt(Math.abs(diff))}</span>
      {pct !== null && <span className="text-xs">({Math.abs(pct).toFixed(1)}%)</span>}
    </span>
  );
}

export function FinancialAnalysisView({ from, to, branch, cmpFrom, cmpTo }: StatementProps & { cmpFrom: string; cmpTo: string }) {
  const { tenantId } = useAuth();
  const canProfit = useCanViewNetProfit();
  const [data, setData] = useState<Analysis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let off = false;
    setLoading(true); setErr(null);
    (supabase.rpc as any)("financial_analysis", { p_from: from, p_to: to, p_cmp_from: cmpFrom, p_cmp_to: cmpTo, p_branch: branch })
      .then(({ data, error }: any) => {
        if (off) return;
        setLoading(false);
        if (error) { setErr(rpcErrorText(error, "تحليل القوائم المالية")); setData(null); return; }
        setData(data as Analysis);
      });
    return () => { off = true; };
  }, [tenantId, from, to, cmpFrom, cmpTo, branch]);

  const ic = useMemo(() => incomeOf(data?.pl.cur), [data]);
  const ip = useMemo(() => incomeOf(data?.pl.cmp), [data]);
  const be = useMemo(() => balanceOf(data?.bal.cur_end), [data]);
  const pe = useMemo(() => balanceOf(data?.bal.cmp_end), [data]);
  const ratios = useMemo(() => (data ? ratiosOf(data) : []), [data]);
  const hideProfit = (key: string) => !canProfit && (key === "net_profit" || key === "net_margin" || key === "roe");

  if (loading) return <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />بنحلل القوائم…</div>;
  if (err) return <div className="text-sm text-destructive">{err}</div>;
  if (!data) return null;

  const attention = ratios.filter((r) => (r.verdict === "bad" || r.verdict === "watch") && !hideProfit(r.key))
    .sort((a, b) => (a.verdict === "bad" ? 0 : 1) - (b.verdict === "bad" ? 0 : 1));
  const groups = ["الربحية", "السيولة", "النشاط", "المديونية"] as const;
  const periodLabel = `${data.cur.from} → ${data.cur.to}`;
  const cmpLabel = `${data.cmp.from} → ${data.cmp.to}`;
  const chart = data.months.map((m) => ({
    name: monthName(m.month), "صافي المبيعات": m.net_sales, "مجمل الربح": m.net_sales - m.cogs, ...(canProfit ? { "صافي الربح": m.net_profit } : {}),
  }));

  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <Info className="w-3.5 h-3.5" /> الفترة <b className="tabular-nums">{periodLabel}</b> مقارنة بـ <b className="tabular-nums">{cmpLabel}</b> — كل الأرقام من القيود.
      </div>

      {/* headline numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { k: "صافي المبيعات", c: ic.net_sales, p: ip.net_sales, hb: true },
          { k: "مجمل الربح", c: ic.gross_profit, p: ip.gross_profit, hb: true },
          { k: "صافي الربح", c: ic.net_profit, p: ip.net_profit, hb: true, profit: true },
          { k: "النقدية آخر الفترة", c: be.cash, p: pe.cash, hb: true },
        ].map((x) => (
          <Card key={x.k}>
            <CardContent className="p-4 space-y-1">
              <div className="text-xs text-muted-foreground">{x.k}</div>
              {x.profit && !canProfit ? <div className="text-xl font-bold">{NET_PROFIT_MASK}</div> : (
                <>
                  <div className={`text-xl font-bold font-mono tabular-nums ${x.c < 0 ? "text-destructive" : ""}`}>{fmt(x.c)}</div>
                  <div className="text-xs">قبلها {fmt(x.p)} · <Delta cur={x.c} prev={x.p} higherBetter={x.hb} /></div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* what needs attention */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">الخلاصة — إيه اللي محتاج انتباه</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {attention.length === 0 ? <div className="text-success">مفيش حاجة مقلقة في النسب في الفترة دي.</div> : attention.map((r) => (
            <div key={r.key} className="flex flex-wrap items-start gap-2">
              <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${VERDICT[r.verdict].tone}`}>{VERDICT[r.verdict].label}</span>
              <span><b>{r.label}: {ratioText(r.cur, r.unit)}</b> — {r.advice}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ratios */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">النسب المالية</CardTitle></CardHeader>
        <CardContent className="p-0 sm:p-2">
          <Table noFilter>
            <TableHeader>
              <TableRow>
                <TableHead>النسبة</TableHead>
                <TableHead className="text-center whitespace-nowrap">الفترة دي</TableHead>
                <TableHead className="text-center whitespace-nowrap">الفترة اللي قبلها</TableHead>
                <TableHead className="text-center whitespace-nowrap">الحكم</TableHead>
                <TableHead>يعني إيه وبتتحسب إزاي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => [
                <TableRow key={g} className="bg-muted/40"><TableCell colSpan={5} className="font-semibold">{g}</TableCell></TableRow>,
                ...ratios.filter((r) => r.group === g).map((r: Ratio) => {
                  const hidden = hideProfit(r.key);
                  return (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium whitespace-nowrap">{r.label}</TableCell>
                      <TableCell className="text-center font-mono tabular-nums whitespace-nowrap font-semibold">{hidden ? NET_PROFIT_MASK : ratioText(r.cur, r.unit)}</TableCell>
                      <TableCell className="text-center font-mono tabular-nums whitespace-nowrap text-muted-foreground">{hidden ? NET_PROFIT_MASK : ratioText(r.cmp, r.unit)}</TableCell>
                      <TableCell className="text-center">
                        {!hidden && <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${VERDICT[r.verdict].tone}`} title={r.advice}>{VERDICT[r.verdict].label}</span>}
                      </TableCell>
                      <TableCell className="text-xs leading-5 min-w-[260px]">
                        {r.meaning}
                        <div className="text-muted-foreground">{r.formula}</div>
                      </TableCell>
                    </TableRow>
                  );
                }),
              ])}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* income: horizontal + vertical */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">قائمة الدخل — مقارنة (أفقي) ونسبة كل بند من صافي المبيعات (رأسي)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-2">
          <Table noFilter>
            <TableHeader>
              <TableRow>
                <TableHead>البند</TableHead>
                <TableHead className="text-center whitespace-nowrap">الفترة دي</TableHead>
                <TableHead className="text-center whitespace-nowrap">% من المبيعات</TableHead>
                <TableHead className="text-center whitespace-nowrap">الفترة اللي قبلها</TableHead>
                <TableHead className="text-center whitespace-nowrap">% من المبيعات</TableHead>
                <TableHead className="text-center whitespace-nowrap">التغير</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {INCOME_ROWS.map((r) => {
                const hidden = !canProfit && r.key === "net_profit";
                const costLike = r.key === "returns" || r.key === "cogs" || r.key === "expenses";
                return (
                  <TableRow key={r.key} className={r.sub ? "font-bold bg-muted/40" : ""}>
                    <TableCell className="whitespace-nowrap">{r.label}</TableCell>
                    <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{hidden ? NET_PROFIT_MASK : fmt(ic[r.key])}</TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">{hidden ? "" : pctText(share(ic[r.key], ic.net_sales))}</TableCell>
                    <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{hidden ? NET_PROFIT_MASK : fmt(ip[r.key])}</TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">{hidden ? "" : pctText(share(ip[r.key], ip.net_sales))}</TableCell>
                    <TableCell className="text-center">{hidden ? "" : <Delta cur={ic[r.key]} prev={ip[r.key]} higherBetter={!costLike} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* balance: both ends */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">المركز المالي — آخر الفترة دي قصاد آخر الفترة اللي قبلها (ونسبة كل بند من الأصول)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-2">
          <Table noFilter>
            <TableHeader>
              <TableRow>
                <TableHead>البند</TableHead>
                <TableHead className="text-center whitespace-nowrap">في {data.cur.to}</TableHead>
                <TableHead className="text-center whitespace-nowrap">% من الأصول</TableHead>
                <TableHead className="text-center whitespace-nowrap">في {data.cmp.to}</TableHead>
                <TableHead className="text-center whitespace-nowrap">التغير</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {BALANCE_ROWS.map((r) => {
                const liab = r.key === "payables" || r.key === "other_liabilities" || r.key === "current_liabilities";
                return (
                  <TableRow key={r.key} className={r.sub ? "font-bold bg-muted/40" : ""}>
                    <TableCell className="whitespace-nowrap">{r.label}</TableCell>
                    <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(be[r.key])}</TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">{pctText(share(be[r.key], be.total_assets))}</TableCell>
                    <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(pe[r.key])}</TableCell>
                    <TableCell className="text-center"><Delta cur={be[r.key]} prev={pe[r.key]} higherBetter={!liab} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* last 12 months */}
      {chart.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">آخر {chart.length} شهر</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="s" tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
                  <Bar yAxisId="s" dataKey="صافي المبيعات" fill="hsl(var(--primary))" opacity={0.35} />
                  <Line yAxisId="p" dataKey="مجمل الربح" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                  {canProfit && <Line yAxisId="p" dataKey="صافي الربح" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs text-muted-foreground mt-1">المبيعات على الشمال، والأرباح على اليمين.</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
