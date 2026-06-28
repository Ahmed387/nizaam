import { Fragment, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { Loader2, TrendingUp, TrendingDown, DollarSign, Wallet, ChevronDown, ChevronLeft } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { lineProfit } from "@/lib/profitEngine";
import { ReportIntro } from "@/components/ReportIntro";

interface Row {
  product_id: string | null;
  product_name: string;
  qty: number;
  gross_qty: number;
  returned_qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  base_unit?: number;
  shipping_unit?: number;
  true_unit?: number;
  cost_unknown?: boolean;
}

interface InvRow {
  invoice_id: string;
  invoice_number: string;
  created_at: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  has_return: boolean;
  was_edited: boolean;
  is_migrated: boolean;
  cost_unknown: boolean;
  original_profit: number;
}



export default function ProfitabilityReport({ embedded }: { embedded?: boolean } = {}) {
  const Wrapper: any = embedded ? Fragment : AdminLayout;
  const { tenantId } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string>("");
  const [cashierId, setCashierId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [branches, setBranches] = useState<any[]>([]);
  const [cashiers, setCashiers] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [productCat, setProductCat] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hideLegacy, setHideLegacy] = useState(false);
  const [hasAnyMigrated, setHasAnyMigrated] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("branches").select("id, name").eq("tenant_id", tenantId).then(({ data }) => setBranches(data ?? []));
    supabase.from("categories").select("id, name").eq("tenant_id", tenantId).then(({ data }) => setCategories(data ?? []));
    supabase.from("products").select("id, category_id").eq("tenant_id", tenantId).then(({ data }) => {
      const m: Record<string, string | null> = {};
      (data ?? []).forEach((p: any) => { m[p.id] = p.category_id ?? null; });
      setProductCat(m);
    });
    // Cashiers / branch managers: users with these roles, joined to profiles
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("role", ["cashier", "branch_manager"] as any);
      const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
      if (!ids.length) return setCashiers([]);
      const { data: profs } = await supabase.from("profiles").select("id, name").in("id", ids).eq("tenant_id", tenantId);
      setCashiers((profs ?? []) as any);
    })();
  }, [tenantId]);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("invoice_items")
      .select("product_id, product_name, quantity, returned_quantity, original_unit_cost, selling_price, unit_cost_at_sale, line_discount, invoice:invoices!inner(id, invoice_number, branch_id, created_at, status, cashier_id, is_migrated)")
      .eq("tenant_id", tenantId);
    const { data, error } = await q;
    setLoading(false);
    if (error) { console.error(error); return; }

    const filtered = (data ?? []).filter((r: any) => {
      const inv = r.invoice;
      if (!inv || inv.status === "cancelled") return false;
      if (branchId && inv.branch_id !== branchId) return false;
      if (cashierId && inv.cashier_id !== cashierId) return false;
      if (hideLegacy && inv.is_migrated) return false;
      if (categoryId) {
        const cat = r.product_id ? productCat[r.product_id] : null;
        if (cat !== categoryId) return false;
      }
      const d = inv.created_at?.slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    setHasAnyMigrated((data ?? []).some((r: any) => r.invoice?.is_migrated));

    // group by product
    const map = new Map<string, Row>();
    const invMap = new Map<string, InvRow>();
    for (const r of filtered as any[]) {
      const qtyRaw = Number(r.quantity) || 0;
      const retQty = Number(r.returned_quantity) || 0;
      const lp = lineProfit(
        {
          quantity: qtyRaw,
          returned_quantity: retQty,
          selling_price: r.selling_price,
          line_discount: r.line_discount,
          unit_cost_at_sale: r.unit_cost_at_sale,
        },
        { invoiceIsMigrated: !!r.invoice?.is_migrated }
      );
      const netQty = lp.netQty;
      const unitSell = Number(r.selling_price) || 0;
      const origCost = Number(r.original_unit_cost ?? r.unit_cost_at_sale ?? 0);
      const costUnknown = lp.costUnknown;
      const revenue = lp.revenue;
      const cost = lp.cost;
      const profit = lp.profit;
      const origRevenue = qtyRaw * unitSell - Number(r.line_discount || 0);
      const origProfit = origRevenue - qtyRaw * origCost;
      const wasEdited = Math.abs(Number(r.unit_cost_at_sale || 0) - origCost) > 0.001;
      const hasReturn = retQty > 0;

      const key = r.product_id ?? r.product_name;
      const prev = map.get(key) ?? { product_id: r.product_id, product_name: r.product_name, qty: 0, gross_qty: 0, returned_qty: 0, revenue: 0, cost: 0, profit: 0, margin: 0, cost_unknown: true };
      prev.qty += netQty;
      prev.gross_qty += qtyRaw;
      prev.returned_qty += retQty;
      prev.revenue += revenue; prev.cost += cost; prev.profit += profit;
      if (!costUnknown) prev.cost_unknown = false;
      prev.margin = prev.revenue > 0 ? (prev.profit / prev.revenue) * 100 : 0;
      map.set(key, prev);

      const inv = r.invoice;
      const ip: InvRow = invMap.get(inv.id) ?? { invoice_id: inv.id, invoice_number: inv.invoice_number, created_at: inv.created_at, revenue: 0, cost: 0, profit: 0, margin: 0, has_return: false, was_edited: false, is_migrated: !!inv.is_migrated, cost_unknown: true, original_profit: 0 };
      ip.revenue += revenue; ip.cost += cost; ip.profit += profit;
      ip.original_profit += origProfit;
      ip.has_return = ip.has_return || hasReturn;
      ip.was_edited = ip.was_edited || wasEdited;
      if (!costUnknown) ip.cost_unknown = false;
      ip.margin = ip.revenue > 0 ? (ip.profit / ip.revenue) * 100 : 0;
      invMap.set(inv.id, ip);
    }

    // Enrich rows with batch breakdown (weighted avg of base + shipping share per unit)
    const pids = Array.from(map.keys()).filter((k) => /^[0-9a-f-]{36}$/i.test(k));
    if (pids.length) {
      const { data: batches } = await supabase
        .from("product_batches" as any)
        .select("product_id, quantity_purchased, base_purchase_price, shipping_cost_per_unit, true_unit_cost, cost_price")
        .in("product_id", pids);
      const agg = new Map<string, { qty: number; base: number; ship: number; trueC: number }>();
      (batches ?? []).forEach((b: any) => {
        const q = Number(b.quantity_purchased || 0);
        const a = agg.get(b.product_id) ?? { qty: 0, base: 0, ship: 0, trueC: 0 };
        a.qty += q;
        a.base += q * Number(b.base_purchase_price || b.cost_price || 0);
        a.ship += q * Number(b.shipping_cost_per_unit || 0);
        a.trueC += q * Number(b.true_unit_cost || b.cost_price || 0);
        agg.set(b.product_id, a);
      });
      map.forEach((r, k) => {
        const a = agg.get(k);
        if (a && a.qty > 0) {
          r.base_unit = a.base / a.qty;
          r.shipping_unit = a.ship / a.qty;
          r.true_unit = a.trueC / a.qty;
        }
      });
    }
    setRows(Array.from(map.values()).sort((a, b) => b.profit - a.profit));
    setInvRows(Array.from(invMap.values()).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  };

  useEffect(() => { if (tenantId) load(); /* eslint-disable-next-line */ }, [tenantId, hideLegacy]);
  useRealtimeRefresh(["invoices", "invoice_items", "returns", "return_items"], () => { if (tenantId) load(); });

  // realtime: refresh totals when new invoices/items arrive
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`profit-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_items" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "product_batches" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [tenantId, from, to, branchId, cashierId, categoryId]);

  const totals = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    const profit = revenue - cost;
    const best = rows.reduce<Row | null>((b, r) => (!b || r.margin > b.margin ? r : b), null);
    const worst = rows.reduce<Row | null>((b, r) => (!b || r.margin < b.margin ? r : b), null);
    return { revenue, cost, profit, best, worst };
  }, [rows]);

  return (
    <Wrapper>
      <PageHeader title="تقرير الربحية" subtitle="ربح فعلي محسوب من تكلفة FIFO وقت البيع" />
      <ReportIntro
        icon="📊"
        title="تقرير الربحية — المحاسبة الدقيقة"
        purpose="الجواب الرسمي على سؤال: 'كسبت كام فعلاً؟' محسوب بنظام FIFO على مستوى كل فاتورة ومنتج."
        shows={[
          "الإيراد - التكلفة (FIFO) = صافي الربح + هامش %",
          "ربح كل فاتورة، كل منتج، وكل دفعة شراء (Drill-down)",
          "فلاتر بالفرع، الكاشير، الفئة، والفترة الزمنية",
          "أعلى/أقل 10 منتجات بالهامش (جودة الربح)",
        ]}
        unique="المصدر الرئيسي لحساب الأرباح بدقة؛ كل أرقام الربح في النظام تعتمد عليه."
        accent="info"
      />


      {hasAnyMigrated && (
        <div className="card-elevated p-3 mb-3 border-amber-500/30 bg-amber-500/5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
            ⚠️ <span>بعض السجلات مستوردة من نظام قديم — التكلفة فيها قد تظهر <b>"غير متاح"</b> لأنها لم تُسجل بطريقة FIFO.</span>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={hideLegacy} onChange={(e) => setHideLegacy(e.target.checked)} className="h-4 w-4" />
            <span>إخفاء السجلات القديمة المستوردة</span>
          </label>
        </div>
      )}


      <div className="card-elevated p-4 mb-4 grid md:grid-cols-6 gap-3">
        <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div>
          <Label className="text-xs">الفرع</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">الكاشير / البائع</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={cashierId} onChange={(e) => setCashierId(e.target.value)}>
            <option value="">الكل</option>
            {cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">فئة المنتج</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">الكل</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-end"><Button onClick={load} className="w-full" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "تشغيل"}</Button></div>
      </div>

      <div className="grid md:grid-cols-4 gap-3 mb-4">
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> الإيراد</div><div className="text-xl font-bold">{formatEGP(totals.revenue)}</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="w-3 h-3" /> التكلفة</div><div className="text-xl font-bold">{formatEGP(totals.cost)}</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" /> صافي الربح</div><div className={`text-xl font-bold ${totals.profit >= 0 ? "text-success" : "text-destructive"}`}>{formatEGP(totals.profit)}</div></div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">أعلى/أقل هامش</div>
          <div className="text-sm font-bold text-success truncate">↑ {totals.best?.product_name ?? "—"} ({totals.best?.margin.toFixed(1) ?? 0}%)</div>
          <div className={`text-sm font-bold truncate ${(totals.worst?.margin ?? 0) < 10 ? "text-destructive" : "text-warning"}`}>↓ {totals.worst?.product_name ?? "—"} ({totals.worst?.margin.toFixed(1) ?? 0}%)</div>
        </div>
      </div>

      {/* Top / Bottom margin lists — unique to Profitability (margin-quality view, not volume-based like Insights) */}
      {rows.length > 0 && (() => {
        const eligible = rows.filter((r) => !r.cost_unknown && r.qty > 0 && r.revenue > 0);
        const topMargin = [...eligible].sort((a, b) => b.margin - a.margin).slice(0, 10);
        const bottomMargin = [...eligible].sort((a, b) => a.margin - b.margin).slice(0, 10);
        return (
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="card-elevated p-0 overflow-hidden border-r-4 border-success/50 shadow-sm">
              <div className="px-4 py-3 bg-success/10 border-b border-success/20 flex items-center justify-between">
                <h4 className="font-extrabold text-success text-base flex items-center gap-2"><TrendingUp className="w-5 h-5" /> أعلى 10 منتجات بالهامش</h4>
                <span className="text-[11px] font-semibold text-success/80 bg-success/15 px-2 py-0.5 rounded-full">جودة ربح</span>
              </div>
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-10" />
                  <col />
                  <col className="w-16" />
                  <col className="w-28" />
                  <col className="w-20" />
                </colgroup>
                <thead className="bg-surface-2/60">
                  <tr>
                  <th className="px-2 py-2.5 text-center font-bold text-sm uppercase tracking-wide text-muted-foreground">#</th>
                    <th className="px-3 py-2.5 text-right font-bold text-sm uppercase tracking-wide text-foreground">اسم المنتج</th>
                    <th className="px-2 py-2.5 text-center font-bold text-sm uppercase tracking-wide text-muted-foreground">الكمية</th>
                    <th className="px-3 py-2.5 text-right font-bold text-sm uppercase tracking-wide text-muted-foreground">الربح</th>
                    <th className="px-2 py-2.5 text-center font-bold text-sm uppercase tracking-wide text-muted-foreground">الهامش</th>
                  </tr>
                </thead>
                <tbody>
                  {topMargin.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">لا يوجد</td></tr>}
                  {topMargin.map((r, i) => (
                    <tr key={r.product_id ?? r.product_name} className={`border-t border-border/50 align-middle hover:bg-success/5 transition-colors ${i % 2 === 1 ? "bg-surface/30" : ""}`}>
                      <td className="px-2 py-3 text-center text-muted-foreground font-semibold tabular-nums">{i + 1}</td>
                      <td className="px-3 py-3 font-semibold text-foreground break-words leading-snug" title={r.product_name}>{r.product_name}</td>
                      <td className="px-2 py-3 text-center font-bold tabular-nums">{r.qty}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-success font-extrabold tabular-nums">{formatEGP(r.profit)}</td>
                      <td className="px-2 py-3 text-center whitespace-nowrap font-extrabold text-success tabular-nums">{r.margin.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-elevated p-0 overflow-hidden border-r-4 border-destructive/50 shadow-sm">
              <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 flex items-center justify-between">
                <h4 className="font-extrabold text-destructive text-base flex items-center gap-2"><TrendingDown className="w-5 h-5" /> أقل 10 منتجات بالهامش</h4>
                <span className="text-[11px] font-semibold text-destructive/80 bg-destructive/15 px-2 py-0.5 rounded-full">يستحق مراجعة</span>
              </div>
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-10" />
                  <col />
                  <col className="w-16" />
                  <col className="w-28" />
                  <col className="w-20" />
                </colgroup>
                <thead className="bg-surface-2/60">
                  <tr>
                    <th className="px-2 py-2.5 text-center font-bold text-sm uppercase tracking-wide text-muted-foreground">#</th>
                    <th className="px-3 py-2.5 text-right font-bold text-sm uppercase tracking-wide text-foreground">اسم المنتج</th>
                    <th className="px-2 py-2.5 text-center font-bold text-sm uppercase tracking-wide text-muted-foreground">الكمية</th>
                    <th className="px-3 py-2.5 text-right font-bold text-sm uppercase tracking-wide text-muted-foreground">الربح</th>
                    <th className="px-2 py-2.5 text-center font-bold text-sm uppercase tracking-wide text-muted-foreground">الهامش</th>
                  </tr>
                </thead>
                <tbody>
                  {bottomMargin.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">لا يوجد</td></tr>}
                  {bottomMargin.map((r, i) => (
                    <tr key={r.product_id ?? r.product_name} className={`border-t border-border/50 align-middle hover:bg-destructive/5 transition-colors ${i % 2 === 1 ? "bg-surface/30" : ""}`}>
                      <td className="px-2 py-3 text-center text-muted-foreground font-semibold tabular-nums">{i + 1}</td>
                      <td className="px-3 py-3 font-semibold text-foreground break-words leading-snug" title={r.product_name}>{r.product_name}</td>
                      <td className="px-2 py-3 text-center font-bold tabular-nums">{r.qty}</td>
                      <td className={`px-3 py-3 text-right whitespace-nowrap font-extrabold tabular-nums ${r.profit >= 0 ? "text-warning" : "text-destructive"}`}>{formatEGP(r.profit)}</td>
                      <td className={`px-2 py-3 text-center whitespace-nowrap font-extrabold tabular-nums ${r.margin < 10 ? "text-destructive" : "text-warning"}`}>{r.margin.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}


      <h3 className="font-bold mb-2">حسب المنتج</h3>
      <div className="card-elevated overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-right">المنتج</th>
                <th className="px-3 py-2 text-right">الكمية المباعة</th>
                <th className="px-3 py-2 text-right">المرتجع</th>
                <th className="px-3 py-2 text-right">الصافي</th>
                <th className="px-3 py-2 text-right">الإيراد (صافي)</th>
                <th className="px-3 py-2 text-right">التكلفة</th>
                <th className="px-3 py-2 text-right">الربح (صافي)</th>
                <th className="px-3 py-2 text-right">الهامش %</th>
              </tr>
            </thead>
            <tbody>
              {loading && (<tr><td colSpan={9} className="text-center py-8 text-muted-foreground">جاري التحميل...</td></tr>)}
              {!loading && rows.length === 0 && (<tr><td colSpan={9} className="text-center py-8 text-muted-foreground">لا توجد بيانات</td></tr>)}
              {rows.map((r) => {
                const key = r.product_id ?? r.product_name;
                const open = expanded.has(key);
                const sellUnit = r.qty > 0 ? r.revenue / r.qty : 0;
                const profitUnit = r.qty > 0 ? (r.profit / r.qty) : 0;
                return (
                  <Fragment key={key}>
                    <tr key={key} className="border-b border-border hover:bg-surface-2/40 cursor-pointer" onClick={() => {
                      const n = new Set(expanded); n.has(key) ? n.delete(key) : n.add(key); setExpanded(n);
                    }}>
                      <td className="px-3 py-2">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}</td>
                      <td className="px-3 py-2">{r.product_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.gross_qty}</td>
                      <td className="px-3 py-2">{r.returned_qty > 0 ? <span className="text-warning font-bold">{r.returned_qty}</span> : <span className="text-muted-foreground">0</span>}</td>
                      <td className="px-3 py-2 font-bold">{r.qty}</td>
                      <td className="px-3 py-2">{formatEGP(r.revenue)}</td>
                      <td className="px-3 py-2">
                        {r.cost_unknown
                          ? <span className="text-xs text-muted-foreground italic">غير متاح</span>
                          : formatEGP(r.cost)}
                      </td>
                      <td className={`px-3 py-2 font-bold ${r.profit >= 0 ? "text-success" : "text-destructive"}`}>
                        {r.cost_unknown ? <span className="text-muted-foreground italic font-normal">غير متاح</span> : formatEGP(r.profit)}
                      </td>
                      <td className={`px-3 py-2 ${!r.cost_unknown && r.margin < 10 ? "text-destructive font-bold" : ""}`}>
                        {r.cost_unknown ? "—" : `${r.margin.toFixed(1)}%`}
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${key}-d`} className="bg-surface-2/30">
                        <td></td>
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid md:grid-cols-3 gap-3 text-xs">
                            <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">سعر الشراء الأساسي/الوحدة</span><b>{formatEGP(r.base_unit ?? 0)}</b></div>
                            <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">نصيب مصاريف الشحن/الوحدة</span><b className="text-amber-600">+ {formatEGP(r.shipping_unit ?? 0)}</b></div>
                            <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">التكلفة الحقيقية/الوحدة</span><b className="text-primary">{formatEGP(r.true_unit ?? 0)}</b></div>
                            <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">متوسط سعر البيع/الوحدة</span><b>{formatEGP(sellUnit)}</b></div>
                            <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">الربح الحقيقي/الوحدة</span><b className={profitUnit >= 0 ? "text-success" : "text-destructive"}>{formatEGP(profitUnit)}</b></div>
                            <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">هامش الربح</span><b>{r.margin.toFixed(1)}%</b></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>


      <h3 className="font-bold mt-6 mb-2">حسب الفاتورة</h3>
      <DataTable loading={loading} rows={invRows as any} columns={[
        {
          key: "invoice_number",
          header: "الفاتورة",
          render: (r: InvRow) => (
            <div className="flex items-center gap-1 flex-wrap">
              <span>{r.invoice_number}</span>
              {r.is_migrated && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border" title="مستوردة من نظام قديم">
                  بيانات مستوردة
                </span>
              )}
              {r.was_edited && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 border border-amber-500/30"
                  title={`الربح الأصلي: ${formatEGP(r.original_profit)} ← الربح بعد التعديل: ${formatEGP(r.profit)}`}
                >تم التعديل</span>
              )}
              {r.has_return && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 border border-blue-500/30">يشمل مرتجع</span>
              )}
            </div>
          ),
        },
        { key: "created_at", header: "التاريخ", render: (r: InvRow) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
        { key: "revenue", header: "الإيراد", render: (r: InvRow) => formatEGP(r.revenue) },
        { key: "cost", header: "التكلفة", render: (r: InvRow) => r.cost_unknown ? <span className="text-xs text-muted-foreground italic">غير متاح</span> : formatEGP(r.cost) },
        { key: "profit", header: "صافي الربح", render: (r: InvRow) => r.cost_unknown ? <span className="text-muted-foreground italic">غير متاح</span> : <span className={r.profit >= 0 ? "text-success font-bold" : "text-destructive font-bold bg-destructive/10 px-2 rounded"}>{formatEGP(r.profit)}</span> },
        { key: "margin", header: "الهامش %", render: (r: InvRow) => r.cost_unknown ? "—" : `${r.margin.toFixed(1)}%` },
      ]} />
    </Wrapper>
  );
}

