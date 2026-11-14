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
import { formatDate, formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { rpcErrorText } from "@/lib/rpcError";
import { InternalBranchBadge } from "@/components/contact/InternalBranchBadge";
import { ArrowDownLeft, ArrowUpRight, AlertTriangle } from "lucide-react";

/**
 * «أعمار الديون» per ACCOUNT (owner 2026-11-14 «يعرض رصيد كل حساب مدين، وبقاله قد إيه مدين», migration 0207):
 * every account's ONE balance (current account, like the contacts list) and how long it has been مدين / دائن without
 * a break — no open invoices. `contacts_balance_age(branch, as_of)`: + = مدين (لنا عنده), − = دائن (علينا له).
 */
type Row = {
  contact_id: string; account_no: number | null; contact_name: string; contact_type: string;
  balance: number; since: string | null; days: number | null; last_money: string | null; last_move: string | null;
};
const BUCKETS = [
  { key: "b0", label: "0-30 يوم", from: 0, to: 30, tone: "bg-muted/40" },
  { key: "b1", label: "31-60 يوم", from: 31, to: 60, tone: "bg-muted/40" },
  { key: "b2", label: "61-90 يوم", from: 61, to: 90, tone: "bg-muted/40" },
  { key: "b3", label: "91-120 يوم", from: 91, to: 120, tone: "bg-warning/10 border-warning/30" },
  { key: "b4", label: "أكثر من 120", from: 121, to: Infinity, tone: "bg-destructive/10 border-destructive/30" },
] as const;
const bucketOf = (days: number | null) => BUCKETS.find((b) => (days ?? 0) >= b.from && (days ?? 0) <= b.to) ?? BUCKETS[0];
const TYPE: Record<string, string> = { customer: "عميل", supplier: "مورد", both: "عميل ومورد" };

export default function AgingReport() {
  const { tenantId } = useAuth();
  const nav = useNavigate();
  const [branchId, setBranchId] = useState("all");
  const [asOf, setAsOf] = useState("");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("branches").select("id, name, is_system").eq("is_active", true).order("name")
      .then(({ data }) => setBranches(((data ?? []) as any[]).filter((b) => !b.is_system)));
  }, [tenantId]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(null);
    const day = asOf && asOf < cairoTodayDay() ? asOf : null;
    const { data, error } = await (supabase.rpc as any)("contacts_balance_age", { p_branch_id: branchId === "all" ? null : branchId, p_as_of: day });
    if (error) { setRows([]); setLoadError(rpcErrorText(error)); }
    else setRows(((data ?? []) as any[]).map((r) => ({ ...r, balance: Number(r.balance) || 0, days: r.days == null ? null : Number(r.days) })));
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId, branchId, asOf]);
  useRealtimeRefresh(["invoices", "invoice_payments", "shipments", "supplier_payments", "returns", "purchase_returns", "vouchers", "payment_transactions"], load);

  const Section = ({ kind }: { kind: "debit" | "credit" }) => {
    const isD = kind === "debit";
    const q = search.trim().toLowerCase();
    const all = rows.filter((r) => (isD ? r.balance > 0 : r.balance < 0) && (!q || r.contact_name.toLowerCase().includes(q)));
    const list = bucket ? all.filter((r) => bucketOf(r.days).key === bucket) : all;
    const sums = Object.fromEntries(BUCKETS.map((b) => [b.key, all.filter((r) => bucketOf(r.days).key === b.key).reduce((s, r) => s + Math.abs(r.balance), 0)]));
    const total = all.reduce((s, r) => s + Math.abs(r.balance), 0);
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {BUCKETS.map((b) => (
            <button type="button" key={b.key} onClick={() => setBucket(bucket === b.key ? null : b.key)}
              className={`p-3 rounded-lg border text-right ${b.tone} ${bucket === b.key ? "ring-2 ring-primary" : ""}`}>
              <div className="text-xs text-muted-foreground">{isD ? "مدين من" : "دائن من"} {b.label}</div>
              <div className="text-lg font-bold tabular-nums">{formatEGP(sums[b.key])}</div>
            </button>
          ))}
          <div className={`p-3 rounded-lg border ${isD ? "bg-success/10 border-success/30" : "bg-destructive/10 border-destructive/30"}`}>
            <div className="text-xs text-muted-foreground">{isD ? "إجمالي المدين (لنا)" : "إجمالي الدائن (علينا)"}</div>
            <div className={`text-lg font-bold tabular-nums ${isD ? "text-success" : "text-destructive"}`}>{formatEGP(total)}</div>
            <div className="text-[11px] text-muted-foreground">{all.length} حساب</div>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2">
            {isD ? <ArrowDownLeft className="w-5 h-5 text-success" /> : <ArrowUpRight className="w-5 h-5 text-destructive" />}
            {isD ? "حسابات مدينة — لنا عندهم" : "حسابات دائنة — علينا ليهم"}
            {sums.b4 > 0 && <Badge variant="destructive" className="mr-2"><AlertTriangle className="w-3 h-3 ml-1" />أكثر من 120 يوم</Badge>}
          </CardTitle></CardHeader>
          <CardContent>
            {loading ? <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">رقم الحساب</TableHead>
                    <TableHead className="text-right">اسم الحساب</TableHead>
                    <TableHead className="text-right">طبيعة الحساب</TableHead>
                    <TableHead className="text-right">الرصيد</TableHead>
                    <TableHead className="text-right">{isD ? "مدين من يوم" : "دائن من يوم"}</TableHead>
                    <TableHead className="text-right">بقاله (يوم)</TableHead>
                    <TableHead className="text-right">{isD ? "آخر تحصيل / فلوس" : "آخر سداد / فلوس"}</TableHead>
                    <TableHead className="text-right">آخر حركة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">مفيش حسابات</TableCell></TableRow>}
                  {list.map((r) => (
                    <TableRow key={r.contact_id} className="cursor-pointer hover:bg-muted/40" onClick={() => nav(`/admin/contacts/${r.contact_id}`)}>
                      <TableCell className="tabular-nums">{r.account_no ?? "—"}</TableCell>
                      <TableCell className="font-medium">{r.contact_name}<InternalBranchBadge id={r.contact_id} /></TableCell>
                      <TableCell>{TYPE[r.contact_type] ?? r.contact_type}</TableCell>
                      <TableCell className={`tabular-nums font-bold ${isD ? "text-success" : "text-destructive"}`}>{formatEGP(Math.abs(r.balance))} {isD ? "مدين" : "دائن"}</TableCell>
                      <TableCell>{r.since ? formatDate(r.since) : "—"}</TableCell>
                      <TableCell className={`tabular-nums ${(r.days ?? 0) > 120 ? "text-destructive font-bold" : (r.days ?? 0) > 90 ? "text-warning font-semibold" : ""}`}>{r.days ?? "—"}</TableCell>
                      <TableCell>{r.last_money ? formatDate(r.last_money) : "—"}</TableCell>
                      <TableCell>{r.last_move ? formatDate(r.last_move) : "—"}</TableCell>
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
        <PageHeader title={fin("aging")} subtitle={`رصيد كل حساب وبقاله قد إيه مدين أو دائن — ${asOf && asOf < cairoTodayDay() ? "حتى " + formatDate(asOf) : "النهارده"} — ${branchLabel}`} />

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
              الرصيد = الحساب الجاري (نفس رصيد صفحة العملاء والموردين). «بقاله» = من آخر مرة الرصيد اتقلب أو اتصفّر لحد التاريخ ده. اضغط على كارت المدة عشان تفلتر بيه.
            </p>
          </CardContent>
        </Card>

        {loadError && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">تعذر تحميل التقرير: {loadError}</div>}

        <Tabs defaultValue="debit" onValueChange={() => setBucket(null)}>
          <TabsList className="w-full grid grid-cols-2 h-12">
            <TabsTrigger value="debit" className="text-base"><ArrowDownLeft className="w-4 h-4 ml-2" />مدين — لنا</TabsTrigger>
            <TabsTrigger value="credit" className="text-base"><ArrowUpRight className="w-4 h-4 ml-2" />دائن — علينا</TabsTrigger>
          </TabsList>
          <TabsContent value="debit" className="mt-4"><Section kind="debit" /></TabsContent>
          <TabsContent value="credit" className="mt-4"><Section kind="credit" /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
