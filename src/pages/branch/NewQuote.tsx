import { useEffect, useState, useMemo } from "react";
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
import { Plus, Trash2, Loader2, Search, FileText } from "lucide-react";
import { PartyCombobox } from "@/components/PartyCombobox";
import { RecordAttachments } from "@/components/RecordAttachments";

interface Line {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
}

export default function NewQuote() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, tenant } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [branch, setBranch] = useState<any>(null);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const [p, b] = await Promise.all([
        supabase.from("products").select("id, name, selling_price, sku").eq("branch_id", branchId).order("name"),
        supabase.from("branches").select("*").eq("id", branchId).maybeSingle(),
      ]);
      setProducts(p.data ?? []);
      setBranch(b.data);
    })();
  }, [branchId]);

  const filtered = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return [] as any[];
    return products
      .filter((p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [products, productSearch]);

  const addProduct = (p: any) => {
    const existing = lines.findIndex((l) => l.product_id === p.id);
    if (existing >= 0) {
      setLines(lines.map((l, i) => i === existing ? { ...l, quantity: l.quantity + 1 } : l));
    } else {
      setLines([...lines, { product_id: p.id, product_name: p.name, quantity: 1, unit_price: Number(p.selling_price) }]);
    }
    setProductSearch("");
  };
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.unit_price, 0), [lines]);
  const total = Math.max(0, subtotal - discount);

  const submit = async () => {
    if (lines.length === 0) return toast.error("أضف منتج واحد على الأقل");
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
    setBusy(false);
    setSavedQuoteId((q as any).id);
    toast.success("تم حفظ عرض السعر");
  };

  // After save, redirect to the quote view page
  useEffect(() => {
    if (!savedQuoteId) return;
    const t = setTimeout(() => nav(`/branch/${branchId}/quotes/${savedQuoteId}`), 600);
    return () => clearTimeout(t);
  }, [savedQuoteId, branchId, nav]);

  return (
    <BranchLayout>
      <PageHeader
        title="عرض سعر جديد"
        subtitle="عرض غير ملزم — لا يؤثر على المخزون"
        actions={
          <Button onClick={submit} disabled={busy || !!savedQuoteId} size="lg" className="btn-gradient">
            {busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <FileText className="w-4 h-4 ml-1" />}
            حفظ عرض السعر
          </Button>
        }
      />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-4">
          {/* Customer */}
          <div className="card-elevated p-5 space-y-3">
            <h3 className="font-bold flex items-center gap-2">👤 بيانات العميل</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>اختر عميل</Label>
                <div className="mt-1.5">
                  <PartyCombobox type="customer" value={customerId} onChange={(v) => setCustomerId(v)} placeholder="ابحث عن عميل" />
                </div>
              </div>
              <div>
                <Label>أو اسم عميل (بدون تسجيل)</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1.5" placeholder="اسم العميل" />
              </div>
              <div>
                <Label>صالح حتى</Label>
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="mt-1.5" />
              </div>
            </div>
          </div>

          {/* Products */}
          <div className="card-elevated p-5 space-y-3">
            <h3 className="font-bold flex items-center gap-2">📦 المنتجات</h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="ابحث عن منتج بالاسم أو الكود..."
                className="pr-9"
              />
              {filtered.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-64 overflow-auto">
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      className="w-full text-right px-3 py-2 hover:bg-surface-2 border-b border-border last:border-0 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.sku}</div>
                      </div>
                      <div className="text-sm text-primary font-bold">{formatEGP(p.selling_price)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {lines.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                ابحث عن منتجات وأضفها للعرض
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-bold px-2">
                  <div className="col-span-5">المنتج</div>
                  <div className="col-span-2 text-center">الكمية</div>
                  <div className="col-span-2 text-center">سعر الوحدة</div>
                  <div className="col-span-2 text-center">الإجمالي</div>
                  <div className="col-span-1"></div>
                </div>
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center p-2 border border-border rounded-lg bg-surface-2/40">
                    <div className="col-span-5 font-medium text-sm">{l.product_name}</div>
                    <div className="col-span-2">
                      <Input type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="text-center h-8" />
                    </div>
                    <div className="col-span-2">
                      <Input type="number" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: Math.max(0, Number(e.target.value) || 0) })} className="text-center h-8" />
                    </div>
                    <div className="col-span-2 text-center text-sm font-bold text-primary">{formatEGP(l.quantity * l.unit_price)}</div>
                    <div className="col-span-1 text-center">
                      <Button size="icon" variant="ghost" onClick={() => removeLine(i)} className="h-8 w-8">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="card-elevated p-5 space-y-3">
            <h3 className="font-bold">📝 ملاحظات</h3>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات تظهر على العرض المطبوع..." rows={3} />
          </div>
        </div>

        {/* Right: Totals */}
        <div className="space-y-4">
          <div className="card-elevated p-5 sticky top-4 space-y-3">
            <h3 className="font-bold flex items-center gap-2">💰 الإجماليات</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">المجموع:</span>
                <span className="font-bold">{formatEGP(subtotal)}</span>
              </div>
              <div>
                <Label className="text-xs">خصم</Label>
                <Input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1 h-8 text-center"
                />
              </div>
              <div className="border-t border-border pt-2 flex justify-between text-lg">
                <span className="font-bold">الإجمالي:</span>
                <span className="font-extrabold text-primary">{formatEGP(total)}</span>
              </div>
              <div className="text-xs text-muted-foreground bg-secondary/10 border border-secondary/30 rounded p-2">
                ℹ️ عرض السعر غير ملزم ولا يحجز مخزون. يمكنك تحويله لفاتورة بعد الحفظ.
              </div>
            </div>
          </div>

          {savedQuoteId && (
            <div className="card-elevated p-5">
              <h3 className="font-bold mb-3">📎 المرفقات</h3>
              <RecordAttachments recordType="quote" recordId={savedQuoteId} />
            </div>
          )}
        </div>
      </div>
    </BranchLayout>
  );
}
