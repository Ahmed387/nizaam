import { useEffect, useState } from "react";
import { History, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContactLookup } from "@/components/ContactLookup";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
import { matchProducts } from "@/lib/codeSuggest";
import { pyrProblem, pyrTotals, type PyrLine } from "@/lib/priorYearReturn";

/**
 * «مرتجع فاتورة قبل 2026» (migration 0145, owner only): a customer brings back something bought before 2026 — there
 * is no invoice in the system. The owner types the item, the price he gives back and the cost it goes back into stock
 * at; the money is paid back now from a vessel or stays on the customer's account. 2026 sales are not touched.
 */
export function PriorYearReturnButton({ branchId, onDone }: { branchId: string; onDone?: () => void }) {
  const { isOwner } = useAuth();
  const [open, setOpen] = useState(false);
  if (!isOwner) return null;
  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}><History className="w-4 h-4" /> مرتجع فاتورة قبل 2026</Button>
      {open && <PriorYearReturnDialog branchId={branchId} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

const EMPTY: PyrLine = { product_id: null, name: "", quantity: 1, price: 0, cost: 0 };

function PriorYearReturnDialog({ branchId, onClose, onDone }: { branchId: string; onClose: () => void; onDone?: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [date, setDate] = useState(cairoTodayDay());
  const [lines, setLines] = useState<PyrLine[]>([{ ...EMPTY }]);
  const [q, setQ] = useState<Record<number, string>>({});
  const [mode, setMode] = useState<"refund" | "account" | null>(null);
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("products").select("id, name, sku, legacy_code, brand, model, avg_cost, cost_price, selling_price")
      .eq("branch_id", branchId).is("archived_at", null).order("name").limit(5000)
      .then(({ data }) => setProducts(data ?? []));
    loadAllPaymentMethods().then((m) => setMethods(m.filter((x) => x.is_enabled !== false))).catch(() => setMethods([]));
  }, [branchId]);

  const set = (i: number, patch: Partial<PyrLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const t = pyrTotals(lines);

  const save = async () => {
    const problem = pyrProblem(lines, mode, contactId, date);
    if (problem) return toast.error(problem);
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("record_prior_year_return", {
      p_branch: branchId, p_contact: contactId, p_date: date,
      p_items: lines.filter((l) => l.product_id && l.quantity > 0).map((l) => ({ product_id: l.product_id, quantity: l.quantity, price: l.price, cost: l.cost })),
      p_money_mode: mode, p_method: method, p_notes: notes || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`اتسجل ${data?.return_number ?? ""}: ${t.lines} صنف رجع للمخزن، و ${formatEGP(t.price)} ${mode === "refund" ? "اترد للعميل" : "اتحطت تحت حسابه"}`);
    onDone?.();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>مرتجع فاتورة قبل 2026</DialogTitle>
          <DialogDescription>
            للحاجة اللي اتباعت قبل 2026 (مالهاش فاتورة على السيستم). الصنف بيرجع للمخزن بالتكلفة اللي هتكتبها، والفرق بين
            السعر والتكلفة بيتحسب على أرباح السنين اللي فاتت — مبيعات وربح 2026 ما بيتغيروش.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>العميل</Label><ContactLookup branchId={branchId} kind="customer" value={contactId} onChange={(id) => setContactId(id || null)} placeholder="عميل نقدي" emptyLabel="عميل نقدي" /></div>
          <div><Label>تاريخ المرتجع</Label><Input type="date" value={date} min="2026-01-01" max={cairoTodayDay()} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <Label>الأصناف اللي رجعت</Label>
          {lines.map((l, i) => {
            const hits = l.product_id ? [] : matchProducts(q[i] ?? "", products, 8);
            return (
              <div key={i} className="rounded-lg border p-2 space-y-2">
                {l.product_id ? (
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>{l.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => set(i, { product_id: null, name: "" })}>غيّر</Button>
                  </div>
                ) : (
                  <div>
                    <Input placeholder="ابحث بالاسم أو الكود…" value={q[i] ?? ""} onChange={(e) => setQ({ ...q, [i]: e.target.value })} />
                    {(q[i] ?? "").trim() && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded border">
                        {hits.map((p: any) => (
                          <button key={p.id} type="button" className="block w-full px-2 py-1 text-right text-sm hover:bg-muted"
                            onClick={() => set(i, { product_id: p.id, name: p.name, cost: Number(p.avg_cost ?? p.cost_price ?? 0), price: Number(p.selling_price ?? 0) })}>
                            {p.name} <span className="text-xs text-muted-foreground">{p.sku}</span>
                          </button>
                        ))}
                        {hits.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">لا توجد نتائج</div>}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">الكمية</Label><Input type="number" min={0} value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} /></div>
                  <div><Label className="text-xs">السعر اللي هيرجع للعميل (للقطعة)</Label><Input type="number" min={0} value={l.price} onChange={(e) => set(i, { price: Number(e.target.value) })} /></div>
                  <div><Label className="text-xs">التكلفة اللي يرجع بيها المخزن</Label><Input type="number" min={0} value={l.cost} onChange={(e) => set(i, { cost: Number(e.target.value) })} /></div>
                </div>
                {lines.length > 1 && (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4 ml-1" /> شيل الصنف
                  </Button>
                )}
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { ...EMPTY }])}><Plus className="w-4 h-4 ml-1" /> صنف تاني</Button>
        </div>
        <div className="rounded-lg border p-3 space-y-2">
          <div className="text-sm font-semibold">الفلوس ({formatEGP(t.price)})</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={mode === "refund" ? "default" : "outline"} onClick={() => setMode("refund")}>ترجعله دلوقتي</Button>
            <Button size="sm" variant={mode === "account" ? "default" : "outline"} onClick={() => setMode("account")}>تفضل تحت حسابه</Button>
          </div>
          <div className="max-w-xs">
            <Label className="text-xs">من / في أنهي وعاء</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(methods.length ? methods : [{ value: "cash", label: "نقدي", is_builtin: true, is_enabled: true }]).map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            للمخزن بتكلفة {formatEGP(t.cost)} • الفرق {formatEGP(t.priorYears)} على أرباح السنين اللي فاتت
          </div>
        </div>
        <div><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلًا: فاتورة 2025 رقم …" /></div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy}>سجّل المرتجع</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
