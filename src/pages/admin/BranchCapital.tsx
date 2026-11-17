import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Building2, PlusCircle, TrendingUp, TrendingDown, Wallet, Package, Users, PieChart } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useBranchScope } from "@/lib/branchScope";
import { FinancialAmount } from "@/components/FinancialAmount";
import { CapitalMoveDialog, type CapitalMode } from "@/components/capital/CapitalMoveDialog";
import { capitalKindLabel } from "@/lib/branchCapital";
import { loadAllPaymentMethods } from "@/lib/paymentMethods";

type Branch = { id: string; name: string; code: string };
type Allocation = { id: string; branch_id: string; from_branch_id: string | null; kind: string; payment_method: string | null;
  from_account: string | null; to_account: string | null; amount: number; allocation_date: string; notes: string | null; created_at: string };
type Position = {
  branch_id: string;
  allocated_capital: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  net_profit: number;
  receivables: number;
  payables: number;
  inventory_value: number;
  treasury_cash: number;
  total_assets: number;
  roi_pct: number | null;
};

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

export default function BranchCapital() {
  const { tenantId } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const { filterBranches } = useBranchScope();
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<CapitalMode | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [methodLabels, setMethodLabels] = useState<Record<string, string>>({});

  // خزينة الشركاء = فرع النظام PARTNER-CASH (المصدر / الوجهة لحركات رأس المال)
  const loadPartnerId = async () => {
    if (!tenantId) return;
    const { data: pb } = await (supabase.from("branches") as any)
      .select("id").eq("tenant_id", tenantId).eq("code", "PARTNER-CASH").maybeSingle();
    setPartnerId(pb?.id ?? null);
  };

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: br }, { data: al }] = await Promise.all([
      (supabase.from("branches") as any).select("id,name,code").eq("tenant_id", tenantId).eq("is_active", true).eq("is_system", false).order("code"),
      supabase.from("branch_capital_allocations" as any).select("*").eq("tenant_id", tenantId).order("allocation_date", { ascending: false }),
    ]);
    const brs = (br ?? []) as Branch[];
    setBranches(filterBranches((brs) as any) as any);
    setAllocations((al ?? []) as any);
    loadPartnerId();
    loadAllPaymentMethods().then((m) => setMethodLabels(Object.fromEntries(m.map((x) => [x.value, x.label])))).catch(() => {});

    // load positions in parallel
    const results = await Promise.all(
      brs.map(async (b) => {
        const { data } = await supabase.rpc("get_branch_financial_position" as any, { _branch_id: b.id });
        return [b.id, data as Position] as const;
      })
    );
    setPositions(Object.fromEntries(results));
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);


  const totalAllocated = Object.values(positions).reduce((s, p) => s + Number(p?.allocated_capital || 0), 0);
  const totalNetProfit = Object.values(positions).reduce((s, p) => s + Number(p?.net_profit || 0), 0);
  const totalAssets = Object.values(positions).reduce((s, p) => s + Number(p?.total_assets || 0), 0);

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader
          title="توزيع رأس المال على الفروع"
          subtitle="تخصيص رأس المال والمركز المالي لكل فرع"
          actions={
            <div className="flex gap-2">
              <Button className="btn-gradient" onClick={() => setMode("allocate")}>
                <PlusCircle className="w-4 h-4 ml-1" /> تحويل رأس مال لفرع
              </Button>
              <Button variant="outline" onClick={() => setMode("out")}>رجّع / انقل رأس مال</Button>
            </div>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي رأس المال في الفروع</CardTitle>
              <Wallet className="w-5 h-5 text-primary" />
            </CardHeader>
             <CardContent><FinancialAmount value={fmt(totalAllocated)} size="lg" className="justify-start" /></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">صافي أرباح الفروع</CardTitle>
              <TrendingUp className={`w-5 h-5 ${totalNetProfit >= 0 ? "text-success" : "text-destructive"}`} />
            </CardHeader>
            <CardContent>
               <FinancialAmount value={fmt(totalNetProfit)} size="lg" className={`justify-start ${totalNetProfit >= 0 ? "text-success" : "text-destructive"}`} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي أصول الفروع</CardTitle>
              <PieChart className="w-5 h-5 text-primary" />
            </CardHeader>
             <CardContent><FinancialAmount value={fmt(totalAssets)} size="lg" className="justify-start" /></CardContent>
          </Card>
        </div>

        <Tabs defaultValue="positions">
          <TabsList>
            <TabsTrigger value="positions">المركز المالي للفروع</TabsTrigger>
            <TabsTrigger value="history">حركات رأس المال</TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="space-y-4 mt-4">
            {loading && <div className="text-center text-muted-foreground py-8">جاري التحميل...</div>}
            {!loading && branches.length === 0 && (
              <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد فروع نشطة</CardContent></Card>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {branches.map((b) => {
                const p = positions[b.id];
                if (!p) return null;
                const roi = p.roi_pct;
                return (
                  <Card key={b.id} className="border-2">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Building2 className="w-5 h-5 text-primary" />
                          {b.name} <span className="text-xs text-muted-foreground font-mono">({b.code})</span>
                        </CardTitle>
                        {roi !== null && (
                          <span className={`text-sm font-bold px-2 py-1 rounded ${roi >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                            ROI: {roi}%
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <Row label="رأس المال الحالي (دخل − طلع)" value={p.allocated_capital} icon={<Wallet className="w-4 h-4 text-primary" />} highlight />
                      <hr className="my-2" />
                      <Row label="اللي اتباع (صافي المبيعات)" value={p.revenue} icon={<TrendingUp className="w-4 h-4 text-success" />} />
                      <Row label="تكلفة اللي اتباع" value={-p.cogs} icon={<Package className="w-4 h-4 text-muted-foreground" />} />
                      <Row label="مجمل الربح" value={p.gross_profit} bold />
                      <Row label="المصروفات التشغيلية" value={-p.expenses} icon={<TrendingDown className="w-4 h-4 text-destructive" />} />
                      <Row label="صافي الربح" value={p.net_profit} bold className={p.net_profit >= 0 ? "text-success" : "text-destructive"} />
                      <hr className="my-2" />
                      <Row label="الكاش في الخزنة" value={p.treasury_cash} />
                      <Row label="البضاعة المتاحة (بمتوسط التكلفة)" value={p.inventory_value} />
                      <Row label="إجمالي المدين (لنا)" value={p.receivables} />
                      <Row label="إجمالي الدائن (علينا)" value={p.payables} className="text-warning" />
                      <hr className="my-2" />
                      <Row label="إجمالي الأصول التشغيلية" value={p.total_assets} bold highlight />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader><CardTitle>حركات رأس المال</CardTitle></CardHeader>
              <CardContent>
                {allocations.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">مفيش حركات رأس مال لسه</div>
                ) : (
                  <div className="space-y-2">
                    {allocations.map((a) => {
                      const place = (id: string | null) => (!id || id === partnerId ? "خزينة الشركاء" : branches.find((b) => b.id === id)?.name ?? "—");
                      return (
                        <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30">
                          <div className="flex items-center gap-3 min-w-0">
                            <Building2 className="w-4 h-4 text-primary shrink-0" />
                            <div className="min-w-0">
                              <div className="font-semibold">
                                {capitalKindLabel(a.kind)}: {place(a.from_branch_id)} ← {place(a.branch_id)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatDate(a.allocation_date)} · {methodLabels[a.payment_method || "cash"] ?? a.payment_method ?? "نقدي"}
                                {a.from_account && <> · من <span dir="ltr">{a.from_account}</span></>}
                                {a.to_account && <> · على <span dir="ltr">{a.to_account}</span></>}
                                {" · "}{a.notes || "بدون ملاحظات"}
                              </div>
                            </div>
                          </div>
                          <div className="text-lg font-bold tabular-nums shrink-0">{fmt(a.amount)} ج.م</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <CapitalMoveDialog mode={mode ?? "allocate"} open={mode !== null} onClose={() => setMode(null)} onDone={load}
                           branches={branches} partnerId={partnerId} rows={allocations as any} />
      </div>
    </AdminLayout>
  );
}

function Row({ label, value, icon, bold, highlight, className }: { label: string; value: number; icon?: React.ReactNode; bold?: boolean; highlight?: boolean; className?: string }) {
  return (
    <div className={`flex items-center justify-between ${highlight ? "bg-primary/5 rounded px-2 py-1" : ""} ${className || ""}`}>
      <span className={`flex items-center gap-2 ${bold ? "font-semibold" : "text-muted-foreground"}`}>
        {icon}{label}
      </span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""}`} dir="ltr">{fmt(value)}</span>
    </div>
  );
}
