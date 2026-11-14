import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { rpcErrorText } from "@/lib/rpcError";
import { CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * «قائمة التغيرات في حقوق الملكية» (migration 0214, owner 2026-11-14): from the books only (`equity_changes`).
 * Lines: partners' capital · start-of-business balances (3950) · retained earnings (3800 + every period's profit).
 * Columns: أول الفترة · زيادات · تخفيضات · صافي ربح الفترة · آخر الفترة. The closing total is checked against the
 * balance sheet on the last day (الأصول − الالتزامات).
 */
type Row = { key: string; label: string; opening: number; increase: number; decrease: number; profit: number; closing: number; details: { source: string; amount: number }[] };
type Data = { rows: Row[]; total: Omit<Row, "key" | "label" | "details">; balance_sheet: { assets: number; liabilities: number; equity: number } };

const SOURCE_LABEL: Record<string, string> = {
  voucher: "سندات (تسويات السنين اللي فاتت / خصومات لا تضاف للربح)",
  treasury_row_reversal: "إلغاء حركات شركاء / مرتجعات سنين سابقة",
  opening_balance_reversal: "عكس أرصدة افتتاحية قديمة",
  voucher_reclass: "تغيير بند سند",
  partner_share: "حصص تشغيل ومرتبات من الربح",
};
const src = (s: string) => SOURCE_LABEL[s] ?? s;
const n = (v: unknown) => Number(v) || 0;

export default function EquityChanges() {
  const [from, setFrom] = useState(`${cairoTodayDay().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(cairoTodayDay());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    (supabase.rpc as any)("equity_changes", { p_from: from, p_to: to }).then(({ data, error }: any) => {
      if (!live) return;
      setLoading(false);
      if (error) { setError(rpcErrorText(error, "قائمة التغيرات في حقوق الملكية")); setData(null); return; }
      setData(data as Data);
    });
    return () => { live = false; };
  }, [from, to]);

  const diff = data ? Math.round((n(data.total.closing) - n(data.balance_sheet.equity)) * 100) / 100 : 0;

  return (
    <AdminLayout>
      <PageHeader title="قائمة التغيرات في حقوق الملكية" subtitle="حقوق الشركاء أول الفترة، وإيه اللي زاد ونقص، وربح الفترة، والرصيد آخر الفترة — من القيود." />
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1"><Label>من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
          <div className="space-y-1"><Label>إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
          {data && (
            <div className={`ms-auto flex items-center gap-2 text-sm font-semibold ${Math.abs(diff) <= 0.05 ? "text-success" : "text-destructive"}`}>
              {Math.abs(diff) <= 0.05 ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {Math.abs(diff) <= 0.05
                ? `مطابقة للمركز المالي: الأصول ${formatEGP(data.balance_sheet.assets)} − الالتزامات ${formatEGP(data.balance_sheet.liabilities)}`
                : `فرق مع المركز المالي ${formatEGP(diff)}`}
            </div>
          )}
        </CardContent>
      </Card>
      {error && <div className="text-destructive text-sm mb-3">{error}</div>}
      <Card>
        <CardHeader><CardTitle>من {from} إلى {to}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">البند</TableHead>
                <TableHead className="text-right">الرصيد أول الفترة</TableHead>
                <TableHead className="text-right">زيادات</TableHead>
                <TableHead className="text-right">تخفيضات</TableHead>
                <TableHead className="text-right">صافي ربح الفترة</TableHead>
                <TableHead className="text-right">الرصيد آخر الفترة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">جاري التحميل…</TableCell></TableRow>}
              {!loading && data?.rows.map((r) => (
                <TableRow key={r.key} className="align-top">
                  <TableCell>
                    <div className="font-semibold">{r.label}</div>
                    {r.details.length > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
                        {r.details.map((d) => <div key={d.source}>{src(d.source)}: {formatEGP(Math.abs(n(d.amount)))} {n(d.amount) >= 0 ? "زيادة" : "نقص"}</div>)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatEGP(n(r.opening))}</TableCell>
                  <TableCell className="tabular-nums text-success">{n(r.increase) ? formatEGP(n(r.increase)) : "—"}</TableCell>
                  <TableCell className="tabular-nums text-destructive">{n(r.decrease) ? formatEGP(n(r.decrease)) : "—"}</TableCell>
                  <TableCell className={`tabular-nums ${n(r.profit) < 0 ? "text-destructive" : ""}`}>{n(r.profit) ? `${formatEGP(Math.abs(n(r.profit)))} ${n(r.profit) < 0 ? "خسارة" : "ربح"}` : "—"}</TableCell>
                  <TableCell className="tabular-nums font-bold">{formatEGP(n(r.closing))}</TableCell>
                </TableRow>
              ))}
              {!loading && data && (
                <TableRow className="bg-muted/40 font-bold">
                  <TableCell>إجمالي حقوق الملكية</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(n(data.total.opening))}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(n(data.total.increase))}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(n(data.total.decrease))}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(n(data.total.profit))}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(n(data.total.closing))}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
