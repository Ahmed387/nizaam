import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { DollarSign, Wallet, AlertTriangle, UserPlus } from "lucide-react";

export default function BranchDashboard() {
  const { id } = useParams<{ id: string }>();
  const [salesToday, setSalesToday] = useState(0);
  const [treasury, setTreasury] = useState(0);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [newCust, setNewCust] = useState(0);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();
    (async () => {
      const [{ data: inv }, { data: tr }, { data: prods }, { data: custs }, { data: recentInv }] = await Promise.all([
        supabase.from("invoices").select("total").eq("branch_id", id).eq("status", "active").gte("created_at", todayIso),
        supabase.from("treasury").select("type, amount").eq("branch_id", id),
        supabase.from("products").select("id, name, quantity, low_stock_alert").eq("branch_id", id),
        supabase.from("customers").select("id").eq("branch_id", id).gte("created_at", todayIso),
        supabase.from("invoices").select("*, customers(name), profiles!invoices_cashier_id_fkey(name)").eq("branch_id", id).order("created_at", { ascending: false }).limit(5),
      ]);
      setSalesToday((inv ?? []).reduce((s, x) => s + Number(x.total), 0));
      setTreasury((tr ?? []).reduce((s, x) => s + (x.type === "income" ? 1 : -1) * Number(x.amount), 0));
      setLowStock((prods ?? []).filter((p) => p.quantity <= p.low_stock_alert));
      setNewCust((custs ?? []).length);
      setRecent(recentInv ?? []);
    })();
  }, [id]);

  return (
    <BranchLayout>
      <PageHeader title="لوحة الفرع" subtitle="نظرة عامة على نشاط اليوم" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="مبيعات اليوم" value={formatEGP(salesToday)} icon={<DollarSign className="w-5 h-5" />} accent="success" />
        <StatCard label="رصيد الخزنة" value={formatEGP(treasury)} icon={<Wallet className="w-5 h-5" />} accent="primary" />
        <StatCard label="منتجات تحت الحد" value={lowStock.length} icon={<AlertTriangle className="w-5 h-5" />} accent="warning" />
        <StatCard label="عملاء جدد اليوم" value={newCust} icon={<UserPlus className="w-5 h-5" />} accent="secondary" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h3 className="font-bold mb-3">آخر الفواتير</h3>
          <DataTable rows={recent} columns={[
            { key: "invoice_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.invoice_number}</span> },
            { key: "customer", header: "العميل", render: (r: any) => r.customers?.name ?? "نقدي" },
            { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
            { key: "created_at", header: "الوقت", render: (r: any) => formatDateTime(r.created_at) },
          ]} />
        </div>
        <div>
          <h3 className="font-bold mb-3">تنبيهات المخزون</h3>
          <DataTable rows={lowStock} empty="كل المنتجات بمخزون كافٍ ✓"
            columns={[
              { key: "name", header: "المنتج", render: (r: any) => <span className="font-semibold">{r.name}</span> },
              { key: "quantity", header: "المتاح", render: (r: any) => <span className={r.quantity === 0 ? "text-destructive font-bold" : "text-warning font-bold"}>{r.quantity}</span> },
              { key: "low_stock_alert", header: "الحد التنبيهي" },
            ]} />
        </div>
      </div>
    </BranchLayout>
  );
}
