import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";

export default function NewReturn() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const nav = useNavigate();

  const [invSearch, setInvSearch] = useState("");
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  const findInvoice = async () => {
    if (!invSearch.trim()) return;
    setSearching(true);
    const { data } = await supabase
      .from("invoices")
      .select("*, customers(name)")
      .eq("branch_id", branchId!)
      .eq("invoice_number", invSearch.trim())
      .maybeSingle();
    if (!data) {
      toast.error("لم يتم العثور على الفاتورة");
      setInvoice(null);
      setItems([]);
    } else if (data.status !== "active") {
      toast.error("لا يمكن إرجاع فاتورة ملغاة");
      setInvoice(null);
    } else {
      setInvoice(data);
      const { data: it } = await supabase.from("invoice_items").select("*").eq("invoice_id", data.id);
      setItems(it ?? []);
      setQty({});
    }
    setSearching(false);
  };

  const totalRefund = items.reduce((s, it) => {
    const q = qty[it.id] || 0;
    return s + q * Number(it.selling_price);
  }, 0);

  const submit = async () => {
    if (!invoice) return;
    if (!reason.trim()) return toast.error("اذكر سبب الإرجاع");
    const selected = items.filter((it) => (qty[it.id] || 0) > 0);
    if (!selected.length) return toast.error("حدد كمية لمنتج واحد على الأقل");
    for (const it of selected) {
      if ((qty[it.id] || 0) > it.quantity) return toast.error(`الكمية المُرجعة من "${it.product_name}" تتجاوز المباع`);
    }

    setBusy(true);
    try {
      const { data: ret, error } = await supabase
        .from("returns")
        .insert({
          branch_id: branchId!,
          invoice_id: invoice.id,
          reason: reason.trim(),
          total_refund: totalRefund,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;

      for (const it of selected) {
        const q = qty[it.id];
        await supabase.from("return_items").insert({
          return_id: ret.id,
          product_id: it.product_id,
          quantity: q,
          refund: q * Number(it.selling_price),
        });
        // Restore stock
        if (it.product_id) {
          const { data: p } = await supabase.from("products").select("quantity").eq("id", it.product_id).maybeSingle();
          if (p) await supabase.from("products").update({ quantity: (p.quantity ?? 0) + q }).eq("id", it.product_id);
        }
      }

      // Treasury expense (refund out)
      await supabase.from("treasury").insert({
        branch_id: branchId!,
        type: "expense",
        category: "return",
        amount: totalRefund,
        description: `مرتجع فاتورة ${invoice.invoice_number}`,
        reference_id: ret.id,
        created_by: user!.id,
      });

      await logAudit({
        userId: user!.id,
        userName: profile?.name ?? "",
        branchId,
        action: "CREATE",
        entity: "return",
        entityId: ret.id,
        details: { invoice: invoice.invoice_number, total: totalRefund },
      });

      toast.success("تم تسجيل المرتجع");
      nav(`/branch/${branchId}/sales/returns`);
    } catch (err: any) {
      toast.error(err.message ?? "فشل حفظ المرتجع");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BranchLayout>
      <PageHeader title="مرتجع جديد" subtitle="إرجاع منتجات من فاتورة" />

      <div className="card-elevated p-4 mb-4">
        <Label>رقم الفاتورة</Label>
        <div className="flex gap-2 mt-1">
          <Input
            placeholder="مثال: INV-2026-00001"
            value={invSearch}
            onChange={(e) => setInvSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && findInvoice()}
          />
          <Button onClick={findInvoice} disabled={searching} className="gap-2">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            بحث
          </Button>
        </div>
      </div>

      {invoice && (
        <>
          <div className="card-elevated p-4 mb-4 grid md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-muted-foreground">رقم الفاتورة</div><b>{invoice.invoice_number}</b></div>
            <div><div className="text-muted-foreground">التاريخ</div><b>{formatDateTime(invoice.created_at)}</b></div>
            <div><div className="text-muted-foreground">العميل</div><b>{invoice.customers?.name ?? "نقدي"}</b></div>
            <div><div className="text-muted-foreground">الإجمالي</div><b className="text-primary">{formatEGP(invoice.total)}</b></div>
          </div>

          <div className="card-elevated overflow-hidden mb-4">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead><tr className="bg-surface-2 border-b border-border">
                <th className="px-4 py-2 text-right">المنتج</th>
                <th className="px-4 py-2 text-right">المباع</th>
                <th className="px-4 py-2 text-right">سعر الوحدة</th>
                <th className="px-4 py-2 text-right">كمية الإرجاع</th>
                <th className="px-4 py-2 text-right">قيمة الإرجاع</th>
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-border">
                    <td className="px-4 py-2">{it.product_name}</td>
                    <td className="px-4 py-2">{it.quantity}</td>
                    <td className="px-4 py-2">{formatEGP(it.selling_price)}</td>
                    <td className="px-4 py-2 w-32">
                      <Input
                        type="number"
                        min={0}
                        max={it.quantity}
                        value={qty[it.id] ?? 0}
                        onChange={(e) => setQty({ ...qty, [it.id]: Math.min(Number(e.target.value), it.quantity) })}
                      />
                    </td>
                    <td className="px-4 py-2 font-bold text-destructive">{formatEGP((qty[it.id] || 0) * Number(it.selling_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

          </div>

          <div className="card-elevated p-4 grid md:grid-cols-3 gap-4 items-end">
            <div className="md:col-span-2">
              <Label>سبب الإرجاع *</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="منتج معيب / لم يعجب العميل / ..." />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-lg">
                <span>إجمالي الإرجاع</span>
                <b className="text-destructive">{formatEGP(totalRefund)}</b>
              </div>
              <Button onClick={submit} disabled={busy || totalRefund === 0} className="w-full gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                تأكيد المرتجع
              </Button>
            </div>
          </div>
        </>
      )}
    </BranchLayout>
  );
}
