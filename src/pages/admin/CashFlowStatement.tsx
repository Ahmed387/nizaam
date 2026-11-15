import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { fin } from "@/lib/financeTerms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";
import type { StatementProps } from "@/lib/financialAnalysis";

/**
 * Cash Flow Statement — Indirect approach via cash-touching journal entries.
 * For every journal entry that touches a "cash" account (1100 خزينة / 1110 بنك),
 * we take the net cash movement of that entry, and classify it by the non-cash
 * contra accounts in the same entry:
 *   - Operating  : revenue, expense, AR (1200), AP (2100), Inventory (1300), VAT (2200)
 *   - Investing  : any other asset (fixed assets, etc.)
 *   - Financing  : equity accounts, partner advances (1400)
 */

type Line = {
  debit: number;
  credit: number;
  chart_of_accounts: {
    id: string; code: string; name_ar: string | null; name: string;
    account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
  };
};
type Entry = {
  id: string;
  entry_date: string;
  description: string | null;
  journal_entry_lines: Line[];
};

const CASH_CODES = new Set(["1100", "1110"]);


type Bucket = "operating" | "investing" | "financing";
function classify(code: string, type: string): Bucket {
  if (["1200", "2100", "2200", "1300", "2300"].includes(code)) return "operating";
  if (type === "revenue" || type === "expense") return "operating";
  if (code === "1400" || type === "equity") return "financing";
  if (type === "asset") return "investing";
  if (type === "liability") return "financing";
  return "operating";
}

export default function CashFlowStatement() {
  return <Navigate to="/admin/financial-statements?tab=cashflow" replace />;
}

const dayBefore = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

/** tab «التدفقات النقدية» of «القوائم المالية» — period and branch come from the page filter */
export function CashFlowStatementView({ from, to, branch }: StatementProps) {
  const { tenantId } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [openingCash, setOpeningCash] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    (async () => {
      // 1. Opening cash = cash accounts at the end of the day before (server sum, migration 0227 — it used to read every line)
      const { data: bs, error: bsErr } = await (supabase.rpc as any)("balance_sheet", { p_as_of: dayBefore(from), p_branch: branch });
      if (bsErr) { setErr(rpcErrorText(bsErr, "التدفقات النقدية")); setLoading(false); return; }
      setErr(null);
      setOpeningCash(((bs?.accounts ?? []) as { code: string; amount: number }[])
        .filter((a) => CASH_CODES.has(a.code)).reduce((s, a) => s + Number(a.amount || 0), 0));

      // 2. Entries in the period with all lines
      const ents = await fetchAllRows<any>(() => supabase.from("journal_entries" as any)
        .select("id,entry_date,description,journal_entry_lines(debit,credit,chart_of_accounts(id,code,name,name_ar,account_type))")
        .eq("tenant_id", tenantId)
        .eq("status", "posted")
        .gte("entry_date", from)
        .lte("entry_date", to)
        .match(branch ? { branch_id: branch } : {})
        .order("id")).catch(() => [] as any[]);
      setEntries((ents ?? []) as any);
      setLoading(false);
    })();
  }, [tenantId, from, to, branch]);

  const { buckets, netByBucket, totalNet } = useMemo(() => {
    const buckets: Record<Bucket, Map<string, { label: string; amount: number }>> = {
      operating: new Map(), investing: new Map(), financing: new Map(),
    };
    for (const e of entries) {
      const lines = e.journal_entry_lines || [];
      // Net cash movement in this entry (positive = cash in, negative = cash out)
      let cashNet = 0;
      const others: Line[] = [];
      for (const l of lines) {
        const a = l.chart_of_accounts;
        if (!a) continue;
        if (CASH_CODES.has(a.code)) {
          cashNet += Number(l.debit || 0) - Number(l.credit || 0);
        } else {
          others.push(l);
        }
      }
      if (Math.abs(cashNet) < 0.005 || others.length === 0) continue;

      // Distribute the cashNet across contra accounts weighted by their side movement
      const weights = others.map(l => Math.abs(Number(l.debit || 0) - Number(l.credit || 0)));
      const wSum = weights.reduce((s, w) => s + w, 0) || 1;
      others.forEach((l, i) => {
        const share = cashNet * (weights[i] / wSum);
        const a = l.chart_of_accounts;
        const bucket = classify(a.code, a.account_type);
        const label = `${a.code} — ${a.name_ar || a.name}`;
        const cur = buckets[bucket].get(a.id) || { label, amount: 0 };
        cur.amount += share;
        buckets[bucket].set(a.id, cur);
      });
    }
    const netByBucket: Record<Bucket, number> = { operating: 0, investing: 0, financing: 0 };
    (Object.keys(buckets) as Bucket[]).forEach(b => {
      for (const v of buckets[b].values()) netByBucket[b] += v.amount;
    });
    const totalNet = netByBucket.operating + netByBucket.investing + netByBucket.financing;
    return { buckets, netByBucket, totalNet };
  }, [entries]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const closingCash = openingCash + totalNet;

  const Section = ({ title, bucket, tone }: { title: string; bucket: Bucket; tone: "primary" | "warning" | "success" }) => {
    const rows = Array.from(buckets[bucket].entries())
      .map(([id, v]) => ({ id, ...v }))
      .filter(r => Math.abs(r.amount) > 0.005)
      .sort((a, b) => b.amount - a.amount);
    return (
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Badge className={`bg-${tone}/15 text-${tone} border-${tone}/30`}>
            صافي: {fmt(netByBucket[bucket])}
          </Badge>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">الحساب</TableHead>
                <TableHead className="text-right w-40">التدفق</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">لا توجد حركة</TableCell></TableRow>
              )}
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className={"font-mono " + (r.amount >= 0 ? "text-success" : "text-destructive")}>
                    {r.amount >= 0 ? "+" : ""}{fmt(r.amount)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold bg-muted/50">
                <TableCell>صافي {title}</TableCell>
                <TableCell className={"font-mono " + (netByBucket[bucket] >= 0 ? "text-success" : "text-destructive")}>
                  {fmt(netByBucket[bucket])}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5" />{fin("cashFlow")} — التشغيلي / الاستثماري / التمويلي</CardTitle>
            <Badge className={totalNet >= 0 ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}>
              {totalNet >= 0 ? <><ArrowUpRight className="w-3 h-3 inline ml-1" /> صافي داخل</> : <><ArrowDownRight className="w-3 h-3 inline ml-1" /> صافي خارج</>}
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="text-xs text-muted-foreground">رصيد افتتاحي</div>
              <div className="text-lg font-bold">{fmt(openingCash)}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="text-xs text-muted-foreground">صافي التغير</div>
              <div className={"text-lg font-bold " + (totalNet >= 0 ? "text-success" : "text-destructive")}>{fmt(totalNet)}</div>
            </div>
            <div className="p-3 rounded-lg bg-primary/10">
              <div className="text-xs text-muted-foreground">رصيد ختامي</div>
              <div className="text-lg font-bold">{fmt(closingCash)}</div>
            </div>
          </CardContent>
        </Card>

        {err && <div className="text-sm text-destructive">{err}</div>}
        {loading ? (
          <div className="text-center text-muted-foreground py-8">جاري التحميل...</div>
        ) : (
          <div className="space-y-6">
            <Section title="التدفقات التشغيلية" bucket="operating" tone="primary" />
            <Section title="التدفقات الاستثمارية" bucket="investing" tone="warning" />
            <Section title="التدفقات التمويلية" bucket="financing" tone="success" />
          </div>
        )}
      </div>
  );
}
