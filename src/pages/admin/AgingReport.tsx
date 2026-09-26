import { getCairoDayBounds } from "@/lib/cairoDate";
import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { fin } from "@/lib/financeTerms";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Users, Truck, AlertTriangle } from "lucide-react";

type Row = {
  id: string;
  contactName: string;
  docNumber: string;
  docDate: string;
  total: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
};

type Bucket = "current" | "b30" | "b60" | "b90" | "b90plus";
const bucketLabels: Record<Bucket, string> = {
  current: "0-30 يوم", b30: "31-60 يوم", b60: "61-90 يوم", b90: "91-120 يوم", b90plus: "أكثر من 120",
};

function bucketOf(days: number): Bucket {
  if (days <= 30) return "current";
  if (days <= 60) return "b30";
  if (days <= 90) return "b60";
  if (days <= 120) return "b90";
  return "b90plus";
}

export default function AgingReport() {
  const { tenantId } = useAuth();
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [ar, setAR] = useState<Row[]>([]);
  const [ap, setAP] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    (async () => {
      // === Customer Aging (AR) ===
      const { data: invs } = await supabase.from("invoices")
        .select("id,invoice_number,invoice_date,total,contact_id,status,contacts(name)")
        .eq("tenant_id", tenantId)
        .neq("status", "cancelled")
        .lte("invoice_date", getCairoDayBounds(undefined, asOf).endIso!);
      const invIds = (invs ?? []).map(i => i.id);
      let paidMap = new Map<string, number>();
      if (invIds.length) {
        const { data: pays } = await supabase.from("invoice_payments")
          .select("invoice_id,amount,voided_at,created_at")
          .in("invoice_id", invIds)
          .is("voided_at", null)
          .lte("created_at", getCairoDayBounds(undefined, asOf).endIso!);
        for (const p of pays ?? []) {
          paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) || 0) + Number(p.amount || 0));
        }
      }
      const asOfDate = new Date(asOf);
      const arRows: Row[] = [];
      for (const inv of invs ?? []) {
        const total = Number(inv.total || 0);
        const paid = paidMap.get(inv.id) || 0;
        const outstanding = total - paid;
        if (outstanding <= 0.005) continue;
        const days = Math.floor((asOfDate.getTime() - new Date(inv.invoice_date).getTime()) / 86400000);
        arRows.push({
          id: inv.id,
          contactName: (inv as any).contacts?.name || "-",
          docNumber: inv.invoice_number,
          docDate: inv.invoice_date,
          total, paid, outstanding, daysOverdue: Math.max(0, days),
        });
      }
      arRows.sort((a, b) => b.daysOverdue - a.daysOverdue);
      setAR(arRows);

      // === Supplier Aging (AP) — per shipment, FIFO allocation of contact payments ===
      const { data: shipments } = await supabase.from("shipments")
        .select("id,shipment_number,invoice_date,total_cost,contact_id,contacts(name)")
        .eq("tenant_id", tenantId)
        .lte("invoice_date", getCairoDayBounds(undefined, asOf).endIso!);
      // group shipments by contact, sort oldest first
      const byContact = new Map<string, any[]>();
      for (const s of shipments ?? []) {
        const arr = byContact.get(s.contact_id) || [];
        arr.push(s);
        byContact.set(s.contact_id, arr);
      }
      // Fetch supplier payments per contact
      const contactIds = Array.from(byContact.keys());
      const paidByContact = new Map<string, number>();
      if (contactIds.length) {
        const { data: sp } = await supabase.from("supplier_payments")
          .select("contact_id,amount,paid_at")
          .in("contact_id", contactIds)
          .lte("paid_at", getCairoDayBounds(undefined, asOf).endIso!);
        for (const p of sp ?? []) {
          paidByContact.set(p.contact_id, (paidByContact.get(p.contact_id) || 0) + Number(p.amount || 0));
        }
      }
      const apRows: Row[] = [];
      for (const [cid, list] of byContact) {
        list.sort((a, b) => new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime());
        let remainingPaid = paidByContact.get(cid) || 0;
        for (const s of list) {
          const total = Number(s.total_cost || 0);
          const applied = Math.min(remainingPaid, total);
          remainingPaid -= applied;
          const outstanding = total - applied;
          if (outstanding <= 0.005) continue;
          const days = Math.floor((asOfDate.getTime() - new Date(s.invoice_date).getTime()) / 86400000);
          apRows.push({
            id: s.id,
            contactName: (s as any).contacts?.name || "-",
            docNumber: s.shipment_number,
            docDate: s.invoice_date,
            total, paid: applied, outstanding, daysOverdue: Math.max(0, days),
          });
        }
      }
      apRows.sort((a, b) => b.daysOverdue - a.daysOverdue);
      setAP(apRows);
      setLoading(false);
    })();
  }, [tenantId, asOf]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const filterRows = (rows: Row[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.contactName.toLowerCase().includes(q) || r.docNumber.toLowerCase().includes(q)
    );
  };

  const summary = (rows: Row[]) => {
    const buckets: Record<Bucket, number> = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0 };
    let total = 0;
    for (const r of rows) {
      buckets[bucketOf(r.daysOverdue)] += r.outstanding;
      total += r.outstanding;
    }
    return { buckets, total };
  };

  const arSum = useMemo(() => summary(ar), [ar]);
  const apSum = useMemo(() => summary(ap), [ap]);

  const BucketCards = ({ s }: { s: ReturnType<typeof summary> }) => (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
      {(Object.keys(bucketLabels) as Bucket[]).map(b => (
        <div key={b} className={`p-3 rounded-lg border ${b === "b90plus" ? "bg-destructive/10 border-destructive/30" : b === "b90" ? "bg-warning/10 border-warning/30" : "bg-muted/40"}`}>
          <div className="text-xs text-muted-foreground">{bucketLabels[b]}</div>
          <div className="text-lg font-bold font-mono">{fmt(s.buckets[b])}</div>
        </div>
      ))}
      <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
        <div className="text-xs text-muted-foreground">الإجمالي</div>
        <div className="text-lg font-bold font-mono">{fmt(s.total)}</div>
      </div>
    </div>
  );

  const RowsTable = ({ rows }: { rows: Row[] }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">الجهة</TableHead>
          <TableHead className="text-right">رقم المستند</TableHead>
          <TableHead className="text-right">التاريخ</TableHead>
          <TableHead className="text-right">الإجمالي</TableHead>
          <TableHead className="text-right">المدفوع</TableHead>
          <TableHead className="text-right">المتبقي</TableHead>
          <TableHead className="text-right">الأيام</TableHead>
          <TableHead className="text-right">الشريحة</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">لا يوجد رصيد مستحق</TableCell></TableRow>
        )}
        {rows.map(r => {
          const b = bucketOf(r.daysOverdue);
          return (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.contactName}</TableCell>
              <TableCell className="font-mono">{r.docNumber}</TableCell>
              <TableCell>{r.docDate}</TableCell>
              <TableCell className="font-mono">{fmt(r.total)}</TableCell>
              <TableCell className="font-mono">{fmt(r.paid)}</TableCell>
              <TableCell className="font-mono font-bold">{fmt(r.outstanding)}</TableCell>
              <TableCell>
                <span className={r.daysOverdue > 90 ? "text-destructive font-bold" : r.daysOverdue > 60 ? "text-warning font-semibold" : ""}>
                  {r.daysOverdue}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={
                  b === "b90plus" ? "bg-destructive/15 text-destructive border-destructive/30"
                  : b === "b90" ? "bg-warning/15 text-warning border-warning/30"
                  : b === "current" ? "bg-green-500/15 text-green-600 border-green-500/30"
                  : ""
                }>{bucketLabels[b]}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title={fin("aging")} subtitle={`${fin("receivables")} على العملاء و${fin("payables")} للموردين حسب فترات التأخير`} />

        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">كما في تاريخ</label>
              <Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="w-44" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm text-muted-foreground block mb-1">بحث (اسم / رقم مستند)</label>
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث..." />
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="ar">
          <TabsList className="w-full grid grid-cols-2 h-12">
            <TabsTrigger value="ar" className="text-base"><Users className="w-4 h-4 ml-2" />ذمم العملاء (مدينة)</TabsTrigger>
            <TabsTrigger value="ap" className="text-base"><Truck className="w-4 h-4 ml-2" />ذمم الموردين (دائنة)</TabsTrigger>
          </TabsList>

          <TabsContent value="ar" className="space-y-4 mt-4">
            <BucketCards s={arSum} />
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5" /> مستحق على العملاء
                {arSum.buckets.b90plus > 0 && <Badge variant="destructive" className="mr-2"><AlertTriangle className="w-3 h-3 ml-1" />متأخرات حرجة</Badge>}
              </CardTitle></CardHeader>
              <CardContent>
                {loading ? <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div> : <RowsTable rows={filterRows(ar)} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ap" className="space-y-4 mt-4">
            <BucketCards s={apSum} />
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2">
                <Truck className="w-5 h-5" /> مستحق للموردين
                {apSum.buckets.b90plus > 0 && <Badge variant="destructive" className="mr-2"><AlertTriangle className="w-3 h-3 ml-1" />متأخرات حرجة</Badge>}
              </CardTitle></CardHeader>
              <CardContent>
                {loading ? <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div> : <RowsTable rows={filterRows(ap)} />}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
