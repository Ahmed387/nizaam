import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { ArrowRight, Printer, ArrowLeftRight } from "lucide-react";
import { ThermalReceiptPrint, printThermalInvoice } from "@/components/ThermalReceiptPrint";

const statusLabel = (s: string) =>
  ({ pending: "قيد التنفيذ", confirmed: "مستلم", completed: "مكتمل", cancelled: "ملغي", rejected: "مرفوض" } as any)[s] ?? s;

export default function StockTransferView() {
  const { id: branchId, transferId } = useParams<{ id: string; transferId: string }>();
  const nav = useNavigate();
  const { tenant } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<Record<string, any>>({});
  const [products, setProducts] = useState<Record<string, any>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: t, error: e1 } = await supabase.from("stock_transfers").select("*").eq("id", transferId!).maybeSingle();
      if (e1 || !t) { setErr("التحويل غير موجود"); return; }
      let group: any[] = [t];
      if (t.group_id) {
        const { data: g } = await supabase.from("stock_transfers").select("*").eq("group_id", t.group_id).order("created_at");
        if (g && g.length) group = g;
      }
      setRows(group);
      const branchIds = Array.from(new Set(group.flatMap((r) => [r.from_branch_id, r.to_branch_id])));
      const productIds = Array.from(new Set(group.map((r) => r.product_id)));
      const [{ data: bs }, { data: ps }] = await Promise.all([
        supabase.from("branches").select("id, name, address, phone").in("id", branchIds),
        supabase.from("products").select("id, name, sku").in("id", productIds),
      ]);
      const bMap: any = {}; (bs ?? []).forEach((b: any) => { bMap[b.id] = b; }); setBranches(bMap);
      const pMap: any = {}; (ps ?? []).forEach((p: any) => { pMap[p.id] = p; }); setProducts(pMap);
    })();
  }, [transferId]);

  if (err) return <BranchLayout><div className="p-8 text-center text-destructive">⚠️ {err}</div></BranchLayout>;
  if (!rows.length) return <BranchLayout><div className="p-8 text-center">جاري التحميل...</div></BranchLayout>;

  const head = rows[0];
  const fromBranch = branches[head.from_branch_id];
  const toBranch = branches[head.to_branch_id];
  const totalQty = rows.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
  const totalReceived = rows.reduce((s, r) => s + Number(r.received_quantity ?? 0), 0);

  return (
    <BranchLayout>
      <PageHeader
        title={`تحويل مخزون`}
        subtitle={formatDateTime(head.created_at)}
        actions={
          <div className="flex gap-2 no-print">
            <Button variant="outline" size="sm" onClick={() => nav(`/branch/${branchId}/invoices?tab=transfer`)} className="gap-2">
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            <Button size="sm" onClick={printThermalInvoice} className="gap-2 btn-gradient">
              <Printer className="w-4 h-4" /> طباعة
            </Button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto card-elevated p-8 bg-card no-print">
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-border">
          <div className="text-right">
            <div className="text-xs text-muted-foreground mb-1">المؤسسة</div>
            <h2 className="text-2xl font-extrabold gradient-text">🏢 {tenant?.name ?? "—"}</h2>
          </div>
          <div className="text-left bg-primary/10 border border-primary/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">رقم التحويل</div>
            <div className="font-mono font-extrabold text-primary text-lg">#{head.id.slice(0, 8)}</div>
            <div className="text-xs text-muted-foreground mt-2">التاريخ</div>
            <div className="text-sm font-bold">{formatDateTime(head.created_at)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 items-stretch">
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">📤 من فرع</div>
            <div className="font-bold text-lg">{fromBranch?.name ?? "—"}</div>
            {fromBranch?.address && <div className="text-xs text-muted-foreground">📍 {fromBranch.address}</div>}
            {fromBranch?.phone && <div className="text-xs text-muted-foreground">☎ {fromBranch.phone}</div>}
          </div>
          <div className="bg-surface-2 rounded-lg p-3 border border-border relative">
            <div className="absolute top-1/2 -right-6 -translate-y-1/2 bg-primary text-primary-foreground rounded-full p-1.5 no-print">
              <ArrowLeftRight className="w-4 h-4" />
            </div>
            <div className="text-xs text-muted-foreground mb-1">📥 إلى فرع</div>
            <div className="font-bold text-lg">{toBranch?.name ?? "—"}</div>
            {toBranch?.address && <div className="text-xs text-muted-foreground">📍 {toBranch.address}</div>}
            {toBranch?.phone && <div className="text-xs text-muted-foreground">☎ {toBranch.phone}</div>}
          </div>
        </div>

        <table className="w-full text-sm mb-6 border border-border">
          <thead>
            <tr className="bg-surface-2 border-b-2 border-border">
              <th className="text-right p-2">#</th>
              <th className="text-right p-2">المنتج</th>
              <th className="text-right p-2">الكود</th>
              <th className="text-center p-2">الكمية المرسلة</th>
              <th className="text-center p-2">المستلمة</th>
              <th className="text-center p-2">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const p = products[r.product_id];
              return (
                <tr key={r.id} className="border-b border-border">
                  <td className="p-2 text-muted-foreground">{idx + 1}</td>
                  <td className="p-2 font-medium">{p?.name ?? "—"}</td>
                  <td className="p-2 text-muted-foreground">{p?.sku ?? "—"}</td>
                  <td className="text-center p-2">{r.quantity}</td>
                  <td className="text-center p-2">{r.received_quantity ?? "—"}</td>
                  <td className="text-center p-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      r.status === "confirmed" || r.status === "completed" ? "bg-success/10 text-success" :
                      r.status === "rejected" || r.status === "cancelled" ? "bg-destructive/10 text-destructive" :
                      "bg-warning/10 text-warning"
                    }`}>{statusLabel(r.status)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2 font-bold">
              <td colSpan={3} className="p-2 text-right">الإجمالي</td>
              <td className="text-center p-2">{totalQty}</td>
              <td className="text-center p-2">{totalReceived || "—"}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        {head.reason && (
          <div className="bg-surface-2 rounded-lg p-3 border border-border text-sm">
            <span className="text-muted-foreground">السبب: </span>
            <span className="font-bold">{head.reason}</span>
          </div>
        )}
      </div>

      <ThermalReceiptPrint
        kind="stock_transfer"
        branchName={fromBranch?.name}
        invoiceNumber={`#${head.id.slice(0, 8)}`}
        createdAt={head.created_at}
        cashier={null}
        partyName={null}
        notes={null}
        reason={head.reason}
        fromBranchName={fromBranch?.name ?? "—"}
        toBranchName={toBranch?.name ?? "—"}
        items={rows.map((r: any) => ({
          name: products[r.product_id]?.name ?? "—",
          qty: Number(r.quantity ?? 0),
          unit_price: 0,
          total: 0,
          received: r.received_quantity != null ? Number(r.received_quantity) : undefined,
        }))}
        subtotal={0}
        total={0}
      />
    </BranchLayout>
  );
}
