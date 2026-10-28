import { getCairoDayBounds, cairoTodayDay } from "@/lib/cairoDate";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { NumberedPagination } from "@/components/NumberedPagination";
import { useListFilter, useRememberedFilter } from "@/hooks/useListFilter";
import { readAllBounded, useWholeList } from "@/hooks/useWholeList";
import { periodOfFilter, singleValueOf, withPeriod, withSingleValue, type FilterState, type ListColumn } from "@/lib/tableFilter";
import * as XLSX from "xlsx";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime, formatEGP } from "@/lib/format";
import { FileSpreadsheet, TrendingDown, TrendingUp, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useBranchScope } from "@/lib/branchScope";

const PRICE_TYPE_LABEL: Record<string, string> = {
  selling_price: "سعر البيع",
  cost_price: "سعر التكلفة",
  market_price: "سعر السوق",
  min_price: "الحد الأدنى",
  discount_limit: "حد الخصم",
  shipping_cost: "تكلفة الشحن",
  true_unit_cost: "التكلفة الحقيقية",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "يدوي",
  shipment: "فاتورة شراء",
  price_list_import: "استيراد قائمة",
  system: "النظام",
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "سوبر آدمن",
  admin: "مدير عام",
  branch_manager: "مدير فرع",
  accountant: "محاسب",
  cashier: "كاشير",
  system: "النظام",
};

