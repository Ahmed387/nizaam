import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fetchLedgerPosition, type LedgerPosition } from "@/lib/ledger";
import { fetchAllRows } from "@/lib/fetchAll";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP, formatDate, formatDateTime } from "@/lib/format";
import { exportToExcel } from "@/lib/export";
import {
  ArrowRight,
  Phone,
  MapPin,
  Users,
  Package,
  ShoppingCart,
  Truck,
  Wallet,
  Receipt,
  TrendingUp,
  Download,
  AlertTriangle,
  DollarSign,
} from "lucide-react";
import { EmployeeLink } from "@/components/employees/EmployeeLink";

export default function BranchProfile() {
  const [till, setTill] = useState(0);
  const [batchValue, setBatchValue] = useState(0);
  const [position, setPosition] = useState<LedgerPosition | null>(null);
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [treasury, setTreasury] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    const [
      { data: br },
      { data: emps },
      { data: prods },
      { data: invs },
      { data: ships },
      { data: exps },
      { data: trs },
      { data: rets },
    ] = await Promise.all([
      supabase.from("branches").select("*").eq("id", branchId).maybeSingle(),
      supabase.from("employees").select("*").eq("branch_id", branchId).order("name"),
      fetchAllRows<any>(() => supabase.from("products").select("*").eq("branch_id", branchId).is("archived_at", null).order("quantity").order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("invoices").select("*").eq("branch_id", branchId).order("created_at", { ascending: false }).order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("shipments").select("*, contacts:contact_id(name)").eq("branch_id", branchId).eq("status", "active").order("arrival_date", { ascending: false }).order("id")).then((data) => ({ data })),
      // expenses = payment vouchers whose category is an operating expense (not supplier payments,
      // customer refunds, transfers or advances)
      fetchAllRows<any>(() => supabase.from("vouchers").select("*, voucher_categories!inner(name, is_deductible_from_profit)").eq("branch_id", branchId).eq("type", "payment").eq("status", "active").eq("voucher_categories.is_deductible_from_profit", true).order("voucher_date", { ascending: false }).order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("treasury").select("*").eq("branch_id", branchId).order("created_at", { ascending: false }).order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("returns").select("*").eq("branch_id", branchId).order("created_at", { ascending: false }).order("id")).then((data) => ({ data })),
    ]);
    const cashierIds = [...new Set((invs ?? []).map((r: any) => r.cashier_id).filter(Boolean))];
    const { data: cashiers } = cashierIds.length
      ? await supabase.from("profiles").select("id, name").in("id", cashierIds)
      : { data: [] as any[] };
    const cashierMap = new Map((cashiers ?? []).map((c: any) => [c.id, c.name]));

    setBranch(br);
    setEmployees(emps ?? []);
    setProducts(prods ?? []);
    setInvoices((invs ?? []).map((r: any) => ({ ...r, cashier_name: cashierMap.get(r.cashier_id) ?? "—" })));
    setShipments(ships ?? []);
    setExpenses((exps ?? []).map((v: any) => ({ id: v.id, date: v.voucher_date, amount: v.amount, type: v.voucher_categories?.name ?? "أخرى", description: v.description ?? v.voucher_number })));
    setTreasury(trs ?? []);
    setReturns(rets ?? []);
    const [w, pos] = await Promise.all([
      supabase.rpc("get_branch_wallet_balances", { p_branch_id: branchId! }),
      fetchLedgerPosition(branchId!).catch(() => null),
    ]);
    const wr = Array.isArray(w.data) ? (w.data as any[])[0] : (w.data as any);
    setTill(Number(wr?.total_balance ?? 0));
    setPosition(pos);
    // stock value = quantity on hand × the branch moving average cost (migration 0071)
    setBatchValue(Math.round((prods ?? []).reduce((s: number, p: any) => s + Math.max(0, Number(p.quantity || 0)) * Number(p.avg_cost ?? p.cost_price ?? 0), 0) * 100) / 100);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);
  useRealtimeRefresh(
    ["branches", "employees", "products", "invoices", "shipments", "vouchers", "returns", "treasury", "expenses"],
    () => load()
  );

  const stats = useMemo(() => {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const activeInvoices = invoices.filter((i) => i.status === "active");
    const liveReturns = returns.filter((r) => !["draft", "cancelled"].includes(String(r.status ?? "active")));
    const totalSales = r2(activeInvoices.reduce((s, i) => s + Number(i.total ?? 0), 0));
    const totalRefunds = r2(liveReturns.reduce((s, r) => s + Number(r.total_refund ?? 0), 0));
    const totalShipments = r2(shipments.reduce((s, x) => s + Number(x.total_cost ?? 0), 0));
    const totalExpenses = r2(expenses.reduce((s, x) => s + Number(x.amount ?? 0), 0));
    const cashIn = r2(treasury.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount ?? 0), 0));
    const cashOut = r2(treasury.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount ?? 0), 0));
    const inventoryValue = batchValue;
    const inventoryUnits = products.reduce((s, p) => s + Number(p.quantity ?? 0), 0);
    const lowStock = products.filter((p) => Number(p.low_stock_alert ?? 0) > 0 && Number(p.quantity) <= Number(p.low_stock_alert ?? 0)).length;
    return {
      totalSales, totalRefunds, totalShipments, totalExpenses,
      cashIn, cashOut, safeBalance: till, inventoryValue, inventoryUnits,
      lowStock, invoicesCount: activeInvoices.length,
    };
  }, [invoices, returns, shipments, expenses, treasury, products, till, batchValue]);

  const exportExcel = () => {
    if (!branch) return;
    const summary = [
      { البيان: "اسم الفرع", القيمة: branch.name },
      { البيان: "الكود", القيمة: branch.code },
      { البيان: "العنوان", القيمة: branch.address ?? "—" },
      { البيان: "التليفون", القيمة: branch.phone ?? "—" },
      { البيان: "الحالة", القيمة: branch.is_active ? "نشط" : "موقوف" },
      { البيان: "عدد الموظفين", القيمة: employees.length },
      { البيان: "عدد المنتجات", القيمة: products.length },
      { البيان: "إجمالي وحدات المخزون", القيمة: stats.inventoryUnits },
      { البيان: "قيمة المخزون (تكلفة)", القيمة: stats.inventoryValue },
      { البيان: "منتجات تحت الحد", القيمة: stats.lowStock },
      { البيان: "عدد الفواتير", القيمة: stats.invoicesCount },
      { البيان: "إجمالي المبيعات", القيمة: stats.totalSales },
      { البيان: "إجمالي المرتجعات", القيمة: stats.totalRefunds },
      { البيان: "إجمالي فواتير الشراء", القيمة: stats.totalShipments },
      { البيان: "إجمالي المصاريف", القيمة: stats.totalExpenses },
      { البيان: "الإيداعات في الخزنة", القيمة: stats.cashIn },
      { البيان: "السحوبات من الخزنة", القيمة: stats.cashOut },
      { البيان: "رصيد الخزنة الحالي", القيمة: stats.safeBalance },
      { البيان: "مستحق لنا على العملاء (الفرع)", القيمة: position?.customers?.open ?? 0 },
      { البيان: "مقدمات عملاء (الفرع)", القيمة: position?.customers?.advances ?? 0 },
      { البيان: "مستحق للموردين (الفرع)", القيمة: position?.suppliers?.open ?? 0 },
      { البيان: "مقدمات لينا عند الموردين (الفرع)", القيمة: position?.suppliers?.advances ?? 0 },
    ];
    exportToExcel(`فرع ${branch.name}`, [
      { name: "ملخص", rows: summary },
      { name: "الموظفين", rows: employees.map((e) => ({
        الاسم: e.name, الوظيفة: e.job_title, التليفون: e.phone ?? "—",
        "تاريخ التعيين": e.hire_date, "الراتب الأساسي": Number(e.base_salary ?? 0),
        الحالة: e.is_active ? "نشط" : "موقوف",
      })) },
      { name: "المخزون", rows: products.map((p) => ({
        الصنف: p.name, SKU: p.sku, "الكمية": p.quantity,
        "حد التنبيه": p.low_stock_alert, "سعر التكلفة": Number(p.cost_price),
        "سعر البيع": Number(p.selling_price),
      })) },
      { name: "المبيعات", rows: invoices.map((i) => ({
        "رقم الفاتورة": i.invoice_number, التاريخ: formatDateTime(i.created_at),
        الكاشير: i.profiles?.name ?? "—", الإجمالي: Number(i.total),
        "طريقة الدفع": i.payment_method, الحالة: i.status,
      })) },
      { name: "فواتير الشراء", rows: shipments.map((s) => ({
        التاريخ: s.arrival_date, المورد: s.contacts?.name ?? "—",
        المستلم: s.received_by, "تكلفة فاتورة الشراء": Number(s.total_cost),
      })) },
      { name: "المصاريف", rows: expenses.map((x) => ({
        التاريخ: x.date, النوع: x.type, الوصف: x.description ?? "—", المبلغ: Number(x.amount),
      })) },
      { name: "الخزنة", rows: treasury.map((t) => ({
        التاريخ: formatDateTime(t.created_at), النوع: t.type === "income" ? "إيداع" : "سحب",
        التصنيف: t.category, الوصف: t.description ?? "—", المبلغ: Number(t.amount),
      })) },
    ]);
  };

  if (loading && !branch) {
    return <AdminLayout><div className="text-center py-20 text-muted-foreground">جاري التحميل...</div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <PageHeader
        title={branch?.name ?? "ملف الفرع"}
        subtitle={branch?.code}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportExcel}>
              <Download className="w-4 h-4 ml-1" /> تحميل Excel
            </Button>
            <Button variant="outline" onClick={() => nav(`/branch/${branchId}/dashboard`)}>
              فتح لوحة الفرع
            </Button>
            <Button variant="outline" onClick={() => nav("/admin/branches")}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
          </div>
        }
      />

      {branch && (
        <div className="card-elevated p-5 mb-6 grid md:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-muted-foreground" />
            <span dir="ltr">{branch.phone ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" /> {branch.address ?? "—"}
          </div>
          <div>
            <Badge variant={branch.is_active ? "default" : "secondary"}>
              {branch.is_active ? "نشط" : "موقوف"}
            </Badge>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="المبيعات" value={formatEGP(stats.totalSales)} icon={<ShoppingCart className="w-5 h-5" />} accent="primary" />
        <StatCard label="المرتجعات" value={formatEGP(stats.totalRefunds)} icon={<Receipt className="w-5 h-5" />} accent="warning" />
        <StatCard label="المصاريف التشغيلية" value={formatEGP(stats.totalExpenses)} icon={<DollarSign className="w-5 h-5" />} accent="warning" />
        <StatCard label="فواتير الشراء" value={formatEGP(stats.totalShipments)} icon={<Truck className="w-5 h-5" />} accent="secondary" />
        <StatCard label="رصيد الخزنة" value={formatEGP(stats.safeBalance)} icon={<Wallet className="w-5 h-5" />} accent={stats.safeBalance >= 0 ? "success" : "warning"} />
        <StatCard label="مستحق لنا على العملاء" value={formatEGP(position?.customers?.open ?? 0)} hint={`مستحق للموردين ${formatEGP(position?.suppliers?.open ?? 0)}`} icon={<TrendingUp className="w-5 h-5" />} accent="success" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="الموظفين" value={employees.length} icon={<Users className="w-5 h-5" />} accent="primary" />
        <StatCard label="عدد الأصناف" value={`${products.length} (${stats.inventoryUnits} وحدة)`} icon={<Package className="w-5 h-5" />} accent="primary" />
        <StatCard label="قيمة المخزون (تكلفة الدفعات)" value={formatEGP(stats.inventoryValue)} icon={<Package className="w-5 h-5" />} accent="secondary" />
        <StatCard label="تحت حد التنبيه" value={stats.lowStock} icon={<AlertTriangle className="w-5 h-5" />} accent={stats.lowStock > 0 ? "warning" : "success"} />
      </div>

      <Tabs defaultValue="employees" className="w-full">
        <TabsList className="flex-wrap">
          <TabsTrigger value="employees">الموظفين ({employees.length})</TabsTrigger>
          <TabsTrigger value="inventory">المخزون ({products.length})</TabsTrigger>
          <TabsTrigger value="sales">المبيعات ({invoices.length})</TabsTrigger>
          <TabsTrigger value="shipments">فواتير الشراء ({shipments.length})</TabsTrigger>
          <TabsTrigger value="expenses">المصاريف ({expenses.length})</TabsTrigger>
          <TabsTrigger value="treasury">الخزنة ({treasury.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <DataTable
            rows={employees}
            empty="لا يوجد موظفين"
            columns={[
              { key: "name", header: "الاسم", render: (r: any) => <EmployeeLink id={r.id} name={r.name} /> },
              { key: "job_title", header: "الوظيفة" },
              { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
              { key: "hire_date", header: "تاريخ التعيين", render: (r: any) => formatDate(r.hire_date) },
              { key: "base_salary", header: "الراتب", render: (r: any) => formatEGP(r.base_salary) },
              { key: "is_active", header: "الحالة", render: (r: any) => (
                <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "نشط" : "موقوف"}</Badge>
              )},
            ]}
          />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <DataTable
            rows={products}
            empty="لا يوجد منتجات"
            columns={[
              { key: "name", header: "الصنف", render: (r: any) => <span className="font-semibold">{r.name}</span> },
              { key: "sku", header: "SKU", render: (r: any) => <span className="font-mono text-xs">{r.sku}</span> },
              { key: "quantity", header: "الكمية", render: (r: any) => {
                const low = Number(r.quantity) <= Number(r.low_stock_alert ?? 0);
                return <span className={low ? "text-warning font-bold" : ""}>{r.quantity}</span>;
              }},
              { key: "cost_price", header: "تكلفة", render: (r: any) => formatEGP(r.cost_price) },
              { key: "selling_price", header: "بيع", render: (r: any) => formatEGP(r.selling_price) },
              { key: "value", header: "قيمة المخزون", render: (r: any) => <span className="font-semibold">{formatEGP(Number(r.cost_price) * Number(r.quantity))}</span> },
            ]}
          />
        </TabsContent>

        <TabsContent value="sales" className="mt-4">
          <DataTable
            rows={invoices}
            empty="لا توجد فواتير"
            onRowClick={(r: any) => nav(`/branch/${branchId}/sales/${r.id}`)}
            columns={[
              { key: "invoice_number", header: "رقم الفاتورة", render: (r: any) => <span className="font-mono">{r.invoice_number}</span> },
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
              { key: "cashier", header: "الكاشير", render: (r: any) => r.cashier_name ?? "—" },
              { key: "payment_method", header: "الدفع" },
              { key: "status", header: "الحالة", render: (r: any) => (
                <Badge variant={r.status === "active" ? "default" : "secondary"}>
                  {r.status === "active" ? "سارية" : r.status === "cancelled" ? "ملغاة" : "مرتجعة"}
                </Badge>
              )},
              { key: "total", header: "الإجمالي", render: (r: any) => <span className="font-bold text-success">{formatEGP(r.total)}</span> },
            ]}
          />
        </TabsContent>

        <TabsContent value="shipments" className="mt-4">
          <DataTable
            rows={shipments}
            empty="لا توجد فواتير شراء"
            onRowClick={(r: any) => nav(`/branch/${branchId}/shipments/${r.id}`)}
            columns={[
              { key: "arrival_date", header: "التاريخ", render: (r: any) => formatDate(r.arrival_date) },
              { key: "supplier", header: "المورد", render: (r: any) => r.contacts?.name ?? "—" },
              { key: "received_by", header: "المستلم" },
              { key: "shipping_cost", header: "شحن", render: (r: any) => formatEGP(r.shipping_cost) },
              { key: "total_cost", header: "الإجمالي", render: (r: any) => <span className="font-bold text-warning">{formatEGP(r.total_cost)}</span> },
            ]}
          />
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <DataTable
            rows={expenses}
            empty="لا توجد مصاريف"
            columns={[
              { key: "date", header: "التاريخ", render: (r: any) => formatDate(r.date) },
              { key: "type", header: "النوع" },
              { key: "description", header: "الوصف", render: (r: any) => r.description ?? "—" },
              { key: "amount", header: "المبلغ", render: (r: any) => <span className="font-bold text-warning">{formatEGP(r.amount)}</span> },
            ]}
          />
        </TabsContent>

        <TabsContent value="treasury" className="mt-4">
          <DataTable
            rows={treasury}
            empty="لا توجد حركات"
            columns={[
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
              { key: "type", header: "النوع", render: (r: any) => (
                <Badge variant={r.type === "income" ? "default" : "secondary"} className={r.type === "income" ? "bg-success" : "bg-warning"}>
                  {r.type === "income" ? "إيداع" : "سحب"}
                </Badge>
              )},
              { key: "category", header: "التصنيف" },
              { key: "description", header: "الوصف", render: (r: any) => r.description ?? "—" },
              { key: "amount", header: "المبلغ", render: (r: any) => (
                <span className={`font-bold ${r.type === "income" ? "text-success" : "text-warning"}`}>
                  {r.type === "income" ? "+" : "−"} {formatEGP(r.amount)}
                </span>
              )},
            ]}
          />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
