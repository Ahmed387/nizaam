import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Printer, X } from "lucide-react";

export default function InvoiceView() {
  const { id, invoiceId } = useParams<{ id: string; invoiceId: string }>();
  const { user, profile, hasRole, isAdmin } = useAuth();
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [branch, setBranch] = useState<any>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    (async () => {
      const { data: i } = await supabase.from("invoices").select("*, customers(name, phone), profiles!invoices_cashier_id_fkey(name)").eq("id", invoiceId).single();
      setInv(i);
      const { data: its } = await supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId);
      setItems(its ?? []);
      const { data: b } = await supabase.from("branches").select("*").eq("id", id).single();
      setBranch(b);
    })();
  }, [invoiceId, id]);

  const cancel = async () => {
    if (!reason.trim()) return toast.error("سبب الإلغاء مطلوب");
    await supabase.from("invoices").update({ status: "cancelled", cancel_reason: reason }).eq("id", invoiceId);
    // Restore stock
    for (const it of items) {
      const { data: p } = await supabase.from("products").select("quantity").eq("id", it.product_id).single();
      if (p) await supabase.from("products").update({ quantity: p.quantity + it.quantity }).eq("id", it.product_id);
    }
    // Reverse treasury
    await supabase.from("treasury").insert({
      branch_id: id!, type: "expense", category: "sales", amount: inv.total,
      description: `إلغاء فاتورة ${inv.invoice_number}`, reference_id: invoiceId, created_by: user!.id,
    });
    await logAudit({ userId: user!.id, userName: profile!.name, branchId: id, action: "CANCEL", entity: "Invoice", entityId: invoiceId, details: { reason } });
    toast.success("تم إلغاء الفاتورة");
    setCancelOpen(false);
    location.reload();
  };

  if (!inv) return <BranchLayout><div className="p-8 text-center">جاري التحميل...</div></BranchLayout>;

  const canCancel = (isAdmin || hasRole("branch_manager")) && inv.status === "active";

  return (
    <BranchLayout>
      <PageHeader title={`فاتورة ${inv.invoice_number}`}
        actions={
          <div className="flex gap-2">
            {canCancel && <Button variant="outline" onClick={() => setCancelOpen(true)}><X className="w-4 h-4 ml-1" /> إلغاء</Button>}
            <Button className="btn-gradient" onClick={() => window.print()}><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
          </div>
        }
      />

      <div className="print-area max-w-2xl mx-auto card-elevated p-8 bg-card">
        <div className="text-center mb-6 pb-4 border-b border-border">
          <h2 className="text-2xl font-extrabold gradient-text">🏪 {branch?.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{branch?.address} {branch?.phone && `| ${branch.phone}`}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-6">
          <div><span className="text-muted-foreground">رقم الفاتورة:</span> <span className="font-mono font-bold text-primary">{inv.invoice_number}</span></div>
          <div><span className="text-muted-foreground">التاريخ:</span> {formatDateTime(inv.created_at)}</div>
          <div><span className="text-muted-foreground">الكاشير:</span> {inv.profiles?.name}</div>
          <div><span className="text-muted-foreground">العميل:</span> {inv.customers?.name ?? "نقدي"}</div>
        </div>

        <table className="w-full text-sm mb-6">
          <thead><tr className="border-b-2 border-border"><th className="text-right py-2">المنتج</th><th className="text-center py-2">الكمية</th><th className="text-center py-2">السعر</th><th className="text-left py-2">الإجمالي</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-border">
                <td className="py-2">{it.product_name}</td>
                <td className="text-center py-2">{it.quantity}</td>
                <td className="text-center py-2">{formatEGP(it.selling_price)}</td>
                <td className="text-left py-2 font-bold">{formatEGP(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-2 text-sm border-t-2 border-border pt-3">
          <div className="flex justify-between"><span>الإجمالي قبل الخصم:</span><span className="font-bold">{formatEGP(inv.subtotal)}</span></div>
          {Number(inv.discount_amount) > 0 && (
            <div className="flex justify-between text-destructive"><span>خصم ({inv.discount_percent}%):</span><span className="font-bold">- {formatEGP(inv.discount_amount)}</span></div>
          )}
          <div className="flex justify-between text-lg pt-2 border-t border-border"><span className="font-bold">الإجمالي النهائي:</span><span className="text-primary font-extrabold">{formatEGP(inv.total)}</span></div>
        </div>

        {inv.status === "cancelled" && (
          <div className="mt-4 p-3 bg-destructive/15 border border-destructive/30 rounded-lg text-center text-destructive font-bold">
            ❌ ملغاة - {inv.cancel_reason}
          </div>
        )}

        <div className="text-center mt-8 text-sm text-muted-foreground">شكراً لتعاملكم معنا 🙏</div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>إلغاء الفاتورة</DialogTitle></DialogHeader>
          <Textarea placeholder="سبب الإلغاء *" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>تراجع</Button>
            <Button variant="destructive" onClick={cancel}>تأكيد الإلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
