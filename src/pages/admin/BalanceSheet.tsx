import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { fin } from "@/lib/financeTerms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Scale } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";
import { rpcErrorText } from "@/lib/rpcError";
import type { StatementProps } from "@/lib/financialAnalysis";

/**
 * قائمة المركز المالي — tab «المركز المالي» of «القوائم المالية» (migration 0227): `balance_sheet(as_of = the filter's «إلى»,
 * branch)` sums every account on the server (it used to read every journal line into the browser). Customers / suppliers
 * are the accounts' balances (Σ مدين / Σ دائن), not the gross 1200 / 2100 of the current account (0212) — only their
 * difference is a balance, and it equals Σ مدين − Σ دائن to the piaster, so the statement still balances.
 */
export default function BalanceSheet() {
  return <Navigate to="/admin/financial-statements?tab=balance" replace />;
}

type Acc = { code: string; name: string; type: "asset" | "liability" | "equity"; amount: number };
type Data = { as_of: string; accounts: Acc[]; net_income: number; receivables: number; payables: number };
type Row = { id: string; label: string; amount: number; hint?: string };

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.amount, 0);

export function BalanceSheetView({ to, branch }: StatementProps) {
  const { tenantId } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let off = false;
    setLoading(true); setErr(null);
    (supabase.rpc as any)("balance_sheet", { p_as_of: to, p_branch: branch }).then(({ data, error }: any) => {
      if (off) return;
      setLoading(false);
      if (error) { setErr(rpcErrorText(error, "المركز المالي")); setData(null); return; }
      setData(data as Data);
    });
    return () => { off = true; };
  }, [tenantId, to, branch]);

  const { assets, liabilities, equity } = useMemo(() => {
    const acc = data?.accounts ?? [];
    const row = (a: Acc): Row => ({ id: a.code, label: a.name, amount: Number(a.amount) });
    return {
      assets: [
        ...acc.filter((a) => a.type === "asset" && a.code < "1200").map(row),
        { id: "rec", label: "العملاء — مدين (لنا عندهم)", amount: Number(data?.receivables ?? 0), hint: "مجموع أرصدة الحسابات اللي عليها (مدين)" },
        ...acc.filter((a) => a.type === "asset" && a.code > "1200").map(row),
      ],
      liabilities: [
        { id: "pay", label: "الموردين — دائن (علينا ليهم)", amount: Number(data?.payables ?? 0), hint: "مجموع أرصدة الحسابات اللي ليها (دائن)" },
        ...acc.filter((a) => a.type === "liability").map(row),
      ],
      equity: acc.filter((a) => a.type === "equity").map(row),
    };
  }, [data]);

  const netIncome = Number(data?.net_income ?? 0);
  const totalAssets = sum(assets);
  const totalLiab = sum(liabilities);
  const totalEquity = sum(equity) + netIncome;
  const totalLE = totalLiab + totalEquity;
  const isBalanced = Math.abs(totalAssets - totalLE) < 0.01;

  const Section = ({ title, rows, total, showNI }: { title: string; rows: Row[]; total: number; showNI?: boolean }) => (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
      <CardContent>
        <Table noFilter>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">الحساب</TableHead>
              <TableHead className="text-center w-44">الرصيد</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.label}{r.hint && <div className="text-[11px] text-muted-foreground">{r.hint}</div>}</TableCell>
                <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(r.amount)}</TableCell>
              </TableRow>
            ))}
            {showNI && (
              <TableRow>
                <TableCell className="italic text-muted-foreground">أرباح لسه ماتقفلتش (المبيعات − المصروفات لحد التاريخ ده)</TableCell>
                <TableCell className={"text-center font-mono tabular-nums whitespace-nowrap " + (netIncome >= 0 ? "text-success" : "text-destructive")}>{fmt(netIncome)}</TableCell>
              </TableRow>
            )}
            <TableRow className="font-bold bg-muted/50">
              <TableCell>إجمالي {title}</TableCell>
              <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Scale className="w-5 h-5" /> {fin("balanceSheet")} في {to}</CardTitle>
          {data && (
            <Badge variant={isBalanced ? "default" : "destructive"} className={isBalanced ? "bg-green-500/15 text-green-600 border-green-500/30" : ""}>
              {isBalanced ? "متوازنة ✓" : "غير متوازنة ✗"}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-xs text-muted-foreground">إجمالي الأصول</div>
            <FinancialAmount value={fmt(totalAssets)} size="md" className="justify-start" />
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-xs text-muted-foreground">إجمالي الالتزامات + حقوق الملكية</div>
            <FinancialAmount value={fmt(totalLE)} size="md" className="justify-start" />
          </div>
          <div className="md:col-span-2 text-xs text-muted-foreground">
            المركز المالي في آخر يوم من الفترة اللي فوق. العملاء والموردين هنا = أرصدة الحسابات زي صفحة «أرصدة المدين والدائن».
          </div>
        </CardContent>
      </Card>

      {err && <div className="text-sm text-destructive">{err}</div>}
      {loading ? (
        <div className="text-center text-muted-foreground py-8">جاري التحميل...</div>
      ) : data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="الأصول" rows={assets} total={totalAssets} />
          <div className="space-y-6">
            <Section title="الالتزامات" rows={liabilities} total={totalLiab} />
            <Section title="حقوق الملكية" rows={equity} total={totalEquity} showNI />
          </div>
        </div>
      )}
    </div>
  );
}
