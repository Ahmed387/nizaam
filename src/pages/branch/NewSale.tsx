import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Search, Trash2, Printer, Loader2, Plus, ScanLine } from "lucide-react";

interface Item {
  product_id: string;
  product_name: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
  market_price: number;
}

export default function NewSale() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, isAdmin, hasRole } = useAuth();
  const nav = useNavigate();

  const showCost = isAdmin || hasRole("branch_manager") || hasRole("accountant");

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [pricesMap, setPricesMap] = useState<Record<string, number>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [discountAmt, setDiscountAmt] = useState(0);
  const [discountPct, setDiscountPct] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [scannerMode, setScannerMode] = useState(true);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const [scanBuffer, setScanBuffer] = useState("");

  useEffect(() => {
    if (!branchId) return;
    supabase.from("products").select("*").eq("branch_id", branchId).order("name").then(({ data }) => setProducts(data ?? []));
    supabase.from("customers").select("id, name, phone").eq("branch_id", branchId).order("name").then(({ data }) => setCustomers(data ?? []));
    supabase.from("price_list").select("product_name, market_price").then(({ data }) => {
      const m: Record<string, number> = {};
      (data ?? []).forEach((p: any) => { m[p.product_name] = Number(p.market_price); });
      setPricesMap(m);
    });
  }, [branchId]);

  const filtered = useMemo(
    () => products.filter((p) => !search || p.name.includes(search) || p.sku.includes(search)).slice(0, 8),
    [products, search]
  );

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.quantity * i.selling_price, 0), [items]);
  const total = Math.max(0, subtotal - discountAmt);
  const totalCost = useMemo(() => items.reduce((s, i) => s + i.quantity * i.cost_price, 0), [items]);
  const totalProfit = total - totalCost;
  const profitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const setDiscByAmt = (v: number) => {
    setDiscountAmt(v);
    setDiscountPct(subtotal > 0 ? +(v / subtotal * 100).toFixed(2) : 0);
  };
  const setDiscByPct = (v: number) => {
    setDiscountPct(v);
    setDiscountAmt(+(subtotal * v / 100).toFixed(2));
  };

  const addItem = (p: any) => {
    const existing = items.find((i) => i.product_id === p.id);
    if (existing) {
      if (existing.quantity + 1 > p.quantity) return toast.error("الكمية المتاحة غير كافية");
      setItems(items.map((i) => i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      if (p.quantity < 1) return toast.error("المنتج غير متوفر");
      setItems([...items, {
        product_id: p.id,
        product_name: p.name,
        quantity: 1,
        cost_price: Number(p.cost_price),
        selling_price: Number(p.selling_price),
        market_price: pricesMap[p.name] ?? Number(p.market_price),
      }]);
    }
    setSearch("");
  };

  // Scan by SKU exact match
  const handleScan = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const found = products.find((p) => p.sku === trimmed || p.sku?.toLowerCase() === trimmed.toLowerCase());
    if (!found) {
      toast.error(`الكود ${trimmed} غير موجود`);
      return;
    }
    addItem(found);
    toast.success(`تم إضافة ${found.name}`, { duration: 1500 });
  };

  // Keep scanner input focused in scanner mode
  useEffect(() => {
    if (!scannerMode) return;
    const focus = () => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      scannerInputRef.current?.focus();
    };
    focus();
    const interval = setInterval(focus, 500);
    return () => clearInterval(interval);
  }, [scannerMode]);

  const updateQty = (pid: string, q: number) => {
    const prod = products.find((x) => x.id === pid);
    if (q > (prod?.quantity ?? 0)) return toast.error("الكمية غير متاحة");
    if (q <= 0) return setItems(items.filter((i) => i.product_id !== pid));
    setItems(items.map((i) => i.product_id === pid ? { ...i, quantity: q } : i));
  };

  const updatePrice = (pid: string, price: number) => {
    setItems(items.map((i) => i.product_id === pid ? { ...i, selling_price: Math.max(0, price) } : i));
  };

  const submit = async () => {
    if (!items.length) return toast.error("أضف منتجات أولاً");
    setBusy(true);
    try {
      let custId = customerId || null;
      if (!custId && quickName.trim()) {
        const { data: c } = await supabase.from("customers").insert({
          name: quickName, phone: quickPhone || null, branch_id: branchId!,
        }).select().single();
        custId = c?.id ?? null;
      }

      const { data: numRes } = await supabase.rpc("next_invoice_number");
      const invoiceNumber = numRes as string;

      const { data: inv, error: invErr } = await supabase.from("invoices").insert({
        invoice_number: invoiceNumber,
        branch_id: branchId!,
        customer_id: custId,
        cashier_id: user!.id,
        subtotal, discount_amount: discountAmt, discount_percent: discountPct,
        discount_reason: discountReason || null,
        total,
      }).select().single();
      if (invErr) throw invErr;

      const { error: itemsErr } = await supabase.from("invoice_items").insert(
        items.map((i) => ({
          invoice_id: inv.id,
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          cost_price: i.cost_price,
          selling_price: i.selling_price,
          market_price: i.market_price,
          total: i.quantity * i.selling_price,
        }))
      );
      if (itemsErr) throw itemsErr;

      // Deduct stock
      for (const it of items) {
        const p = products.find((x) => x.id === it.product_id);
        await supabase.from("products").update({ quantity: (p?.quantity ?? 0) - it.quantity }).eq("id", it.product_id);
      }

      // Treasury income
      await supabase.from("treasury").insert({
        branch_id: branchId!, type: "income", category: "sales",
        amount: total, description: `فاتورة ${invoiceNumber}`, reference_id: inv.id, created_by: user!.id,
      });

      await logAudit({
        userId: user!.id, userName: profile!.name, branchId, action: "CREATE",
        entity: "Invoice", entityId: inv.id, details: { invoice_number: invoiceNumber, total },
      });

      toast.success("تم إنشاء الفاتورة");
      nav(`/branch/${branchId}/sales/${inv.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BranchLayout>
      <PageHeader title="فاتورة جديدة" subtitle="نقطة البيع" />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Customer */}
          <div className="card-elevated p-4">
            <Label className="mb-2 block">العميل</Label>
            <select className="w-full bg-input border border-border rounded-lg p-2" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— عميل نقدي —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
            </select>
            {!customerId && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input placeholder="اسم عميل سريع" value={quickName} onChange={(e) => setQuickName(e.target.value)} />
                <Input placeholder="تليفون" dir="ltr" className="text-right" value={quickPhone} onChange={(e) => setQuickPhone(e.target.value)} />
              </div>
            )}
          </div>

          {/* Search */}
          <div className="card-elevated p-4">
            <Label className="mb-2 block">إضافة منتج</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="ابحث بالاسم أو الكود" value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
            </div>
            {search && (
              <div className="mt-3 space-y-1 max-h-72 overflow-y-auto">
                {filtered.map((p) => (
                  <button key={p.id} onClick={() => addItem(p)} className="w-full text-right p-3 rounded-lg border border-border hover:bg-surface-2 hover:border-primary/50 transition">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{p.sku}</div>
                      </div>
                      <div className="text-left text-xs space-y-0.5">
                        {Number(p.old_price) > 0 && Number(p.old_price) !== Number(p.selling_price) && (
                          <div>📉 السعر القديم: <span className="text-muted-foreground line-through">{formatEGP(p.old_price)}</span></div>
                        )}
                        <div>🏷️ سعر البيع: <span className="text-success font-bold">{formatEGP(p.selling_price)}</span></div>
                        {showCost && <div>📦 شراء: <span className="text-muted-foreground">{formatEGP(p.cost_price)}</span></div>}
                        {showCost && Number(p.cost_price) > 0 && (
                          <div>💵 الربح: <span className="text-primary font-bold">{formatEGP(Number(p.selling_price) - Number(p.cost_price))}</span></div>
                        )}
                        <div>💰 سوق: <span className="text-primary">{formatEGP(pricesMap[p.name] ?? p.market_price)}</span></div>
                        <div>📊 متاح: <span className={p.quantity > 0 ? "text-foreground" : "text-destructive"}>{p.quantity}</span></div>
                      </div>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <div className="text-center py-4 text-muted-foreground text-sm">لا توجد نتائج</div>}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="card-elevated overflow-hidden">
            <div className="p-4 border-b border-border font-bold">عناصر الفاتورة ({items.length})</div>
            {items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">ابحث عن منتج لإضافته</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="bg-surface-2 text-xs">
                  <th className="p-2 text-right">المنتج</th>
                  <th className="p-2">الكمية</th>
                  <th className="p-2">سعر البيع (قابل للتعديل)</th>
                  {showCost && <th className="p-2">الربح</th>}
                  <th className="p-2">الإجمالي</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {items.map((i) => {
                    const lineProfit = (i.selling_price - i.cost_price) * i.quantity;
                    const linePct = i.cost_price > 0 ? ((i.selling_price - i.cost_price) / i.cost_price) * 100 : 0;
                    return (
                      <tr key={i.product_id} className="border-t border-border">
                        <td className="p-2 font-medium">
                          {i.product_name}
                          {showCost && <div className="text-xs text-muted-foreground">شراء: {formatEGP(i.cost_price)}</div>}
                        </td>
                        <td className="p-2 text-center">
                          <Input type="number" min="1" value={i.quantity} onChange={(e) => updateQty(i.product_id, parseInt(e.target.value) || 0)} className="w-20 mx-auto text-center" />
                        </td>
                        <td className="p-2 text-center">
                          <Input type="number" min="0" step="0.01" value={i.selling_price} onChange={(e) => updatePrice(i.product_id, parseFloat(e.target.value) || 0)} className="w-28 mx-auto text-center" />
                        </td>
                        {showCost && (
                          <td className="p-2 text-center">
                            <div className={lineProfit >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{formatEGP(lineProfit)}</div>
                            <div className="text-xs text-muted-foreground">{linePct.toFixed(1)}%</div>
                          </td>
                        )}
                        <td className="p-2 text-center font-bold">{formatEGP(i.quantity * i.selling_price)}</td>
                        <td className="p-2"><Button variant="ghost" size="sm" onClick={() => updateQty(i.product_id, 0)}><Trash2 className="w-4 h-4 text-destructive" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-4">
          <div className="card-elevated p-5">
            <h3 className="font-bold mb-4">الخصم</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">خصم بالمبلغ</Label>
                <Input type="number" min="0" value={discountAmt || ""} onChange={(e) => setDiscByAmt(parseFloat(e.target.value) || 0)} className="mt-1" />
              </div>
              <div className="text-center text-muted-foreground text-xs">↕ مرتبطين تلقائياً</div>
              <div>
                <Label className="text-xs">نسبة %</Label>
                <Input type="number" min="0" max="100" step="0.1" value={discountPct || ""} onChange={(e) => setDiscByPct(parseFloat(e.target.value) || 0)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">السبب</Label>
                <Textarea rows={2} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} className="mt-1 text-sm" />
              </div>
            </div>
          </div>

          <div className="card-elevated p-5">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي قبل الخصم</span><span className="font-bold">{formatEGP(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الخصم ({discountPct}%)</span><span className="text-destructive font-bold">- {formatEGP(discountAmt)}</span></div>
              <div className="border-t border-border pt-3 flex justify-between text-base"><span className="font-bold">الإجمالي النهائي</span><span className="text-primary font-extrabold text-xl">{formatEGP(total)}</span></div>
              {showCost && items.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-border space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">إجمالي التكلفة</span><span>{formatEGP(totalCost)}</span></div>
                  <div className="flex justify-between"><span className="font-bold">💰 صافي الربح</span><span className={totalProfit >= 0 ? "text-success font-extrabold" : "text-destructive font-extrabold"}>{formatEGP(totalProfit)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">نسبة الربح</span><span className={totalProfit >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{profitPct.toFixed(2)}%</span></div>
                </div>
              )}
            </div>
            <Button className="w-full mt-4 h-12 btn-gradient text-base" disabled={busy || !items.length} onClick={submit}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Printer className="w-4 h-4 ml-2" /> إنشاء وطباعة</>}
            </Button>
          </div>
        </div>
      </div>
    </BranchLayout>
  );
}
