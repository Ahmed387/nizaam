import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { fin } from "@/lib/financeTerms";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { fetchAging, type AgingRow, type Side } from "@/lib/ledger";
import { formatDate } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { Users, Truck, AlertTriangle } from "lucide-react";

/**
 * Aging of what is still open today, from the unified ledger (Step 6C): every open sale / purchase
 * invoice and opening debt by its date, after payments, deposits (FIFO, any branch) and return credit.
 * Customers and suppliers are two separate reports; advances are shown apart and never netted.
 */
const fmt = (n: number) => (Number(n) || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BUCKETS: { key: keyof AgingRow; label: string; tone: string }[] = [
  { key: "d0_30", label: "0-30 يوم", tone: "bg-muted/40" },
  { key: "d31_60", label: "31-60 يوم", tone: "bg-muted/40" },
  { key: "d61_90", label: "61-90 يوم", tone: "bg-muted/40" },
  { key: "d91_120", label: "91-120 يوم", tone: "bg-warning/10 border-warning/30" },
  { key: "d120_plus", label: "أكثر من 120", tone: "bg-destructive/10 border-destructive/30" },
];

export default function AgingReport() {
  const { tenantId } = useAuth();
  const nav = useNavigate();
  const [branchId, setBranchId] = useState("all");
  // as of a past day: what was open that day (the ledger rule replayed with the money and documents up to it)
  const [asOf, setAsOf] = useState("");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<Record<Side, AgingRow[]>>({ customer: [], supplier: [] });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).order("name").then(({ data }) => setBranches((data ?? []) as any));
  }, [tenantId]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const b = branchId === "all" ? null : branchId;
      const day = asOf && asOf < cairoTodayDay() ? asOf : null;
      const [c, s] = await Promise.all([fetchAging("customer", b, day), fetchAging("supplier", b, day)]);
      setRows({ customer: c, supplier: s });
    } catch (e: any) {
      setRows({ customer: [], supplier: [] });
      setLoadError(e?.message ?? "تعذر تحميل التقرير");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId, branchId, asOf]);
  useRealtimeRefresh(["invoices", "invoice_payments", "shipments", "supplier_payments", "returns", "purchase_returns", "vouchers", "payment_transactions"], load);

  const filterRows = (list: AgingRow[]) => {
    const q = search.trim().toLowerCase();
    return (q ? list.filter((r) => r.contact_name.toLowerCase().includes(q)) : list).sort((a, b) => b.total_open - a.total_open);
  };
  const sum = (list: AgingRow[]) => {
    const out: Record<string, number> = { total_open: 0, advance: 0 };
    for (const b of BUCKETS) out[b.key as string] = 0;
    for (const r of list) {
      for (const b of BUCKETS) out[b.key as string] += Number(r[b.key]) || 0;
      out.total_open += r.total_open;
      out.advance += r.advance;
    }
    Object.keys(out).forEach((k) => { out[k] = Math.round(out[k] * 100) / 100; });
    return out;
  };

  const Section = ({ side }: { side: Side }) => {
    const list = filterRows(rows[side]);
    const s = sum(list);
    const isC = side === "customer";
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
          {BUCKETS.map((b) => (
            <div key={b.key as string} className={`p-3 rounded-lg border ${b.tone}`}>
              <div className="text-xs text-muted-foreground">{b.label}</div>
              <div className="text-lg font-bold font-mono">{fmt(s[b.key as string])}</div>
            </div>
          ))}
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
            <div className="text-xs text-muted-foreground">إجمالي المفتوح</div>
            <div className="text-lg font-bold font-mono">{fmt(s.total_open)}</div>
          </div>
          <div className="p-3 rounded-lg border">
            <div className="text-xs text-muted-foreground">{isC ? "مقدمات عملاء (منفصلة)" : "مقدماتنا عند الموردين (منفصلة)"}</div>
            <div className="text-lg font-bold font-mono">{fmt(s.advance)}</div>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2">
            {isC ? <Users className="w-5 h-5" /> : <Truck className="w-5 h-5" />} {isC ? "مستحق على العملاء" : "مستحق للموردين"}
            {s.d120_plus > 0 && <Badge variant="destructive" className="mr-2"><AlertTriangle className="w-3 h-3 ml-1" />متأخرات حرجة</Badge>}
          </CardTitle></CardHeader>
          <CardContent>
            {loading ? <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الجهة</TableHead>
                    {BUCKETS.map((b) => <TableHead key={b.key as string} className="text-right">{b.label}</TableHead>)}
                    <TableHead className="text-right">إجمالي المفتوح</TableHead>
                    <TableHead className="text-right">مقدم</TableHead>
                    <TableHead className="text-right">أقدم مستند</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">لا يوجد رصيد مستحق</TableCell></TableRow>}
                  {list.map((r) => (
                    <TableRow key={r.contact_id} className="cursor-pointer hover:bg-muted/40" onClick={() => nav(`/admin/contacts/${r.contact_id}`)}>
                      <TableCell className="font-medium">{r.contact_name}</TableCell>
                      {BUCKETS.map((b) => (
                        <TableCell key={b.key as string} className={`font-mono ${b.key === "d120_plus" && Number(r[b.key]) > 0 ? "text-destructive font-bold" : ""}`}>{fmt(Number(r[b.key]))}</TableCell>
                      ))}
                      <TableCell className="font-mono font-bold">{fmt(r.total_open)}</TableCell>
                      <TableCell className="font-mono">{r.advance > 0.005 ? fmt(r.advance) : "—"}</TableCell>
                      <TableCell>{r.oldest_date ? formatDate(r.oldest_date) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const branchLabel = useMemo(() => (branchId === "all" ? "كل الفروع" : branches.find((b) => b.id === branchId)?.name ?? ""), [branchId, branches]);

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title={fin("aging")} subtitle={`${fin("receivables")} على العملاء و${fin("payables")} للموردين حسب عمر المستند — ${asOf && asOf < cairoTodayDay() ? "حتى " + formatDate(asOf) : "النهارده"} — ${branchLabel}`} />

        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">الفرع</label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفروع</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">حتى تاريخ</label>
              <Input type="date" className="w-44" value={asOf} max={cairoTodayDay()} onChange={(e) => setAsOf(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm text-muted-foreground block mb-1">بحث بالاسم</label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث..." />
            </div>
            <p className="text-xs text-muted-foreground w-full">
              المتبقي محسوب من الدفتر الموحد بعد كل المدفوعات (الأقدم أولاً، من أي فرع) ورصيد المرتجعات. العملاء والموردين تقريرين منفصلين.
            </p>
          </CardContent>
        </Card>

        {loadError && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">تعذر تحميل التقرير: {loadError}</div>}

        <Tabs defaultValue="ar">
          <TabsList className="w-full grid grid-cols-2 h-12">
            <TabsTrigger value="ar" className="text-base"><Users className="w-4 h-4 ml-2" />ذمم العملاء (مدينة)</TabsTrigger>
            <TabsTrigger value="ap" className="text-base"><Truck className="w-4 h-4 ml-2" />ذمم الموردين (دائنة)</TabsTrigger>
          </TabsList>
          <TabsContent value="ar" className="mt-4"><Section side="customer" /></TabsContent>
          <TabsContent value="ap" className="mt-4"><Section side="supplier" /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
