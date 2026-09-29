import { getCairoDayBounds, cairoTodayDay } from "@/lib/cairoDate";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatEGP, formatNumber } from "@/lib/format";
import { lineProfit } from "@/lib/profitEngine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { StatCard } from "@/components/StatCard";
import { ReportIntro } from "@/components/ReportIntro";
import { printReport } from "@/lib/export";
import { RankBars, ShareBreakdown } from "@/components/charts/RankBars";

import { Printer, TrendingUp, TrendingDown, Package, Wallet, Users, AlertCircle } from "lucide-react";
import { useBranchScope } from "@/lib/branchScope";

const today = () => cairoTodayDay();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Same exclusion list used by branch reports — keeps numbers consistent
const EXCLUDE_KEYS = ["customer_return", "supplier_payment", "branch_transfer_out"];

const PIE_COLORS = [
  "hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))",
  "hsl(var(--destructive))", "hsl(var(--accent))", "#8b5cf6", "#06b6d4", "#f97316",
];

interface Props { embedded?: boolean }

export default function ExecutiveInsights({ embedded }: Props) {
  const { tenantId } = useAuth();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [branchId, setBranchId] = useState<string>("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const { filterBranches } = useBranchScope();
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [preOrders, setPreOrders] = useState<any[]>([]);

  const loadBranches = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("branches").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).eq("is_system", false);
    setBranches(filterBranches((data ?? []) as any) as any);
  };

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const fromIso = getCairoDayBounds(from).startIso!;
    const toIso = getCairoDayBounds(undefined, to).endIso!;

    let cQ = supabase.from("contacts").select("id, name, type, branch_id").eq("tenant_id", tenantId).in("type", ["supplier", "both"]);
    let iQ = supabase.from("invoices")
      .select("id, branch_id, is_migrated, invoice_items(product_id, product_name, quantity, returned_quantity, net_quantity, total, selling_price, line_discount, unit_cost_at_sale, cost_price)")
      .eq("tenant_id", tenantId).eq("status", "active")
      .gte("invoice_date", fromIso).lte("invoice_date", toIso);
    let pQ = supabase.from("products").select("id, name, sku, branch_id, quantity, archived_at").eq("tenant_id", tenantId).is("archived_at", null);
    let eQ = supabase.from("vouchers")
      .select("id, amount, branch_id, voucher_categories!inner(name, system_key, is_deductible_from_profit)")
      .eq("tenant_id", tenantId).eq("type", "payment").eq("status", "active")
      .eq("voucher_categories.is_deductible_from_profit", true)
      .gte("voucher_date", from).lte("voucher_date", to);

    let poQ = supabase.from("pre_orders")
      .select("id, product_name, quantity, expected_price, status, branch_id, created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", fromIso).lte("created_at", toIso);

    if (branchId !== "all") {
      cQ = cQ.eq("branch_id", branchId);
      iQ = iQ.eq("branch_id", branchId);
      pQ = pQ.eq("branch_id", branchId);
      eQ = eQ.eq("branch_id", branchId);
      poQ = poQ.eq("branch_id", branchId);
    }

    const [c, i, p, e, po] = await Promise.all([
      fetchAllRows<any>(() => cQ.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => iQ.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => pQ.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => eQ.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => poQ.order("id")).then((data) => ({ data })),
    ]);
    // TODO Phase 2.2B: Remove after contacts.balance column is dropped — merge canonical balances
    const cList = (c.data ?? []) as any[];
    const { fetchContactBalanceMap, mergeBalancesById } = await import("@/lib/contactBalances");
    const cBalMap = await fetchContactBalanceMap(cList.map((x) => x.id));
    setContacts(mergeBalancesById(cList, cBalMap));
    setInvoices(i.data ?? []);
    setAllProducts(p.data ?? []);
    setExpenses((e.data ?? []).filter((v: any) => !EXCLUDE_KEYS.includes(v.voucher_categories?.system_key)));
    setPreOrders(po.data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadBranches(); /* eslint-disable-next-line */ }, [tenantId]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId, branchId]);
  useRealtimeRefresh(["contacts", "invoices", "invoice_items", "vouchers", "products", "pre_orders"], load);

  // === Pre-orders: most-requested products ===
  const topPreOrderProducts = useMemo(() => {
    const m: Record<string, { name: string; count: number; qty: number; value: number; cancelled: number }> = {};
    for (const po of preOrders) {
      const k = po.product_name ?? "—";
      if (!m[k]) m[k] = { name: k, count: 0, qty: 0, value: 0, cancelled: 0 };
      m[k].count += 1;
      m[k].qty += Number(po.quantity) || 0;
      m[k].value += (Number(po.expected_price) || 0) * (Number(po.quantity) || 0);
      if (po.status === "cancelled") m[k].cancelled += 1;
    }
    return Object.values(m).sort((a, b) => b.qty - a.qty).slice(0, 10);
  }, [preOrders]);

  // === Suppliers ===
  // balance < 0 → we owe them; balance > 0 → they owe us
  const suppliersWeOwe = useMemo(() =>
    contacts.filter((c) => Number(c.balance) < 0)
      .map((c) => ({ name: c.name, amount: Math.abs(Number(c.balance)) }))
      .sort((a, b) => b.amount - a.amount).slice(0, 10),
  [contacts]);

  const suppliersOwingUs = useMemo(() =>
    contacts.filter((c) => Number(c.balance) > 0)
      .map((c) => ({ name: c.name, amount: Number(c.balance) }))
      .sort((a, b) => b.amount - a.amount).slice(0, 10),
  [contacts]);

  // === Products ===
  const productStats = useMemo(() => {
    const map: Record<string, { id: string | null; name: string; qty: number; revenue: number; profit: number }> = {};
    for (const inv of invoices) {
      for (const it of inv.invoice_items ?? []) {
        const key = it.product_id ?? `__${it.product_name}`;
        if (!map[key]) map[key] = { id: it.product_id, name: it.product_name, qty: 0, revenue: 0, profit: 0 };
        const lp = lineProfit(it, { invoiceIsMigrated: !!inv.is_migrated });
        map[key].qty += lp.netQty;
        map[key].revenue += lp.revenue;
        map[key].profit += lp.profit;
      }
    }
    return Object.values(map);
  }, [invoices]);

  const topProducts = useMemo(() =>
    [...productStats].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  [productStats]);

  // Stagnant products: in catalog but with zero sales in window
  const stagnantProducts = useMemo(() => {
    const soldIds = new Set(productStats.filter((p) => p.id).map((p) => p.id!));
    return allProducts.filter((p) => !soldIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, sku: p.sku, quantity: p.quantity }))
      .sort((a, b) => b.quantity - a.quantity).slice(0, 10);
  }, [allProducts, productStats]);

  const weakestSold = useMemo(() =>
    [...productStats].filter((p) => p.qty > 0).sort((a, b) => a.revenue - b.revenue).slice(0, 10),
  [productStats]);

  // === Expenses by category ===
  const expByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of expenses) {
      const name = v.voucher_categories?.name ?? "أخرى";
      m[name] = (m[name] ?? 0) + Number(v.amount);
    }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [expenses]);

  const topExpenses = expByCat.slice(0, 5);
  const bottomExpenses = [...expByCat].reverse().slice(0, 5);

  const totalOwed = suppliersWeOwe.reduce((s, x) => s + x.amount, 0);
  const totalOwing = suppliersOwingUs.reduce((s, x) => s + x.amount, 0);
  const totalExpenses = expByCat.reduce((s, x) => s + x.value, 0);
  const branchName = branchId === "all" ? "كل الفروع" : (branches.find((b) => b.id === branchId)?.name ?? "");

  const exportPdf = () => {
    const tbl = (rows: string[][], headers: string[]) =>
      `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
        rows.length === 0 ? `<tr><td colspan="${headers.length}" class="muted" style="text-align:center">لا توجد بيانات</td></tr>`
        : rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")
      }</tbody></table>`;

    const html = `
      <div class="meta">الفرع: ${branchName} | الفترة: ${from} → ${to}</div>
      <div class="kpi">
        <div>إجمالي ما علينا للموردين<b class="neg">${formatEGP(totalOwed)}</b></div>
        <div>إجمالي ما لينا عند الموردين<b class="pos">${formatEGP(totalOwing)}</b></div>
        <div>إجمالي المصروفات<b class="neg">${formatEGP(totalExpenses)}</b></div>
        <div>عدد المنتجات الراكدة<b>${stagnantProducts.length}</b></div>
      </div>

      <h2>أكبر الموردين الدائنين (إحنا مدينين لهم — علينا فلوس)</h2>
      ${tbl(suppliersWeOwe.map((s) => [s.name, `<b class="neg">${formatEGP(s.amount)}</b>`]), ["المورد", "المبلغ المستحق علينا"])}

      <h2>موردين لنا رصيد عندهم (إحنا لينا فلوس عندهم)</h2>
      ${tbl(suppliersOwingUs.map((s) => [s.name, `<b class="pos">${formatEGP(s.amount)}</b>`]), ["المورد", "الرصيد لصالحنا"])}

      <h2>أعلى 10 منتجات مبيعاً (الأكثر طلباً)</h2>
      ${tbl(topProducts.map((p) => [p.name, formatNumber(p.qty), formatEGP(p.revenue), formatEGP(p.profit)]),
        ["المنتج", "الكمية المباعة", "الإيراد", "الربح"])}

      <h2>أضعف 10 منتجات مبيعاً (نشطة لكن ضعيفة)</h2>
      ${tbl(weakestSold.map((p) => [p.name, formatNumber(p.qty), formatEGP(p.revenue)]),
        ["المنتج", "الكمية", "الإيراد"])}

      <h2>منتجات راكدة (لم تُباع خلال الفترة)</h2>
      ${tbl(stagnantProducts.map((p) => [p.name, p.sku, formatNumber(p.quantity)]),
        ["المنتج", "الكود", "المخزون الحالي"])}

      <h2>أعلى المصروفات</h2>
      ${tbl(topExpenses.map((e) => [e.name, `<b class="neg">${formatEGP(e.value)}</b>`]), ["الفئة", "المبلغ"])}

      <h2>أقل المصروفات</h2>
      ${tbl(bottomExpenses.map((e) => [e.name, formatEGP(e.value)]), ["الفئة", "المبلغ"])}

      <h2>أكثر المنتجات طلباً في الحجوزات (Pre-orders)</h2>
      ${tbl(topPreOrderProducts.map((p) => [p.name, String(p.count), formatNumber(p.qty), formatEGP(p.value)]),
        ["المنتج", "عدد الطلبات", "إجمالي الكمية", "القيمة المتوقعة"])}
    `;
    printReport(`الرؤى التنفيذية — ${branchName}`, html);
  };

  return (
    <div className={embedded ? "" : "p-6"}>
      <ReportIntro
        icon="🎯"
        title="الرؤى التنفيذية — قرارات لا أرقام"
        purpose="مش بيقولك الأرقام بس، بيقولك تعمل إيه: مين تكلمه، إيه تشتري، إيه توقف، فين الفلوس النايمة."
        shows={[
          "أعلى/أقل الموردين (لينا/علينا) — لإدارة الديون",
          "أفضل/أقل المنتجات مبيعاً + المنتجات الراكدة",
          "أكتر/أقل المصروفات بنوعها (Pie chart)",
          "الأكثر طلباً في الحجوزات + تصدير PDF شامل",
        ]}
        unique="يُظهر قوائم الأفضل والأسوأ مع تحليل يساعدك على اتخاذ القرار."
        accent="warning"
      />
      {/* Filters */}
      <div className="card-elevated p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <Label>الفرع</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="mt-1.5 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع (إجمالي)</SelectItem>
              {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1.5" /></div>
        <div><Label>إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1.5" /></div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          {loading ? "جاري التحديث..." : "مباشر — تحديث تلقائي"}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setFrom(today()); setTo(today()); }}>اليوم</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(7)); setTo(today()); }}>7 أيام</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(30)); setTo(today()); }}>30 يوم</Button>
        </div>
        <Button onClick={exportPdf} className="gap-2 mr-auto"><Printer className="w-4 h-4" /> تحميل PDF شامل</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="علينا للموردين" value={formatEGP(totalOwed)} icon={<TrendingDown className="w-4 h-4" />} accent="destructive" hint={`${suppliersWeOwe.length} مورد`} />
        <StatCard label="لنا عند الموردين" value={formatEGP(totalOwing)} icon={<TrendingUp className="w-4 h-4" />} accent="success" hint={`${suppliersOwingUs.length} مورد`} />
        <StatCard label="إجمالي المصروفات" value={formatEGP(totalExpenses)} icon={<Wallet className="w-4 h-4" />} accent="warning" hint={`${expByCat.length} فئة`} />
        <StatCard label="منتجات راكدة" value={String(stagnantProducts.length)} icon={<AlertCircle className="w-4 h-4" />} accent={stagnantProducts.length > 0 ? "destructive" : "success"} hint="لم تُباع خلال الفترة" />
      </div>

      {/* Suppliers section */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2 text-destructive"><Users className="w-4 h-4" /> أكبر الموردين الدائنين (إحنا مدينين لهم — علينا فلوس)</h3>
          {suppliersWeOwe.length === 0 ? <div className="text-center text-muted-foreground py-8 text-sm">لا يوجد موردون مستحقون</div> : (
            <RankBars items={suppliersWeOwe.map((s: any) => ({ name: s.name, value: Number(s.amount) }))} tone="destructive" format={(v) => formatEGP(v)} />
          )}
        </div>

        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2 text-success"><Users className="w-4 h-4" /> موردين لنا رصيد عندهم (إحنا لينا فلوس عندهم)</h3>
          {suppliersOwingUs.length === 0 ? <div className="text-center text-muted-foreground py-8 text-sm">لا يوجد</div> : (
            <RankBars items={suppliersOwingUs.map((s: any) => ({ name: s.name, value: Number(s.amount) }))} tone="success" format={(v) => formatEGP(v)} />
          )}
        </div>
      </div>

      {/* Top products */}
      <div className="card-elevated p-4 mb-6">
        <h3 className="font-bold mb-3 flex items-center gap-2 text-primary"><Package className="w-4 h-4" /> أعلى 10 منتجات مبيعاً</h3>
        {topProducts.length === 0 ? <div className="text-center text-muted-foreground py-8 text-sm">لا توجد مبيعات في الفترة</div> : (
          <RankBars
            items={topProducts.map((p: any) => ({ name: p.name, value: Number(p.revenue), sub: `${formatNumber(p.qty)} قطعة` }))}
            tone="primary"
            format={(v) => formatEGP(v)}
          />
        )}
      </div>

      {/* Top pre-ordered products */}
      <div className="card-elevated p-4 mb-6">
        <h3 className="font-bold mb-3 flex items-center gap-2 text-accent"><Package className="w-4 h-4" /> أكثر المنتجات طلباً في الحجوزات (Pre-orders)</h3>
        {topPreOrderProducts.length === 0 ? <div className="text-center text-muted-foreground py-8 text-sm">لا توجد طلبات حجز في الفترة</div> : (
          <div className="grid lg:grid-cols-2 gap-4">
            <RankBars
              items={topPreOrderProducts.map((p: any) => ({ name: p.name, value: Number(p.qty) }))}
              tone="accent"
              format={(v) => `${formatNumber(v)} قطعة`}
            />

            <DataTable rows={topPreOrderProducts} empty=""
              columns={[
                { key: "name", header: "المنتج", render: (r: any) => <b>{r.name}</b> },
                { key: "count", header: "عدد الطلبات" },
                { key: "qty", header: "إجمالي الكمية", render: (r: any) => formatNumber(r.qty) },
                { key: "value", header: "القيمة المتوقعة", render: (r: any) => formatEGP(r.value) },
              ]} />
          </div>
        )}
      </div>



      {/* Weak / Stagnant */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3 text-center text-warning">أضعف المنتجات مبيعاً (نشطة)</h3>
          <DataTable rows={weakestSold} empty="لا توجد بيانات"
            columns={[
              { key: "name", header: "المنتج", align: "center", render: (r: any) => <b className="text-center block">{r.name}</b> },
              { key: "qty", header: "الكمية", align: "center", render: (r: any) => formatNumber(r.qty) },
              { key: "revenue", header: "الإيراد", align: "center", render: (r: any) => formatEGP(r.revenue) },
            ]} />
        </div>
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3 text-center flex justify-center items-center gap-2 text-destructive"><AlertCircle className="w-4 h-4" /> منتجات راكدة (لم تُباع)</h3>
          <DataTable rows={stagnantProducts} empty="ممتاز — جميع المنتجات تتحرك"
            columns={[
              { key: "name", header: "المنتج", align: "center", render: (r: any) => <b className="text-center block">{r.name}</b> },
              { key: "sku", header: "الكود", align: "center" },
              { key: "quantity", header: "المخزون", align: "center", render: (r: any) => <span className="text-destructive font-bold">{formatNumber(r.quantity)}</span> },
            ]} />
        </div>
      </div>

      {/* Expenses */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2"><Wallet className="w-4 h-4" /> توزيع المصروفات حسب الفئة</h3>
          {expByCat.length === 0 ? <div className="text-center text-muted-foreground py-8 text-sm">لا توجد مصروفات</div> : (
            <ShareBreakdown items={expByCat.map((e: any) => ({ name: e.name, value: Number(e.value) }))} format={(v) => formatEGP(v)} />
          )}

        </div>
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3">أعلى وأقل المصروفات</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-bold text-destructive mb-2">الأعلى</p>
              {topExpenses.length === 0 ? <p className="text-xs text-muted-foreground">—</p> :
                topExpenses.map((e) => (
                  <div key={e.name} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                    <span className="truncate">{e.name}</span>
                    <b className="text-destructive shrink-0 mr-2">{formatEGP(e.value)}</b>
                  </div>
                ))}
            </div>
            <div>
              <p className="text-xs font-bold text-success mb-2">الأقل</p>
              {bottomExpenses.length === 0 ? <p className="text-xs text-muted-foreground">—</p> :
                bottomExpenses.map((e) => (
                  <div key={e.name} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                    <span className="truncate">{e.name}</span>
                    <b className="shrink-0 mr-2">{formatEGP(e.value)}</b>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