export default function PriceAuditLog({ embedded }: { embedded?: boolean } = {}) {
  const { tenant, profile } = useAuth();
  const [branches, setBranches] = useState<any[]>([]);
  const { filterBranches } = useBranchScope();
  const [products, setProducts] = useState<any[]>([]);

  // Excel filters (owner 2026-10-26), remembered. The bar's period / price type / branch / source ARE those
  // columns' filters (both stay, linked); the product and the user stay the bar's own.
  const { pathname } = useLocation();
  const [colState, setColState] = useRememberedFilter(`xf:v1:${pathname}:prices`);
  const { from, to } = periodOfFilter(colState, "created_at");
  const setFrom = (v: string) => setColState(withPeriod(colState, "created_at", v, to));
  const setTo = (v: string) => setColState(withPeriod(colState, "created_at", from, v));
  const keyOf = (map: Record<string, string>, label: string) => Object.keys(map).find((k) => map[k] === label);
  const priceType = keyOf(PRICE_TYPE_LABEL, singleValueOf(colState, "price_type")) ?? "all";
  const setPriceType = (v: string) => setColState(withSingleValue(colState, "price_type", v === "all" ? "" : PRICE_TYPE_LABEL[v] ?? ""));
  const source = keyOf(SOURCE_LABEL, singleValueOf(colState, "source")) ?? "all";
  const setSource = (v: string) => setColState(withSingleValue(colState, "source", v === "all" ? "" : SOURCE_LABEL[v] ?? ""));
  const branchId = branches.find((b) => b.name === singleValueOf(colState, "branch"))?.id ?? "all";
  const setBranchId = (v: string) => setColState(withSingleValue(colState, "branch", v === "all" ? "" : branches.find((b) => b.id === v)?.name ?? ""));
  const [productId, setProductId] = useState("all");
  const [user, setUser] = useState("");
  const [duser, setDuser] = useState("");
  useEffect(() => { const t = setTimeout(() => setDuser(user.replace(/[,()%*\\]/g, " ").trim()), 300); return () => clearTimeout(t); }, [user]);
  const [todayCount, setTodayCount] = useState(0);

  /** the price changes of the bar's filters, newest first (every page from a fresh query) */
  const query = (select: string, opts?: { count?: "exact"; head?: boolean }) => {
    let qb: any = supabase.from("price_audit_log").select(select, opts);
    if (from) qb = qb.gte("created_at", getCairoDayBounds(from).startIso!);
    if (to) qb = qb.lte("created_at", getCairoDayBounds(undefined, to).endIso!);
    if (productId !== "all") qb = qb.eq("entity_id", productId);
    if (priceType !== "all") qb = qb.eq("price_type", priceType);
    if (duser) qb = qb.ilike("changed_by_name", `%${duser}%`);
    if (branchId !== "all") qb = qb.eq("branch_id", branchId);
    if (source !== "all") qb = qb.eq("source", source);
    return opts?.head ? qb : qb.order("created_at", { ascending: false }).order("id");
  };

  // one page of 50 from the database (it used to read the latest 1,000 only)
  const PAGE = 50;
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const req = useRef(0);
  /** a remembered branch the list of branches doesn't know yet is matched by name on the whole list */
  const linked = (st: FilterState) => !!st.sort || Object.entries(st.filters).some(([k, f]) => !(
    (k === "created_at" && f.kind === "date" && !f.days?.length)
    || (k === "price_type" && f.kind === "values" && f.values.length === 1 && keyOf(PRICE_TYPE_LABEL, f.values[0]))
    || (k === "source" && f.kind === "values" && f.values.length === 1 && keyOf(SOURCE_LABEL, f.values[0]))
    || (k === "branch" && f.kind === "values" && f.values.length === 1 && branches.some((b) => b.name === f.values[0]))));
  const wholeSig = `${from}|${to}|${productId}|${priceType}|${duser}|${branchId}|${source}`;
  const whole = useWholeList<any>(wholeSig, (signal) => readAllBounded(() => query("*, branches(name)"), () => query("id", { count: "exact", head: true }), 10_000, signal),
    { auto: linked(colState) });
  const listCols = useMemo<ListColumn<any>[]>(() => [
    { key: "created_at", label: "التاريخ", kind: "date", get: (r) => r.created_at },
    { key: "entity_name", label: "المنتج", kind: "text", get: (r) => r.entity_name },
    { key: "price_type", label: "نوع السعر", kind: "text", get: (r) => PRICE_TYPE_LABEL[r.price_type] ?? r.price_type },
    { key: "old_value", label: "القديم", kind: "number", get: (r) => (r.old_value == null ? null : Number(r.old_value)) },
    { key: "new_value", label: "الجديد", kind: "number", get: (r) => Number(r.new_value) },
    { key: "diff", label: "التغيير", kind: "number", get: (r) => (r.old_value == null ? null : Number(r.new_value) - Number(r.old_value)) },
    { key: "changed_by_name", label: "بواسطة", kind: "text", get: (r) => r.changed_by_name },
    { key: "branch", label: "الفرع", kind: "text", get: (r) => r.branches?.name },
    { key: "change_reason", label: "السبب", kind: "text", get: (r) => r.change_reason },
    { key: "source", label: "المصدر", kind: "text", get: (r) => SOURCE_LABEL[r.source] ?? r.source },
  ], []);
  const { result: listRes, adapter, state: colEff, apply } = useListFilter({ rows: whole.rows, columns: listCols, state: colState, onChange: setColState, ensureRows: whole.ensure });
  const wholeMode = linked(colEff);
  const colSig = JSON.stringify(colEff);
  useEffect(() => { setPage(1); }, [wholeSig, colSig]);

  const load = () => {
    if (wholeMode) return;
    const id = ++req.current;
    setLoading(true);
    const start = (page - 1) * PAGE;
    query("*, branches(name)", { count: "exact" }).range(start, start + PAGE - 1).then(({ data, count }: any) => {
      if (id !== req.current) return;
      setRows(data ?? []); setTotal(count ?? 0); setLoading(false);
    });
  };
  const loadToday = () => {
    supabase.from("price_audit_log").select("id", { count: "exact", head: true }).gte("created_at", getCairoDayBounds(cairoTodayDay()).startIso!)
      .then(({ count }) => setTodayCount(count ?? 0));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [wholeSig, page, wholeMode]);

  useEffect(() => {
    loadToday();
    supabase.from("branches").select("id,name").eq("is_system", false).then(({ data }) => setBranches(filterBranches((data ?? [])) as any) as any);
    fetchAllRows<any>(() => supabase.from("products").select("id,name").order("id")).then((data) => setProducts(data ?? [])).catch(() => setProducts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const liveRef = useRef<() => void>(() => {});
  liveRef.current = () => { load(); whole.refresh(); loadToday(); };
  useEffect(() => {
    const ch = supabase
      .channel("price-audit-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "price_audit_log" }, (payload: any) => {
        liveRef.current();
        toast.info(`تعديل سعر جديد: ${payload.new.entity_name ?? ""}`);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const shown = wholeMode ? (listRes ? listRes.rows.slice((page - 1) * PAGE, page * PAGE) : []) : rows;
  const shownCount = wholeMode ? (listRes ? listRes.rows.length : 0) : total;
  const tableAdapter = useMemo(() => ({ ...adapter, shown: adapter.shown ?? total }), [adapter, total]);

  const exportExcel = async () => {
    const t = toast.loading("جاري تجهيز السجل...");
    let all: any[];
    // every change of the bar's filters (not one page), then the column filters, in the order shown
    try { all = apply(await fetchAllRows<any>(() => query("*, branches(name)"))); }
    catch (e: any) { toast.dismiss(t); return toast.error(e?.message ?? "تعذر التصدير"); }
    toast.dismiss(t);
    const data = all.map((r) => ({
      "التاريخ": formatDateTime(r.created_at),
      "النوع": PRICE_TYPE_LABEL[r.price_type] ?? r.price_type,
      "المنتج/الكيان": r.entity_name ?? "",
      "السعر القديم": r.old_value ?? "",
      "السعر الجديد": r.new_value ?? "",
      "الفرق": r.old_value != null ? Number(r.new_value) - Number(r.old_value) : "",
      "بواسطة": r.changed_by_name ?? "",
      "الدور": ROLE_LABEL[r.changed_by_role] ?? r.changed_by_role,
      "الفرع": r.branches?.name ?? "",
      "السبب": r.change_reason ?? "",
      "المصدر": SOURCE_LABEL[r.source] ?? r.source,
    }));
    const meta = [
      ["الشركة", tenant?.name ?? ""],
      ["تاريخ التصدير", new Date().toLocaleString("ar-EG")],
      ["صدّره", profile?.name ?? ""],
      ["إجمالي السجلات", String(data.length)],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.sheet_add_json(ws, data, { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل الأسعار");
    XLSX.writeFile(wb, `price-audit-${cairoTodayDay()}.xlsx`);
    toast.success(`تم تصدير ${data.length} سجل`);
  };

  const rowClass = (r: any) => {
    if (r.old_value == null) return "bg-primary/5";
    if (Number(r.new_value) > Number(r.old_value)) return "bg-success/5";
    if (Number(r.new_value) < Number(r.old_value)) return "bg-destructive/5";
    return "";
  };

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="سجل تعديلات الأسعار"
        subtitle={`${shownCount.toLocaleString("en-US")} سجل — ${todayCount} تعديل اليوم`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
          </div>
        }
      />

      <div className="card-elevated p-4 mb-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="من" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder="إلى" />
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger><SelectValue placeholder="المنتج" /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">كل المنتجات</SelectItem>
            {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priceType} onValueChange={setPriceType}>
          <SelectTrigger><SelectValue placeholder="نوع السعر" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            {Object.entries(PRICE_TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="المستخدم" />
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger><SelectValue placeholder="المصدر" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المصادر</SelectItem>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {wholeMode && whole.tooMany && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="alert">{whole.tooMany.message}</div>
      )}
      <DataTable
        loading={wholeMode ? !listRes && !whole.tooMany : loading}
        rows={shown}
        excel={{ id: "prices", server: tableAdapter }}
        columns={[
          { key: "created_at", header: "التاريخ", render: (r: any) => <span className={`px-2 py-1 rounded ${rowClass(r)}`}>{formatDateTime(r.created_at)}</span> },
          { key: "entity_name", header: "المنتج", render: (r: any) => <span className="font-semibold">{r.entity_name ?? "—"}</span> },
          { key: "price_type", header: "نوع السعر", render: (r: any) => PRICE_TYPE_LABEL[r.price_type] ?? r.price_type },
          { key: "old_value", header: "القديم", render: (r: any) => r.old_value == null ? <span className="text-primary">—</span> : formatEGP(r.old_value) },
          { key: "new_value", header: "الجديد", render: (r: any) => <span className="font-bold">{formatEGP(r.new_value)}</span> },
          {
            key: "diff", header: "التغيير", render: (r: any) => {
              if (r.old_value == null) return <span className="inline-flex items-center gap-1 text-primary"><Sparkles className="w-3 h-3" /> أول تسجيل</span>;
              const diff = Number(r.new_value) - Number(r.old_value);
              const pct = Number(r.old_value) === 0 ? 0 : (diff / Number(r.old_value)) * 100;
              const up = diff > 0;
              return (
                <span className={`inline-flex items-center gap-1 font-bold ${up ? "text-success" : "text-destructive"}`}>
                  {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {up ? "+" : ""}{formatEGP(diff)} ({pct.toFixed(1)}%)
                </span>
              );
            }
          },
          {
            key: "changed_by_name", header: "بواسطة", render: (r: any) => (
              <div className="flex flex-col">
                <span className="font-semibold">{r.changed_by_name ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[r.changed_by_role] ?? r.changed_by_role}</span>
              </div>
            )
          },
          { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
          { key: "change_reason", header: "السبب", render: (r: any) => <span className="text-xs">{r.change_reason ?? "—"}</span> },
          { key: "source", header: "المصدر", render: (r: any) => <span className="px-2 py-0.5 rounded text-xs bg-muted">{SOURCE_LABEL[r.source] ?? r.source}</span> },
        ]}
      />
      {shownCount > PAGE && (
        <div className="mt-3 flex justify-center">
          <NumberedPagination page={page} pageCount={Math.max(1, Math.ceil(shownCount / PAGE))} onChange={setPage} disabled={loading} />
        </div>
      )}

    </ConditionalLayout>
  );
}
