import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";

interface Line { product_id: string; product_name: string; quantity: number; unit_price: number; }

export default function NewQuote() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("contacts").select("id, name").eq("branch_id", branchId).order("name"),
        supabase.from("products").select("id, name, selling_price").eq("branch_id", branchId).order("name"),
      ]);
      setCustomers(c.data ?? []);
      setProducts(p.data ?? []);
    })();
  }, [branchId]);

  const addLine = () => setLines([...lines, { product_id: "", product_name: "", quantity: 1, unit_price: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const onProduct = (i: number, pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    updateLine(i, { product_id: pid, product_name: p.name, unit_price: Number(p.selling_price) });
  };

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const total = Math.max(0, subtotal - discount);

  const submit = async () => {
    if (lines.length === 0) return toast.error("أضف منتج واحد على الأقل");
    for (const l of lines) if (!l.product_id) return toast.error("اختر منتج لكل سطر");
    setBusy(true);
    const number = `Q-${Date.now().toString(36).toUpperCase()}`;
    const { data: q, error } = await supabase.from("quotes" as any).insert({
      branch_id: branchId, contact_id: customerId || null, customer_name: customerName || null,
      quote_number: number, subtotal, discount, total,
      valid_until: validUntil || null, notes: notes.trim() || null,
      created_by: user!.id, status: "draft",
    }).select().single();
    if (error || !q) { setBusy(false); return toast.error(error?.message ?? "فشل الحفظ"); }
    const items = lines.map((l) => ({
      quote_id: (q as any).id, product_id: l.product_id, product_name: l.product_name,
      quantity: l.quantity, unit_price: l.unit_price, total: l.quantity * l.unit_price,
    }));
    const { error: e2 } = await supabase.from("quote_items" as any).insert(items);
    if (e2) { setBusy(false); return toast.error(e2.message); }
    toast.success("تم حفظ عرض السعر");
    nav(`/branch/${branchId}/invoices?tab=quote`);
  };

  return (
    <BranchLayout>
      <PageHeader title="عرض سعر جديد" subtitle="عرض غير ملزم (لا يؤثر على المخزون)" />
      <div className="space-y-4 card-elevated p-5">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <Label>العميل</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر عميل" /></SelectTrigger>
              <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>أو اسم عميل (بدون تسجيل)</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label>صالح حتى</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="mt-1.5" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>المنتجات</Label>
            <Button size="sm" variant="outline" onClick={addLine} className="gap-1"><Plus className="w-3 h-3" /> إضافة</Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 border rounded">
                <div className="col-span-5">
                  <Select value={l.product_id} onValueChange={(v) => onProduct(i, v)}>
                    <SelectTrigger><SelectValue placeholder="منتج" /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Input type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} /></div>
                <div className="col-span-3"><Input type="number" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) })} /></div>
                <div className="col-span-1 text-sm text-muted-foreground text-center">{formatEGP(l.quantity * l.unit_price)}</div>
                <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>خصم</Label>
            <Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="mt-1.5" />
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          <div className="text-sm space-y-1">
            <div>المجموع: {formatEGP(subtotal)}</div>
            <div className="text-lg">الإجمالي: <span className="font-bold text-primary">{formatEGP(total)}</span></div>
          </div>
          <Button onClick={submit} disabled={busy} size="lg">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ عرض السعر"}
          </Button>
        </div>
      </div>
    </BranchLayout>
  );
}
