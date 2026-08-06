import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { fetchAllRows } from "@/lib/fetchAll";
import { fetchProfitWindow, rangeForDates } from "@/lib/profitEngine";
import { fin, allocateByShares } from "@/lib/financeTerms";
import {
  ShoppingCart, Package, TrendingUp, Receipt, Wallet, Users,
  Loader2, HandCoins, AlertTriangle,
} from "lucide-react";

/**
 * ملخص الأرباح الشهري — شاشة المالك.
 * بتحكي قصة الشهر بالعامية: بعنا بكام، جابناها بكام، صرفنا كام، كسبنا كام،
 * وإيه اللي فعلاً موجود كاش ينفع يتوزع على الشركاء.
 * كل الأرقام من نفس المحرك المالي (profitEngine) عشان ما تختلفش عن باقي التقارير.
 */

type PartnerRow = {
  id: string;
  name: string;
  capital: number;
  pct: number;
  profitShare: number;
  cashShare: number;
  advance: number;
  netCash: number;
};

const monthBounds = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(from), to: iso(to) };
};

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function MonthlyProfitSummary({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useAuth();
  const [mode, setMode] = useState<"month" | "custom">("month");
  const [month, setMonth] = useState(currentMonth());
  const [from, setFrom] = useState(() => monthBounds(currentMonth()).from);
  const [to, setTo] = useState(() => monthBounds(currentMonth()).to);
  const [loading, setLoading] = useState(true);

  const [revenue, setRevenue] = useState(0);
  const [cogs, setCogs] = useState(0);
  const [opex, setOpex] = useState(0);
  const [unpaidSales, setUnpaidSales] = useState(0);
  const [supplierDebt, setSupplierDebt] = useState(0);
  const [cashOnHand, setCashOnHand] = useState(0);
  const [partners, setPartners] = useState<PartnerRow[]>([]);

  const period = useMemo(
    () => (mode === "month" ? monthBounds(month) : { from, to }),
    [mode, month, from, to]
  );

  const gross = revenue - cogs;
  const net = gross - opex;
  const margin = revenue > 0 ? (net / revenue) * 100 : 0;
  const rawDistributable = net - unpaidSales - supplierDebt;
  const distributable = Math.max(0, Math.min(rawDistributable, Math.max(0, cashOnHand)));
  const cappedByCash = rawDistributable > 0 && distributable < rawDistributable;

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { from: f, to: t } = period;

    const [pw, invRows, contactsRes, treasuryRes, partnersRes, advRes] = await Promise.all([
      fetchProfitWindow({ tenantId, range: rangeForDates(f, t) }),
      fetchAllRows<any>(() =>
        supabase
          .from("invoices")
          .select("id,total,invoice_payments(amount,voided_at)")
          .eq("tenant_id", tenantId)
          .eq("status", "active")
          .gte("created_at", new Date(f + "T00:00:00").toISOString())
          .lte("created_at", new Date(t + "T23:59:59.999").toISOString())
      ),
      supabase.from("v_contact_balances" as any).select("type,total_balance"),
      supabase.from("treasury" as any).select("type,amount").eq("tenant_id", tenantId),
      supabase
        .from("equity_partners")
        .select("id,name,capital_share,initial_capital")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      supabase
        .from("partner_advances")
        .select("partner_id,remaining_amount,status")
        .eq("tenant_id", tenantId),
    ]);

    setRevenue(pw.totals.revenue);
    setCogs(pw.totals.cost);
    setOpex(pw.totals.expenses);

    // آجل الفترة: فواتير الفترة اللي لسه ماتحصلتش كاش
    let ar = 0;
    for (const inv of invRows ?? []) {
      const paid = (inv.invoice_payments ?? [])
        .filter((p: any) => !p.voided_at)
        .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
      ar += Math.max(0, Number(inv.total || 0) - paid);
    }
    setUnpaidSales(ar);

    // اللي علينا للموردين (رصيد قائم)
    let ap = 0;
    for (const c of ((contactsRes.data ?? []) as any[])) {
      const bal = Number(c.total_balance ?? 0);
      if (c.type === "supplier" && bal < 0) ap += Math.abs(bal);
    }
    setSupplierDebt(ap);

    const tr = (treasuryRes.data ?? []) as any[];
    setCashOnHand(
      tr.reduce((s, x) => s + (x.type === "income" ? 1 : -1) * Number(x.amount || 0), 0)
    );

    // أرصدة الشركاء الحقيقية (رأس المال المدفوع)
    const plist = (partnersRes.data ?? []) as any[];
    let balances = new Map<string, number>();
    if (plist.length) {
      const { data: bal } = await supabase
        .from("v_partner_balances" as any)
        .select("partner_id,total_contributions")
        .eq("tenant_id", tenantId);
      ((bal as any[]) ?? []).forEach((b) =>
        balances.set(b.partner_id, Number(b.total_contributions || 0))
      );
    }

    const advances = new Map<string, number>();
    for (const a of ((advRes.data ?? []) as any[])) {
      if (a.status === "cancelled" || a.status === "paid") continue;
      advances.set(a.partner_id, (advances.get(a.partner_id) || 0) + Number(a.remaining_amount || 0));
    }

    // أساس النسبة: فلوس الشريك في الخزينة الرئيسية ÷ إجمالي رأس المال.
    // لو مفيش مساهمات مسجلة بنرجع لنسبة capital_share المعرّفة على الشريك.
    const caps = plist.map(
      (p) => balances.get(p.id) ?? Number(p.initial_capital || 0) ?? 0
    );
    const capTotal = caps.reduce((s, x) => s + x, 0);
    const basis = capTotal > 0 ? caps : plist.map((p) => Number(p.capital_share || 0));
    const basisTotal = basis.reduce((s, x) => s + x, 0);

    const netAlloc = allocateByShares(net, basis);
    const cashAlloc = allocateByShares(distributableFor(net, ar, ap, tr), basis);

    setPartners(
      plist.map((p, i) => {
        const adv = advances.get(p.id) || 0;
        return {
          id: p.id,
          name: p.name,
          capital: caps[i],
          pct: basisTotal > 0 ? (basis[i] / basisTotal) * 100 : 0,
          profitShare: netAlloc[i] ?? 0,
          cashShare: cashAlloc[i] ?? 0,
          advance: adv,
          netCash: (cashAlloc[i] ?? 0) - adv,
        };
      })
    );
    setLoading(false);
  };

  // نفس معادلة الكاش المتاح بس محسوبة جوه load قبل ما الـ state تتحدث
  function distributableFor(n: number, ar: number, ap: number, tr: any[]) {
    const cash = tr.reduce(
      (s, x) => s + (x.type === "income" ? 1 : -1) * Number(x.amount || 0),
      0
    );
    return Math.max(0, Math.min(n - ar - ap, Math.max(0, cash)));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, period.from, period.to]);

  const Line = ({
    icon, term, hint, value, tone, big,
  }: {
    icon: React.ReactNode; term: string; hint: string; value: number;
    tone: "primary" | "destructive" | "success" | "muted"; big?: boolean;
  }) => {
    const toneCls =
      tone === "success" ? "text-success" :
      tone === "destructive" ? "text-destructive" :
      tone === "primary" ? "text-primary" : "text-foreground";
    return (
      <div
        className={`rounded-2xl border p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-3 justify-between ${
          big ? "bg-primary/5 border-primary/30" : "bg-card"
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-xl bg-muted flex items-center justify-center">{icon}</div>
          <div className="min-w-0">
            <div className={`font-bold ${big ? "text-lg" : "text-base"}`}>{term}</div>
            <div className="text-xs md:text-sm text-muted-foreground">{hint}</div>
          </div>
        </div>
        <div className={`font-extrabold tabular-nums ${big ? "text-3xl md:text-4xl" : "text-xl md:text-2xl"} ${toneCls}`}>
          {formatEGP(value)}
        </div>
      </div>
    );
  };

  const body = (
    <div dir="rtl" className="text-right space-y-6">
      {/* فلتر الفترة */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">الفترة</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-1">
            <Label className="text-xs">طريقة الاختيار</Label>
            <div className="flex gap-2 mt-1">
              <Button size="sm" variant={mode === "month" ? "default" : "outline"} onClick={() => setMode("month")}>
                شهر معيّن
              </Button>
              <Button size="sm" variant={mode === "custom" ? "default" : "outline"} onClick={() => setMode("custom")}>
                فترة مخصصة
              </Button>
            </div>
          </div>
          {mode === "month" ? (
            <div>
              <Label className="text-xs">الشهر</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">من</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">إلى</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <Badge variant="outline">من {period.from} لـ {period.to}</Badge>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>

      {/* قصة الشهر */}
      <div className="space-y-3">
        <Line
          icon={<ShoppingCart className="w-5 h-5 text-primary" />}
          term={fin("revenue")}
          hint="ده اللي الشركة باعته الفترة دي من كل الفروع — بعد خصم المرتجعات والخصومات"
          value={revenue}
          tone="primary"
        />
        <Line
          icon={<Package className="w-5 h-5 text-muted-foreground" />}
          term={fin("cogs")}
          hint="التمن اللي الشركة دفعته أصلاً عشان تجيب البضاعة اللي اتباعت دي"
          value={cogs}
          tone="destructive"
        />
        <Line
          icon={<TrendingUp className="w-5 h-5 text-success" />}
          term={fin("grossProfit")}
          hint="الفرق بين اللي باعت بيه واللي اشترت بيه = المبيعات − تكلفة البضاعة"
          value={gross}
          tone="success"
        />
        <Line
          icon={<Receipt className="w-5 h-5 text-warning" />}
          term={fin("opex")}
          hint="إيجارات + مرتبات + كهرباء وأي مصاريف تانية، مجمّعة من كل الفروع"
          value={opex}
          tone="destructive"
        />
        <Line
          icon={<Wallet className="w-6 h-6 text-primary" />}
          term={fin("netProfit")}
          hint={`المكسب الحقيقي بعد ما نطرح كل حاجة = مجمل الربح − المصاريف · ${fin("margin")}: ${margin.toFixed(1)}%`}
          value={net}
          tone={net >= 0 ? "success" : "destructive"}
          big
        />
      </div>

      {/* الكاش الفعلي المتاح للتوزيع */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <HandCoins className="w-5 h-5 text-primary" />
            الكاش الفعلي المتاح للتوزيع ({"Distributable Cash"})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="leading-8 text-sm md:text-base">
            من الـ <b>{formatEGP(net)}</b> دول، فيه <b className="text-warning">{formatEGP(unpaidSales)}</b>{" "}
            لسه آجل عند العملاء ماوصلش كاش <span className="text-muted-foreground">({fin("receivables")})</span>،
            وفيه <b className="text-destructive">{formatEGP(supplierDebt)}</b> عليك للموردين لسه هتدفعه{" "}
            <span className="text-muted-foreground">({fin("payables")})</span> — يبقى اللي تقدر توزعه فعلاً
            دلوقتي كاش هو <b className="text-success text-lg">{formatEGP(distributable)}</b>.
          </p>
          {cappedByCash && (
            <div className="flex items-start gap-2 text-xs md:text-sm rounded-xl border border-warning/30 bg-warning/10 p-3">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <span>
                الفلوس اللي في الخزن فعليًا ({formatEGP(cashOnHand)}) أقل من الرقم النظري، فقصرنا المتاح
                للتوزيع على اللي موجود بجد في الخزنة.
              </span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            الفلوس الموجودة دلوقتي في كل الخزن: {formatEGP(cashOnHand)}
          </div>
        </CardContent>
      </Card>

      {/* نصيب كل شريك */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            نصيب كل شريك ({"Partner Profit Share"})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {partners.length === 0 ? (
            <div className="text-center text-muted-foreground py-6 text-sm">
              مفيش شركاء متسجلين لسه — ضيفهم من صفحة «الذمة المالية للشركاء».
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الشريك</TableHead>
                  <TableHead className="text-right">نسبته</TableHead>
                  <TableHead className="text-right">فلوسه في الشركة</TableHead>
                  <TableHead className="text-right">نصيبه من {fin("netProfit")}</TableHead>
                  <TableHead className="text-right">نصيبه كاش دلوقتي</TableHead>
                  <TableHead className="text-right">بعد خصم السلفة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-semibold">{p.name}</TableCell>
                    <TableCell className="tabular-nums">{p.pct.toFixed(2)}%</TableCell>
                    <TableCell className="tabular-nums">{formatEGP(p.capital)}</TableCell>
                    <TableCell className={`tabular-nums font-bold ${p.profitShare >= 0 ? "text-success" : "text-destructive"}`}>
                      {formatEGP(p.profitShare)}
                    </TableCell>
                    <TableCell className="tabular-nums font-bold">{formatEGP(p.cashShare)}</TableCell>
                    <TableCell className="tabular-nums">
                      {p.advance > 0 ? (
                        <div>
                          <div className="text-xs text-destructive">
                            خصم سلفة قائمة ({"Advance"}): {formatEGP(p.advance)}
                          </div>
                          <div className={`font-bold ${p.netCash >= 0 ? "text-success" : "text-destructive"}`}>
                            {formatEGP(p.netCash)}
                          </div>
                        </div>
                      ) : (
                        <span className="font-bold">{formatEGP(p.cashShare)}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>الإجمالي</TableCell>
                  <TableCell className="tabular-nums">
                    {partners.reduce((s, p) => s + p.pct, 0).toFixed(2)}%
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatEGP(partners.reduce((s, p) => s + p.capital, 0))}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatEGP(partners.reduce((s, p) => s + p.profitShare, 0))}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatEGP(partners.reduce((s, p) => s + p.cashShare, 0))}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatEGP(partners.reduce((s, p) => s + p.netCash, 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            النسبة محسوبة من فلوس الشريك في الخزينة الرئيسية ÷ إجمالي {fin("capital")}. التوزيع بيتعمل
            بطريقة «أكبر باقي» عشان مجموع نصيب الشركاء يساوي {fin("netProfit")} بالظبط من غير قروش ضايعة.
          </p>
        </CardContent>
      </Card>
    </div>
  );

  if (embedded) return body;

  return (
    <AdminLayout>
      <PageHeader
        title="ملخص الأرباح الشهري"
        subtitle="قصة الشهر بالكامل بالعامية — بعنا بكام، جابناها بكام، صرفنا كام، وكسبنا كام، وإيه اللي ينفع يتوزع كاش"
      />
      <div className="p-4 md:p-6">{body}</div>
    </AdminLayout>
  );
}
