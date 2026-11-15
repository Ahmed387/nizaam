// «الحسابات المخفية» (migration 0226, owner 2026-11-15 «الصفحة دي ما تظهرش غير للمالك بس ويبقي فيها مين اللي المالك عامله hide
// وينفع كمان يلغيه»): every account the owner hid, why, when, its documents and balance, and «إظهار». Owner only (the server
// refuses anybody else; for them the page says so).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";
import { netOf, netText, netTone } from "@/lib/netBalance";

type Row = {
  contact_id: string; account_no: number | null; name: string; contact_type: string; branch_name: string | null;
  hidden_at: string; hidden_by_name: string | null; reason: string | null; documents: number;
  customer_balance: number; supplier_balance: number;
};
const TYPE: Record<string, string> = { customer: "عميل", supplier: "مورد", both: "عميل ومورد" };
const when = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" });

export default function HiddenContacts() {
  const { isOwner } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("hidden_contacts_list" as any);
    setLoading(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    setRows((data as Row[]) ?? []);
  };
  useEffect(() => { if (isOwner) load(); else setLoading(false); }, [isOwner]);

  const show = async (r: Row) => {
    setBusy(r.contact_id);
    const { error } = await supabase.rpc("set_contact_hidden" as any, { p_contact: r.contact_id, p_hidden: false, p_reason: null });
    setBusy("");
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(`«${r.name}» رجع يظهر للكل`);
    load();
  };

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-5">
        <PageHeader title="الحسابات المخفية"
          subtitle="الحسابات اللي إنت مخفيها بكل فواتيرها وسنداتها عن أي حد غيرك — فلوسها محسوبة في الخزنة والأرباح والإجماليات زي ما هي" />
        {!isOwner ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">الصفحة دي لمالك الشركة بس.</CardContent></Card>
        ) : (
          <Card><CardContent className="p-0">
            <div className="p-3 text-sm text-muted-foreground leading-6">
              عشان تخفي حساب: افتح ملف العميل أو المورد ودوس «إخفاء». الحساب المخفي مش بيظهر لحد غيرك في القوايم ولا البحث ولا التقارير
              ولا الخزنة، ومحدش غيرك يقدر يعمل له فاتورة أو سند.
            </div>
            <Table permTable="hidden_contacts">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">رقم الحساب</TableHead>
                  <TableHead>اسم الحساب</TableHead>
                  <TableHead className="whitespace-nowrap">طبيعة الحساب</TableHead>
                  <TableHead className="whitespace-nowrap">الفرع</TableHead>
                  <TableHead className="text-center whitespace-nowrap">الرصيد الحالي</TableHead>
                  <TableHead className="text-center whitespace-nowrap">المستندات</TableHead>
                  <TableHead className="whitespace-nowrap">اتخفى</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead className="text-center whitespace-nowrap">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={9} className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
                {!loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8"><EyeOff className="w-5 h-5 inline ml-2" />مفيش حسابات مخفية</TableCell></TableRow>
                )}
                {!loading && rows.map(r => {
                  const net = netOf(Number(r.customer_balance), Number(r.supplier_balance));
                  return (
                    <TableRow key={r.contact_id}>
                      <TableCell className="tabular-nums">{r.account_no ?? "—"}</TableCell>
                      <TableCell className="font-medium"><Link className="underline" to={`/admin/contacts/${r.contact_id}`}>{r.name}</Link></TableCell>
                      <TableCell className="whitespace-nowrap">{TYPE[r.contact_type] ?? r.contact_type}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.branch_name ?? "—"}</TableCell>
                      <TableCell className={`text-center font-mono tabular-nums whitespace-nowrap ${netTone(net)}`}>{netText(net)}</TableCell>
                      <TableCell className="text-center tabular-nums">{r.documents}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{when(r.hidden_at)}{r.hidden_by_name ? <div className="text-muted-foreground">{r.hidden_by_name}</div> : null}</TableCell>
                      <TableCell className="text-sm max-w-[260px]">{r.reason || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => show(r)}>
                          {busy === r.contact_id ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Eye className="w-4 h-4 ml-1" />}إظهار
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        )}
      </div>
    </AdminLayout>
  );
}
