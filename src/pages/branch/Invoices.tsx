import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate, formatDateTime } from "@/lib/format";
import { Plus, ShoppingCart, PackagePlus, RotateCcw, Undo2, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, FileText, ClipboardList, FileSpreadsheet, Printer } from "lucide-react";
import { exportToExcel, printReport } from "@/lib/export";

type TabKey = "sale" | "purchase" | "sale_return" | "purchase_return" | "income" | "expense" | "transfer" | "quote" | "adjustment";

const TABS: { key: TabKey; label: string; icon: any; color: string }[] = [
  { key: "sale", label: "فواتير البيع", icon: ShoppingCart, color: "text-success" },
  { key: "purchase", label: "فواتير الشراء", icon: PackagePlus, color: "text-primary" },
  { key: "sale_return", label: "مرتجع بيع", icon: RotateCcw, color: "text-warning" },
  { key: "purchase_return", label: "مرتجع شراء", icon: Undo2, color: "text-warning" },
  { key: "income", label: "سندات القبض", icon: ArrowDownCircle, color: "text-success" },
  { key: "expense", label: "سندات الصرف", icon: ArrowUpCircle, color: "text-destructive" },
  { key: "transfer", label: "تحويل المخازن", icon: ArrowLeftRight, color: "text-primary" },
  { key: "quote", label: "عروض الأسعار", icon: FileText, color: "text-secondary" },
  { key: "adjustment", label: "تسوية المخزن", icon: ClipboardList, color: "text-muted-foreground" },
];

export default function Invoices() {
  const { id: branchId } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const tab = (params.get("tab") as TabKey) || "sale";
  const setTab = (k: string) => setParams({ tab: k });

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    (async () => {
      let data: any[] = [];
      if (tab === "sale") {
        const r = await supabase.from("invoices").select("*, customers(name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      } else if (tab === "purchase") {
        const r = await supabase.from("shipments").select("*, suppliers(company_name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      } else if (tab === "sale_return") {
        const r = await supabase.from("returns").select("*, invoices(invoice_number)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      } else if (tab === "purchase_return") {
        const r = await supabase.from("purchase_returns" as any).select("*, suppliers(company_name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      } else if (tab === "income") {
        const r = await supabase.from("treasury").select("*").eq("branch_id", branchId).eq("type", "income").order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      } else if (tab === "expense") {
        const r = await supabase.from("treasury").select("*").eq("branch_id", branchId).eq("type", "expense").order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      } else if (tab === "transfer") {
        const r = await supabase.from("stock_transfers").select("*").or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`).order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      } else if (tab === "quote") {
        const r = await supabase.from("quotes" as any).select("*, customers(name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      } else if (tab === "adjustment") {
        const r = await supabase.from("stock_adjustments" as any).select("*").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200);
        data = r.data ?? [];
      }
      setRows(data);
      setLoading(false);
    })();
  }, [tab, branchId]);

  const cfg = useMemo(() => {
    const base = `/branch/${branchId}`;
    switch (tab) {
      case "sale": return {
        newLink: `${base}/sales/new`, newLabel: "فاتورة بيع جديدة",
        columns: [
          { key: "invoice_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.invoice_number}</span> },
          { key: "customer", header: "العميل", render: (r: any) => r.customers?.name ?? "نقدي" },
          { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
          { key: "status", header: "الحالة", render: (r: any) => r.status === "active" ? "نشطة" : "ملغاة" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
        onClick: (r: any) => nav(`${base}/sales/${r.id}`),
      };
      case "purchase": return {
        newLink: `${base}/shipments/new`, newLabel: "شحنة شراء جديدة",
        columns: [
          { key: "supplier", header: "المورد", render: (r: any) => r.suppliers?.company_name ?? "—" },
          { key: "received_by", header: "استلم بواسطة" },
          { key: "arrival_date", header: "تاريخ الوصول", render: (r: any) => formatDate(r.arrival_date) },
          { key: "total_cost", header: "الإجمالي", render: (r: any) => formatEGP(r.total_cost) },
        ],
        onClick: (r: any) => nav(`${base}/shipments/${r.id}`),
      };
      case "sale_return": return {
        newLink: `${base}/sales/returns/new`, newLabel: "مرتجع بيع جديد",
        columns: [
          { key: "inv", header: "رقم الفاتورة", render: (r: any) => r.invoices?.invoice_number ?? "—" },
          { key: "reason", header: "السبب" },
          { key: "total_refund", header: "المرتجع", render: (r: any) => formatEGP(r.total_refund) },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "purchase_return": return {
        newLink: `${base}/purchase-returns/new`, newLabel: "مرتجع شراء جديد",
        columns: [
          { key: "return_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.return_number}</span> },
          { key: "supplier", header: "المورد", render: (r: any) => r.suppliers?.company_name ?? "—" },
          { key: "reason", header: "السبب" },
          { key: "total_amount", header: "الإجمالي", render: (r: any) => formatEGP(r.total_amount) },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "income":
      case "expense": return {
        newLink: `${base}/treasury`, newLabel: tab === "income" ? "سند قبض جديد" : "سند صرف جديد",
        columns: [
          { key: "description", header: "البيان" },
          { key: "amount", header: "المبلغ", render: (r: any) => formatEGP(r.amount) },
          { key: "category", header: "التصنيف" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "transfer": return {
        newLink: `${base}/transfers`, newLabel: "تحويل مخازن جديد",
        columns: [
          { key: "from_branch_id", header: "من" },
          { key: "to_branch_id", header: "إلى" },
          { key: "status", header: "الحالة" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "quote": return {
        newLink: `${base}/quotes/new`, newLabel: "عرض سعر جديد",
        columns: [
          { key: "quote_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.quote_number}</span> },
          { key: "customer", header: "العميل", render: (r: any) => r.customers?.name ?? r.customer_name ?? "—" },
          { key: "total", header: "الإجمالي", render: (r: any) => formatEGP(r.total) },
          { key: "valid_until", header: "صالح حتى", render: (r: any) => r.valid_until ? formatDate(r.valid_until) : "—" },
          { key: "status", header: "الحالة" },
        ],
      };
      case "adjustment": return {
        newLink: `${base}/adjustments/new`, newLabel: "تسوية مخزن جديدة",
        columns: [
          { key: "adjustment_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.adjustment_number}</span> },
          { key: "reason", header: "السبب" },
          { key: "notes", header: "ملاحظات" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
    }
  }, [tab, branchId, nav]);

  return (
    <BranchLayout>
      <PageHeader
        title="الفواتير والمستندات"
        subtitle="كل فواتير ومستندات الفرع في مكان واحد"
        actions={
          <Button asChild className="gap-2">
            <Link to={cfg.newLink}><Plus className="w-4 h-4" /> {cfg.newLabel}</Link>
          </Button>
        }
      />

      {/* Quick action grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
              tab === t.key ? "border-primary bg-primary/5 shadow-md" : "border-border hover:border-primary/50"
            }`}>
            <t.icon className={`w-5 h-5 ${t.color}`} />
            <span className="text-[11px] font-semibold text-center leading-tight">{t.label}</span>
          </button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="text-xs">{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTable
        loading={loading}
        rows={rows}
        onRowClick={cfg.onClick}
        empty="لا توجد سجلات"
        columns={cfg.columns as any}
      />
    </BranchLayout>
  );
}
