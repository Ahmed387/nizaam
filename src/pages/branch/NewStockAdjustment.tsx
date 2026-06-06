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
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";

interface Line {
  product_id: string; product_name: string;
  system_quantity: number; actual_quantity: number; unit_cost: number;
}

export default function NewStockAdjustment() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const { data } = await supabase.from("products").select("id, name, quantity, cost_price").eq("branch_id", branchId).order("name");
      setProducts(data ?? []);
    })();
  }, [branchId]);

  const addLine = () => setLines([...lines, { product_id: "", product_name: "", system_quantity: 0, actual_quantity: 0, unit_cost: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const onProduct = (i: number, pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    updateLine(i, { product_id: pid, product_name: p.name, system_quantity: p.quantity, actual_quantity: p.quantity, unit_cost: Number(p.cost_price) });
  };

  const submit = async () => {
    if (!reason.trim()) return toast.error("اكتب سبب الجرد");
    if (lines.length === 0) return toast.error("أضف منتج واحد على الأقل");
    for (const l of lines) if (!l.product_id) return toast.error("اختر منتج لكل سطر");
    setBusy(true);
    const number = `ADJ-${Date.now().toString(36).toUpperCase()}`;
    const { data: adj, error } = await supabase.from("stock_adjustments" as any).insert({
      branch_id: branchId, adjustment_number: number,
      reason: reason.trim(), notes: notes.trim() || null, created_by: user!.id,
    }).select().single();
    if (error || !adj) { setBusy(false); return toast.error(error?.message ?? "فشل الحفظ"); }
    const items = lines.map((l) => ({
      adjustment_id: (adj as any).id, product_id: l.product_id, product_name: l.product_name,
      system_quantity: l.system_quantity, actual_quantity: l.actual_quantity,
      difference: l.actual_quantity - l.system_quantity, unit_cost: l.unit_cost,
    }));
    const { error: e2 } = await supabase.from("stock_adjustment_items" as any).insert(items);
    if (e2) { setBusy(false); return toast.error(e2.message); }
    toast.success("تم تسجيل الجرد وتعديل المخزون");
    nav(`/branch/${branchId}/invoices?tab=adjustment`);
  };

  return (
    <BranchLayout>
      <PageHeader title="جرد مخزن جديد" subtitle="بعد الجرد - عدّل الكميات الفعلية" />
      <div className="space-y-4 card-elevated p-5">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>السبب *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر السبب" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="جرد دوري">جرد دوري</SelectItem>
                <SelectItem value="بضاعة تالفة">بضاعة تالفة</SelectItem>
                <SelectItem value="بضاعة مفقودة">بضاعة مفقودة</SelectItem>
                <SelectItem value="تصحيح خطأ إدخال">تصحيح خطأ إدخال</SelectItem>
                <SelectItem value="أخرى">أخرى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>المنتجات</Label>
            <Button size="sm" variant="outline" onClick={addLine} className="gap-1"><Plus className="w-3 h-3" /> إضافة</Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const diff = l.actual_quantity - l.system_quantity;
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 border rounded">
                  <div className="col-span-4">
                    <Select value={l.product_id} onValueChange={(v) => onProduct(i, v)}>
                      <SelectTrigger><SelectValue placeholder="منتج" /></SelectTrigger>
                      <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">بالنظام</Label>
                    <Input type="number" value={l.system_quantity} disabled />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">الفعلي</Label>
                    <Input type="number" value={l.actual_quantity} onChange={(e) => updateLine(i, { actual_quantity: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2 text-center">
                    <Label className="text-xs text-muted-foreground">الفرق</Label>
                    <div className={`font-bold ${diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : ""}`}>
                      {diff > 0 ? "+" : ""}{diff}
                    </div>
                  </div>
                  <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end pt-3 border-t">
          <Button onClick={submit} disabled={busy} size="lg">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ الجرد"}
          </Button>
        </div>
      </div>
    </BranchLayout>
  );
}
