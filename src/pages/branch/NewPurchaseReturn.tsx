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

interface Line { product_id: string; product_name: string; quantity: number; unit_cost: number; max_qty: number; }

export default function NewPurchaseReturn() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from("suppliers").select("id, name").eq("branch_id", branchId).order("name"),
        supabase.from("products").select("id, name, quantity, cost_price").eq("branch_id", branchId).gt("quantity", 0).order("name"),
      ]);
      setSuppliers(s.data ?? []);
      setProducts(p.data ?? []);
    })();
  }, [branchId]);

  const addLine = () => setLines([...lines, { product_id: "", product_name: "", quantity: 1, unit_cost: 0, max_qty: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const onProduct = (i: number, pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    updateLine(i, { product_id: pid, product_name: p.name, unit_cost: Number(p.cost_price), max_qty: p.quantity });
  };

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

  const submit = async () => {
    if (!supplierId) return toast.error("اختر المورد");
    if (!reason.trim()) return toast.error("اكتب السبب");
    if (lines.length === 0) return toast.error("أضف منتج واحد على الأقل");
    for (const l of lines) {
      if (!l.product_id) return toast.error("اختر منتج لكل سطر");
      if (l.quantity > l.max_qty) return toast.error(`الكمية أكبر من المتاح للمنتج ${l.product_name}`);
    }
    setBusy(true);
    const number = `PR-${Date.now().toString(36).toUpperCase()}`;
    const { data: pr, error } = await supabase.from("purchase_returns" as any).insert({
      branch_id: branchId, supplier_id: supplierId, return_number: number,
      reason: reason.trim(), notes: notes.trim() || null, created_by: user!.id, total_amount: 0,
    }).select().single();
    if (error || !pr) { setBusy(false); return toast.error(error?.message ?? "فشل الحفظ"); }
    const items = lines.map((l) => ({
      purchase_return_id: (pr as any).id, product_id: l.product_id, product_name: l.product_name,
      quantity: l.quantity, unit_cost: l.unit_cost, total: l.quantity * l.unit_cost,
    }));
    const { error: e2 } = await supabase.from("purchase_return_items" as any).insert(items);
    if (e2) { setBusy(false); return toast.error(e2.message); }
    toast.success("تم تسجيل مرتجع الشراء وخصم المخزون");
    nav(`/branch/${branchId}/invoices?tab=purchase_return`);
  };

  return (
    <BranchLayout>
      <PageHeader title="مرتجع شراء جديد" subtitle="إرجاع بضاعة إلى المورد" />
      <div className="space-y-4 card-elevated p-5">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>المورد *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر المورد" /></SelectTrigger>
              <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>السبب *</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="منتج تالف / خطأ في الطلب..." className="mt-1.5" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>المنتجات المُرتجعة</Label>
            <Button size="sm" variant="outline" onClick={addLine} className="gap-1"><Plus className="w-3 h-3" /> إضافة</Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 border rounded">
                <div className="col-span-5">
                  <Select value={l.product_id} onValueChange={(v) => onProduct(i, v)}>
                    <SelectTrigger><SelectValue placeholder="منتج" /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} (متاح: {p.quantity})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Input type="number" min={1} max={l.max_qty} value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} placeholder="كمية" />
                </div>
                <div className="col-span-3">
                  <Input type="number" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: Number(e.target.value) })} placeholder="السعر" />
                </div>
                <div className="col-span-1 text-sm text-muted-foreground text-center">{formatEGP(l.quantity * l.unit_cost)}</div>
                <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label>ملاحظات</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          <div className="text-lg">الإجمالي: <span className="font-bold text-primary">{formatEGP(total)}</span></div>
          <Button onClick={submit} disabled={busy} size="lg">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ مرتجع الشراء"}
          </Button>
        </div>
      </div>
    </BranchLayout>
  );
}
