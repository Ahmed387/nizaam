import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Calculator, PieChart, TrendingUp, Wallet, Loader2, Undo2, History } from "lucide-react";

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

type PartnerRow = {
  partner_id: string;
  name: string;
  share_pct: number;
  gross: number;
  advance_offset: number;
  net_payable: number;
  outstanding_advances: number;
};

type Preview = {
  net_profit: { revenue: number; expense: number; net_profit: number; from: string; to: string };
  distributable: number;
  partners: PartnerRow[];
};

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

export default function FlexibleDistribution() {
  const { tenantId } = useAuth();
  const [fromDate, setFromDate] = useState(monthAgo());
  const [toDate, setToDate] = useState(today());
  const [customAmount, setCustomAmount] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [partnersBalances, setPartnersBalances] = useState<{ id: string; name: string; current_balance: number }[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [reversing, setReversing] = useState<string | null>(null);

  const loadBalances = async () => {
    if (!tenantId) return;
    const [{ data: partners }, { data: balances }] = await Promise.all([
      supabase.from("equity_partners").select("id,name").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
      supabase.from("v_partner_balances" as any).select("partner_id,current_balance").eq("tenant_id", tenantId),
    ]);
    const balMap = new Map<string, number>();
    (balances ?? []).forEach((b: any) => balMap.set(b.partner_id, Number(b.current_balance) || 0));
    setPartnersBalances(((partners ?? []) as any[]).map((p: any) => ({
      id: p.id, name: p.name, current_balance: balMap.get(p.id) ?? 0,
    })));
  };
  const loadRecent = async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("profit_distributions")
      .select("id,distribution_date,total_amount,status,notes,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(10);
    setRecent((data as any) ?? []);
  };
  useEffect(() => {
    loadBalances();
    loadRecent();
  }, [tenantId]);

  const doReverse = async (id: string) => {
    const reason = window.prompt("سبب عكس التوزيع؟", "تصحيح");
    if (reason === null) return;
    if (!confirm("سيتم عكس القيد المحاسبي، إرجاع أرصدة الشركاء، وإلغاء خصم السلف. متأكد؟")) return;
    setReversing(id);
    const { error } = await supabase.rpc("reverse_profit_distribution" as any, {
      p_tenant_id: tenantId,
      p_distribution_id: id,
      p_reason: reason || "Reversal",
    });
    setReversing(null);
    if (error) return toast.error(error.message);
    toast.success("تم عكس التوزيع بنجاح");
    loadBalances();
    loadRecent();
  };

  const computePreview = async () => {
    if (!tenantId) return;
    setLoading(true);
    const amt = customAmount ? Number(customAmount) : null;
    const { data, error } = await supabase.rpc("preview_flexible_distribution" as any, {
      p_tenant_id: tenantId,
      p_from: fromDate,
      p_to: toDate,
      p_amount: amt,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPreview(data as Preview);
  };

  const doDistribute = async () => {
    if (!tenantId || !preview) return;
    if (preview.distributable <= 0) {
      toast.error("لا يوجد ربح للتوزيع");
      return;
    }
    if (
      !confirm(
        `تأكيد توزيع ${fmt(preview.distributable)} ج.م على الشركاء؟\nالسلف المستحقة هتتخصم تلقائياً.`
      )
    )
      return;
    setDistributing(true);
    const { error } = await supabase.rpc("distribute_profits" as any, {
      p_tenant_id: tenantId,
      p_fiscal_period_id: null,
      p_total_amount: preview.distributable,
      p_distribution_date: toDate,
      p_notes: notes || `توزيع مرن للفترة ${fromDate} → ${toDate}`,
    });
    setDistributing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("تم التوزيع — القيود اتسجّلت في دفتر الأستاذ");
    setPreview(null);
    setNotes("");
    setCustomAmount("");
    loadBalances();
    loadRecent();
  };

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader
          title="توزيع أرباح مرن"
          subtitle="اختر أي فترة، النظام يحسب صافي الربح من دفتر الأستاذ ويوزع حسب النسب"
        />

        {/* Current Balances */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              الأرصدة الحالية للشركاء (مستحقات التوزيع)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {partnersBalances.map((p) => (
                <div
                  key={p.id}
                  className="border rounded-lg p-4 flex items-center justify-between bg-gradient-to-l from-primary/5 to-transparent"
                >
                  <div>
                    <div className="text-sm text-muted-foreground">{p.name}</div>
                    <div className="text-2xl font-bold">{fmt(p.current_balance)} ج.م</div>
                  </div>
                  <Badge variant={Number(p.current_balance) > 0 ? "default" : "outline"}>
                    {Number(p.current_balance) > 0 ? "قابل للسحب" : "بدون رصيد"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Period Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-primary" />
              1. اختر الفترة واحسب صافي الربح
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label>من تاريخ</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <Label>إلى تاريخ</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div>
                <Label>مبلغ مخصص (اختياري)</Label>
                <Input
                  type="number"
                  placeholder="اتركه فاضي = صافي الربح كامل"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={computePreview} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "احسب المعاينة"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
              {[
                { label: "الشهر الحالي", from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), to: today() },
                { label: "آخر 30 يوم", from: monthAgo(), to: today() },
                { label: "الربع الحالي", from: new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1).toISOString().slice(0, 10), to: today() },
                { label: "السنة الحالية", from: `${new Date().getFullYear()}-01-01`, to: today() },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFromDate(preset.from);
                    setToDate(preset.to);
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        {preview && (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="w-5 h-5 text-primary" />
                2. معاينة التوزيع
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border rounded-lg p-4 bg-success/5">
                  <div className="text-xs text-muted-foreground">إيرادات الفترة</div>
                  <div className="text-xl font-bold text-success">
                    {fmt(preview.net_profit.revenue)} ج.م
                  </div>
                </div>
                <div className="border rounded-lg p-4 bg-destructive/5">
                  <div className="text-xs text-muted-foreground">مصروفات الفترة</div>
                  <div className="text-xl font-bold text-destructive">
                    {fmt(preview.net_profit.expense)} ج.م
                  </div>
                </div>
                <div className="border rounded-lg p-4 bg-primary/10">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> صافي الربح
                  </div>
                  <div className="text-2xl font-bold text-primary">
                    {fmt(preview.net_profit.net_profit)} ج.م
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-3 bg-muted/30">
                <div className="font-semibold mb-2">توزيع {fmt(preview.distributable)} ج.م على الشركاء</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الشريك</TableHead>
                      <TableHead className="text-right">النسبة</TableHead>
                      <TableHead className="text-right">النصيب (إجمالي)</TableHead>
                      <TableHead className="text-right">سلف مستحقة</TableHead>
                      <TableHead className="text-right">هيتخصم من السلف</TableHead>
                      <TableHead className="text-right">صافي للرصيد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.partners.map((p) => (
                      <TableRow key={p.partner_id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{Number(p.share_pct).toFixed(2)}%</TableCell>
                        <TableCell>{fmt(p.gross)}</TableCell>
                        <TableCell className={Number(p.outstanding_advances) > 0 ? "text-warning" : ""}>
                          {fmt(p.outstanding_advances)}
                        </TableCell>
                        <TableCell className="text-warning">{fmt(p.advance_offset)}</TableCell>
                        <TableCell className="font-bold text-success">{fmt(p.net_payable)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <Label>ملاحظات على التوزيع</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={`توزيع مرن للفترة ${fromDate} → ${toDate}`}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setPreview(null)}>
                  إلغاء
                </Button>
                <Button
                  onClick={doDistribute}
                  disabled={distributing || preview.distributable <= 0}
                  className="bg-primary"
                >
                  {distributing ? (
                    <Loader2 className="w-4 h-4 animate-spin ml-1" />
                  ) : null}
                  تنفيذ التوزيع
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Distributions with Undo */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              آخر التوزيعات — عكس التوزيع (Undo)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">لا توجد توزيعات بعد.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-right">المبلغ</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">ملاحظات</TableHead>
                    <TableHead className="text-right">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.distribution_date}</TableCell>
                      <TableCell className="font-bold">{fmt(d.total_amount)} ج.م</TableCell>
                      <TableCell>
                        <Badge variant={d.status === "reversed" ? "destructive" : "default"}>
                          {d.status === "reversed" ? "معكوس" : d.status === "completed" ? "مكتمل" : d.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">{d.notes ?? "—"}</TableCell>
                      <TableCell>
                        {d.status !== "reversed" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => doReverse(d.id)}
                            disabled={reversing === d.id}
                            className="text-destructive hover:bg-destructive/10 gap-1"
                          >
                            {reversing === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                            عكس
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
