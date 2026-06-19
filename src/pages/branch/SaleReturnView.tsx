import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { ArrowRight, Printer } from "lucide-react";
import { printHtml } from "@/lib/export";

const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export default function SaleReturnView() {
  const { id: branchId, returnId } = useParams<{ id: string; returnId: string }>();
  const nav = useNavigate();
  const { tenant } = useAuth();
  const [ret, setRet] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [branch, setBranch] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: r, error: e1 } = await supabase
        .from("returns")
        .select("*, invoices:invoice_id(invoice_number, contacts:contact_id(name, phone, address))")
        .eq("id", returnId!)
        .maybeSingle();
      if (e1 || !r) { setErr("المرتجع غير موجود"); return; }
      setRet(r);
      const { data: it } = await supabase
        .from("return_items")
        .select("*, products(name, sku, selling_price)")
        .eq("return_id", returnId!);
      setItems(it ?? []);
      const { data: b } = await supabase.from("branches").select("*").eq("id", branchId!).maybeSingle();
      setBranch(b);
    })();
  }, [returnId, branchId]);

  if (err) return <BranchLayout><div className="p-8 text-center text-destructive">⚠️ {err}</div></BranchLayout>;
  if (!ret) return <BranchLayout><div className="p-8 text-center">جاري التحميل...</div></BranchLayout>;

  const customer = ret.invoices?.contacts;
  const methodLabel: any = { cash: "نقدي", visa: "فيزا", vodafone_cash: "فودافون كاش", instapay: "انستاباي", bank_transfer: "تحويل بنكي", balance: "خصم من الرصيد" };

  const handlePrint = () => {
    const rowsHtml = items.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(it.products?.name ?? "—")}</td>
        <td>${esc(it.products?.sku ?? "—")}</td>
        <td>${it.quantity}</td>
        <td>${formatEGP(Number(it.refund) / Math.max(1, Number(it.quantity)))}</td>
        <td><b>${formatEGP(it.refund)}</b></td>
      </tr>`).join("");
    const body = `
      <h1>مرتجع بيع ${esc(ret.return_number)}</h1>
      <div class="meta">من فاتورة: ${esc(ret.invoices?.invoice_number ?? "—")} · ${formatDateTime(ret.created_at)}</div>
      <div class="grid-3">
        <div class="card"><h3 style="margin-top:0">الجهة البائعة</h3>
          <div class="row"><span>المؤسسة</span><b>${esc(tenant?.name ?? branch?.name ?? "")}</b></div>
          <div class="row"><span>الفرع</span><b>${esc(branch?.name ?? "—")}</b></div>
        </div>
        <div class="card"><h3 style="margin-top:0">العميل</h3>
          <div class="row"><span>الاسم</span><b>${esc(customer?.name ?? "نقدي")}</b></div>
          ${customer?.phone ? `<div class="row"><span>الهاتف</span><b>${esc(customer.phone)}</b></div>` : ""}
        </div>
        <div class="card"><h3 style="margin-top:0">الاسترداد</h3>
          <div class="row"><span>الطريقة</span><b>${esc(methodLabel[ret.refund_method] ?? ret.refund_method)}</b></div>
          <div class="row"><span>الإجمالي</span><b style="color:#3b82f6">${formatEGP(ret.total_refund)}</b></div>
          ${ret.reason ? `<div class="row"><span>السبب</span><b>${esc(ret.reason)}</b></div>` : ""}
        </div>
      </div>
      <h2>المنتجات المرتجعة (${items.length})</h2>
      <table>
        <thead><tr><th>#</th><th>المنتج</th><th>الكود</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    printHtml(`مرتجع بيع ${ret.return_number}`, body);
  };

  return (
    <BranchLayout>
      <PageHeader
        title={`مرتجع بيع ${ret.return_number}`}
        subtitle={formatDateTime(ret.created_at)}
        actions={
          <div className="flex gap-2 no-print">
            <Button variant="outline" size="sm" onClick={() => nav(`/branch/${branchId}/invoices?tab=sale_return`)} className="gap-2">
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            <Button size="sm" onClick={handlePrint} className="gap-2 btn-gradient">
              <Printer className="w-4 h-4" /> طباعة
            </Button>
          </div>
        }
      />

      <div className="print-area max-w-3xl mx-auto card-elevated p-8 bg-card">
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-border">
          <div className="text-right">
            <div className="text-xs text-muted-foreground mb-1">الجهة البائعة</div>
            <h2 className="text-2xl font-extrabold gradient-text">🏢 {tenant?.name ?? branch?.name}</h2>
            <p className="text-sm font-semibold mt-1">📍 فرع: {branch?.name}</p>
          </div>
          <div className="text-left bg-warning/10 border border-warning/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">رقم المرتجع</div>
            <div className="font-mono font-extrabold text-warning text-lg">{ret.return_number}</div>
            <div className="text-xs text-muted-foreground mt-2">التاريخ</div>
            <div className="text-sm font-bold">{formatDateTime(ret.created_at)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">👤 العميل</div>
            <div className="font-bold">{customer?.name ?? "عميل نقدي"}</div>
            {customer?.phone && <div className="text-xs text-muted-foreground">☎ {customer.phone}</div>}
            {customer?.address && <div className="text-xs text-muted-foreground">📍 {customer.address}</div>}
          </div>
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">🧾 الفاتورة الأصلية</div>
            <div className="font-bold font-mono">{ret.invoices?.invoice_number ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">طريقة الاسترداد: {methodLabel[ret.refund_method] ?? ret.refund_method}</div>
          </div>
        </div>

        <table className="w-full text-sm mb-6 border border-border">
          <thead>
            <tr className="bg-surface-2 border-b-2 border-border">
              <th className="text-right p-2">#</th>
              <th className="text-right p-2">المنتج</th>
              <th className="text-right p-2">الكود</th>
              <th className="text-center p-2">الكمية</th>
              <th className="text-center p-2">سعر الوحدة</th>
              <th className="text-left p-2">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className="border-b border-border">
                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                <td className="p-2 font-medium">{it.products?.name ?? "—"}</td>
                <td className="p-2 text-muted-foreground">{it.products?.sku ?? "—"}</td>
                <td className="text-center p-2">{it.quantity}</td>
                <td className="text-center p-2">{formatEGP(Number(it.refund) / Math.max(1, Number(it.quantity)))}</td>
                <td className="text-left p-2 font-bold">{formatEGP(it.refund)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-2 text-sm border-t-2 border-border pt-3">
          {ret.reason && <div className="flex justify-between"><span>السبب:</span><span className="font-bold">{ret.reason}</span></div>}
          <div className="flex justify-between text-lg pt-2 border-t border-border">
            <span className="font-bold">إجمالي المرتجع:</span>
            <span className="text-warning font-extrabold">{formatEGP(ret.total_refund)}</span>
          </div>
        </div>
      </div>
    </BranchLayout>
  );
}
