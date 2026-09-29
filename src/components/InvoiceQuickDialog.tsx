import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ArrowUpLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime, toArabicAlphabetIndex } from "@/lib/format";

const PAY: Record<string, string> = { cash: "نقدي", installment: "تقسيط", bank: "بنكي", transfer: "تحويل", credit: "آجل", balance: "رصيد", mixed: "متعدد" };

type Props = { invoiceId: string | null; branchId: string; onClose: () => void };

/** Read-only sale invoice summary shown in a dialog without leaving the page. */
export function InvoiceQuickDialog({ invoiceId, branchId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [paid, setPaid] = useState(0);
  const [cashier, setCashier] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [h, it, pay] = await Promise.all([
        supabase.from("invoices").select("id, invoice_number, invoice_date, created_at, cashier_id, payment_method, subtotal, discount_amount, vat_amount, total, status, contact_id, contacts:contact_id(name)").eq("id", invoiceId).eq("branch_id", branchId).maybeSingle(),
        supabase.from("invoice_items").select("id, product_name, quantity, selling_price, final_price, total").eq("invoice_id", invoiceId),
        supabase.from("invoice_payments").select("amount").eq("invoice_id", invoiceId),
      ]);
      let name: string | null = null;
      const cid = (h.data as any)?.cashier_id;
      if (cid) {
        const p = await supabase.from("profiles").select("name").eq("id", cid).maybeSingle();
        name = (p.data as any)?.name ?? null;
      }
      if (!alive) return;
      setInv(h.data); setItems(it.data ?? []); setCashier(name);
      setPaid((pay.data ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [invoiceId, branchId]);

  const total = Number(inv?.total ?? 0);
  return (
    <Dialog open={!!invoiceId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader><DialogTitle>تفاصيل الفاتورة {inv?.invoice_number ?? ""}</DialogTitle></DialogHeader>
        {loading || !inv ? (
          <div className="p-8 flex justify-center">{loading ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : <span className="text-muted-foreground">الفاتورة غير متاحة</span>}</div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">الرقم: </span><span className="font-mono">{inv.invoice_number}</span></div>
              <div><span className="text-muted-foreground">التاريخ: </span>{formatDateTime(inv.invoice_date ?? inv.created_at)}</div>
              <div><span className="text-muted-foreground">الكاشير: </span>{cashier ?? "—"}</div>
              <div><span className="text-muted-foreground">طريقة الدفع: </span>{PAY[inv.payment_method] ?? inv.payment_method}</div>
              <div className="col-span-2"><span className="text-muted-foreground">العميل: </span>{inv.contacts?.name ?? "—"}</div>
            </div>
            <div className="max-h-72 overflow-auto border rounded-md">
              <table className="w-full">
                <thead className="bg-muted"><tr><th className="p-2 w-10">#</th><th className="p-2 text-right">الصنف</th><th className="p-2">الكمية</th><th className="p-2">السعر</th><th className="p-2">الإجمالي</th></tr></thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2 text-center text-muted-foreground">{toArabicAlphabetIndex(i)}</td>
                      <td className="p-2">{r.product_name}</td>
                      <td className="p-2 text-center tabular-nums">{Number(r.quantity)}</td>
                      <td className="p-2 text-center tabular-nums">{formatEGP(Number(r.final_price ?? r.selling_price ?? 0))}</td>
                      <td className="p-2 text-center tabular-nums font-semibold">{formatEGP(Number(r.total))}</td>
                    </tr>
                  ))}
                  {!items.length && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">لا توجد أصناف</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-md bg-muted p-2"><div className="text-muted-foreground text-xs">الخصم</div><div className="font-bold tabular-nums">{formatEGP(Number(inv.discount_amount || 0))}</div></div>
              <div className="rounded-md bg-muted p-2"><div className="text-muted-foreground text-xs">الإجمالي</div><div className="font-bold tabular-nums">{formatEGP(total)}</div></div>
              <div className="rounded-md bg-muted p-2"><div className="text-muted-foreground text-xs">المدفوع</div><div className="font-bold tabular-nums text-success">{formatEGP(paid)}</div></div>
              <div className="rounded-md bg-muted p-2"><div className="text-muted-foreground text-xs">المتبقي</div><div className="font-bold tabular-nums text-destructive">{formatEGP(Math.max(0, total - paid))}</div></div>
            </div>
            <Link to={`/branch/${branchId}/sales/${inv.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">عرض الفاتورة كاملة <ArrowUpLeft className="w-4 h-4" /></Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
