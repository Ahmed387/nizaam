import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import type { StatementProps } from "@/lib/financialAnalysis";
import { rpcErrorText } from "@/lib/rpcError";
import { CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * «قائمة تكلفة البضاعة المباعة» (migration 0214, owner 2026-11-14), from the books (`cogs_statement`):
 * مخزون أول المدة + المشتريات − مرتجعات المشتريات + مرتجعات سنين سابقة + تسويات المخزون الافتتاحي = بضاعة متاحة؛
 * − مخزون آخر المدة = تكلفة البضاعة المباعة. The pieces customers returned are inside the end stock, so the result is
 * already net of them; it must equal the cost line of the income statement for the same period.
 */
type Data = Record<string, number>;
const n = (v: unknown) => Number(v) || 0;

export default function CogsStatement() {
  return <Navigate to="/admin/financial-statements?tab=cogs" replace />;
}

/** tab «تكلفة البضاعة المباعة» of «القوائم المالية» — period and branch come from the page filter */
export function CogsStatementView({ from, to, branch }: StatementProps) {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    (supabase.rpc as any)("cogs_statement", { p_from: from, p_to: to, p_branch: branch || null }).then(({ data, error }: any) => {
      if (!live) return;
      if (error) { setError(rpcErrorText(error, "قائمة تكلفة البضاعة المباعة")); setD(null); return; }
      setD(data as Data);
    });
    return () => { live = false; };
  }, [from, to, branch]);

  const line = (label: string, v: number, opts: { sign?: "+" | "−"; bold?: boolean; note?: string } = {}) => (
    <TableRow className={opts.bold ? "bg-muted/40 font-bold" : ""}>
      <TableCell>{opts.sign ? <span className="text-muted-foreground ml-2">{opts.sign}</span> : null}{label}{opts.note && <div className="text-[11px] text-muted-foreground">{opts.note}</div>}</TableCell>
      <TableCell className={`tabular-nums ${v < 0 ? "text-destructive" : ""}`}>{v < 0 ? `(${formatEGP(Math.abs(v))})` : formatEGP(v)}</TableCell>
    </TableRow>
  );
  const diff = d ? Math.round((n(d.cogs) - n(d.cogs_books)) * 100) / 100 : 0;

  return (
    <div>
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="text-sm">
            <div className="font-semibold">قائمة تكلفة البضاعة المباعة — من القيود</div>
            <div className="text-xs text-muted-foreground">المخزون أول وآخر الفترة والمشتريات، وبيطلع منها تكلفة اللي اتباع.</div>
          </div>
          {d && (
            <div className={`ms-auto flex items-center gap-2 text-sm font-semibold ${Math.abs(diff) <= 0.05 ? "text-success" : "text-destructive"}`}>
              {Math.abs(diff) <= 0.05 ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {Math.abs(diff) <= 0.05 ? "مطابقة لتكلفة البضاعة في قائمة الدخل" : `فرق مع قائمة الدخل ${formatEGP(diff)}`}
            </div>
          )}
        </CardContent>
      </Card>
      {error && <div className="text-destructive text-sm mb-3">{error}</div>}
      {d && (
        <Card>
          <CardHeader><CardTitle>من {from} إلى {to}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {line("مخزون أول المدة", n(d.opening))}
                {line("المشتريات", n(d.purchases), { sign: "+" })}
                {line("مرتجعات المشتريات", -n(d.purchase_returns), { sign: "−" })}
                {n(d.prior_year_returns) !== 0 && line("مرتجعات فواتير سنين سابقة", n(d.prior_year_returns), { sign: "+" })}
                {n(d.opening_corrections) !== 0 && line("أرصدة وتسويات المخزون الافتتاحي", n(d.opening_corrections), { sign: "+" })}
                {n(d.other) !== 0 && line("حركات مخزون أخرى", n(d.other), { sign: "+" })}
                {line("البضاعة المتاحة للبيع", n(d.available), { bold: true })}
                {line("مخزون آخر المدة", -n(d.closing), { sign: "−" })}
                {line("تكلفة البضاعة المباعة", n(d.cogs), { bold: true, note: `تكلفة اللي اتباع ${formatEGP(n(d.sold_at_cost))} − تكلفة اللي رجع من العملاء ${formatEGP(n(d.customer_returns))}` })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
