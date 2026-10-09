import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PermGate } from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { fetchDocumentStatus } from "@/lib/ledger";
import { formatEGP, formatDateTime } from "@/lib/format";
import { Plus, RotateCcw, BookmarkPlus } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { EditableInvoiceDate } from "@/components/EditableInvoiceDate";
import {
  PaymentStatusBadge,
  PaymentStatusRibbon,
  computePayState,
} from "@/components/PaymentStatusBadge";

export default function SalesHistory() {
  const { id } = useParams<{ id: string }>();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    // `customers` was dropped long ago (the old select failed and the page stayed empty) — contacts now.
    const data = await fetchAllRows<any>(() => supabase
      .from("invoices")
      .select("*, contacts:contact_id(name)")
      .eq("branch_id", id)
      .order("created_at", { ascending: false })
      .order("id")).catch(() => [] as any[]);
    const cashierIds = [...new Set(data.map((r: any) => r.cashier_id).filter(Boolean))];
    const [cashiersRes, st] = await Promise.all([
      cashierIds.length
        ? supabase.from("profiles").select("id, name").in("id", cashierIds)
        : Promise.resolve({ data: [] as any[] } as any),
      // paid = unified ledger (direct payments, FIFO of general payments / deposits, return credit)
      fetchDocumentStatus("invoice", data.filter((r: any) => r.status === "active").map((r: any) => r.id)).catch(() => new Map()),
    ]);
    const cashierMap = new Map((cashiersRes.data ?? []).map((c: any) => [c.id, c.name]));
    setRows(
      data.map((r: any) => {
        const paid = st.get(r.id)?.paid ?? 0;
        return {
          ...r,
          customers: r.contacts ?? null,
          cashier_name: cashierMap.get(r.cashier_id) ?? "—",
          paid_amount_now: paid,
          pay_state: computePayState(Number(r.total || 0), paid),
        };
      })
    );
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtimeRefresh(
    ["invoices", "invoice_payments", "payment_plans", "payment_transactions"],
    load
  );

  return (
    <BranchLayout>
      <PageHeader
        title="سجل المبيعات"
        actions={
          <div className="flex gap-2 flex-wrap">
            <PermGate perm="preorders.view">
              <Link to={`/branch/${id}/pre-orders`}>
                <Button variant="outline"><BookmarkPlus className="w-4 h-4 ml-1" /> طلبات الحجز</Button>
              </Link>
            </PermGate>
            <PermGate perm="sales.view">
              <Link to={`/branch/${id}/sales/returns`}>
                <Button variant="outline"><RotateCcw className="w-4 h-4 ml-1" /> مرتجعات</Button>
              </Link>
            </PermGate>
            <PermGate perm="sales.create">
              <Link to={`/branch/${id}/sales/new`}>
                <Button className="btn-gradient"><Plus className="w-4 h-4 ml-1" /> فاتورة جديدة</Button>
              </Link>
            </PermGate>
          </div>
        }
      />
      <DataTable
        loading={loading}
        rows={rows}
        onRowClick={(r: any) => window.location.assign(`/branch/${id}/sales/${r.id}`)}
        columns={[
          {
            key: "invoice_number",
            header: "رقم",
            render: (r: any) => (
              <div className="flex items-stretch gap-2 min-h-[1.75rem]">
                {r.status === "active" && <PaymentStatusRibbon state={r.pay_state} />}
                <span className="font-mono text-primary font-bold self-center">{r.invoice_number}</span>
              </div>
            ),
          },
          { key: "customer", header: "العميل", render: (r: any) => r.customers?.name ?? "نقدي" },
          { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
          {
            key: "pay_state",
            header: "حالة الدفع",
            render: (r: any) =>
              r.status === "active" ? (
                <PaymentStatusBadge
                  state={r.pay_state}
                  total={Number(r.total || 0)}
                  paid={Number(r.paid_amount_now || 0)}
                  compact
                />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          },
          {
            key: "discount_amount",
            header: "الخصم",
            render: (r: any) => (Number(r.discount_amount) > 0 ? formatEGP(r.discount_amount) : "—"),
          },
          { key: "cashier", header: "الكاشير", render: (r: any) => r.cashier_name ?? "—" },
          {
            key: "invoice_date",
            header: "تاريخ الفاتورة",
            render: (r: any) => (
              <EditableInvoiceDate
                table="invoices"
                recordId={r.id}
                value={r.invoice_date}
                fallback={r.created_at}
              />
            ),
          },
          {
            key: "status",
            header: "الحالة",
            render: (r: any) => (
              <span
                className={`px-2 py-1 rounded text-xs ${
                  r.status === "active"
                    ? "bg-success/15 text-success"
                    : "bg-destructive/15 text-destructive"
                }`}
              >
                {r.status === "active" ? "نشطة" : "ملغاة"}
              </span>
            ),
          },
        ]}
      />
    </BranchLayout>
  );
}
