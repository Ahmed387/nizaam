import { readAll } from "@/hooks/useWholeList";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PermTable } from "@/components/PermTable";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { TX_LABEL, txSign, type PartnerTxType } from "@/lib/partners";

/**
 * «الحركات» — every partner movement of the company, newest first (read only). Money in / out is recorded from the
 * partner's own page (0137: branch, vessel and day), so each row links there.
 */
export default function PartnerTransactions({ embedded }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<any[]>([]);
  const [type, setType] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await readAll<any>(() => supabase.from("partner_transactions" as any)
        .select("id, partner_id, transaction_type, amount, description, movement_date, created_at, is_void, cancel_reason, equity_partners(name)")
        .neq("amount", 0)
        .order("created_at", { ascending: false }).order("id"));
      setRows(data);
      setLoading(false);
    })();
  }, []);

  const shown = useMemo(() => (type === "all" ? rows : rows.filter((r) => r.transaction_type === type)), [rows, type]);

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <div dir="rtl" className="text-right space-y-4">
        {!embedded && <PageHeader title="حركات الشركاء" subtitle="كل مساهمة وسحب ونصيب — بتتسجل من صفحة كل شريك" />}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle>حركات الشركاء</CardTitle>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحركات</SelectItem>
                {(Object.keys(TX_LABEL) as PartnerTxType[]).map((k) => <SelectItem key={k} value={k}>{TX_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <PermTable className="w-full text-sm" permTable="partner_all_moves">
              <thead className="bg-muted/40">
                <tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">الشريك</th><th className="p-2">الحركة</th><th className="p-2">المبلغ</th><th className="p-2">البيان</th><th className="p-2">الحالة</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">جاري التحميل…</td></tr>}
                {!loading && shown.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">مفيش حركات</td></tr>}
                {shown.map((r) => (
                  <tr key={r.id} className={`border-t ${r.is_void ? "opacity-60" : ""}`}>
                    <td className="p-2 whitespace-nowrap">{r.movement_date ?? String(r.created_at).slice(0, 10)}</td>
                    <td className="p-2"><Link className="hover:underline" to={`/admin/financial-position/partner/${r.partner_id}`}>{r.equity_partners?.name ?? "—"}</Link></td>
                    <td className="p-2">{TX_LABEL[r.transaction_type as PartnerTxType] ?? r.transaction_type}</td>
                    <td className={`p-2 font-semibold whitespace-nowrap ${txSign(r.transaction_type) < 0 ? "text-destructive" : "text-success"}`}>
                      {txSign(r.transaction_type) < 0 ? "−" : "+"}{formatEGP(r.amount)}
                    </td>
                    <td className="p-2 text-xs">{r.description}</td>
                    <td className="p-2">{r.is_void ? <Badge variant="destructive" title={r.cancel_reason ?? ""}>ملغي</Badge> : <Badge variant="secondary">شغال</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </PermTable>
          </CardContent>
        </Card>
      </div>
    </ConditionalLayout>
  );
}
