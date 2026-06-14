import { useEffect, useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { PaymentMethodPicker, emptyPaymentValue, PaymentMethodValue } from "./PaymentMethodPicker";
import { validateTransferPayment } from "@/lib/paymentMethods";
import { fetchVoucherCategories, VoucherCategory, VoucherType, PARTY_TYPE_LABEL, VoucherPartyType } from "@/lib/vouchers";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string;
  type: VoucherType;
  onSuccess?: () => void;
}

interface PartyOption { id: string; name: string; }

export function VoucherDialog({ open, onOpenChange, branchId, type, onSuccess }: Props) {
  const [cats, setCats] = useState<VoucherCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    category_id: "",
    amount: "",
    party_type: "" as "" | VoucherPartyType,
    party_id: "" as string,
    party_name: "",
    description: "",
    voucher_date: new Date().toISOString().slice(0, 10),
  });
  const [pm, setPm] = useState<PaymentMethodValue>(emptyPaymentValue());
  const [partyOptions, setPartyOptions] = useState<PartyOption[]>([]);
  const [partyOpen, setPartyOpen] = useState(false);
  const [partyBalance, setPartyBalance] = useState<{ label: string; amount: number; tone: "good" | "bad" | "neutral" } | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchVoucherCategories(type, true).then(setCats).catch((e) => toast.error(e.message));
    setForm({
      category_id: "",
      amount: "",
      party_type: "",
      party_id: "",
      party_name: "",
      description: "",
      voucher_date: new Date().toISOString().slice(0, 10),
    });
    setPm(emptyPaymentValue());
    setPartyOptions([]);
    setPartyBalance(null);
  }, [open, type]);

  // System categories produced automatically by other flows — hide from manual dialog
  const AUTO_KEYS = new Set([
    "advance", "salary", "supplier_payment", "cash_sale", "installment",
    "customer_return", "transfer_fee", "branch_transfer_in", "branch_transfer_out",
    "shipping",
  ]);
  const grouped = useMemo(() => {
    const visible = cats.filter((c) => !c.system_key || !AUTO_KEYS.has(c.system_key));
    const roots = visible.filter((c) => !c.parent_id);
    return roots.map((r) => ({ root: r, children: visible.filter((c) => c.parent_id === r.id) }));
  }, [cats]);

  // Load party options when party_type changes
  // Load party options when party_type changes
  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, party_id: "", party_name: "" }));
    setPartyBalance(null);
    if (!form.party_type || form.party_type === "other") { setPartyOptions([]); return; }
    (async () => {
      if (form.party_type === "supplier" || form.party_type === "customer") {
        const { data, error } = await supabase
          .from("contacts")
          .select("id, name")
          .eq("type", form.party_type)
          .order("name");
        if (error) { toast.error(error.message); return; }
        setPartyOptions(((data ?? []) as any[]).map((r) => ({ id: r.id, name: r.name })));
      } else if (form.party_type === "employee") {
        const { data, error } = await supabase
          .from("employees")
          .select("id, name")
          .eq("branch_id", branchId)
          .order("name");
        if (error) { toast.error(error.message); return; }
        setPartyOptions(((data ?? []) as any[]).map((r) => ({ id: r.id, name: r.name })));
      }
    })();
  }, [form.party_type, open, branchId]);

  // Compute balance when party selected
  useEffect(() => {
    if (!form.party_id || !form.party_type) { setPartyBalance(null); return; }
    (async () => {
      try {
        if (form.party_type === "employee") {
          const { data } = await supabase.from("advances" as any).select("remaining").eq("employee_id", form.party_id);
          const total = ((data ?? []) as any[]).reduce((s, r) => s + Number(r.remaining || 0), 0);
          setPartyBalance({ label: "سلف مستحقة على الموظف", amount: total, tone: total > 0 ? "bad" : "neutral" });
        } else if (form.party_type === "supplier") {
          const { data } = await supabase.from("contacts").select("balance").eq("id", form.party_id).maybeSingle();
          const amt = Number((data as any)?.balance ?? 0);
          setPartyBalance({ label: amt >= 0 ? "مستحق للمورد علينا" : "رصيد لصالحنا عند المورد", amount: Math.abs(amt), tone: amt > 0 ? "bad" : amt < 0 ? "good" : "neutral" });
        } else if (form.party_type === "customer") {
          const { data } = await supabase.from("payment_plans" as any).select("remaining_amount").eq("entity_type", "customer").eq("entity_id", form.party_id).eq("status", "active");
          const total = ((data ?? []) as any[]).reduce((s, r) => s + Number(r.remaining_amount || 0), 0);
          setPartyBalance({ label: "مستحق على العميل لنا", amount: total, tone: total > 0 ? "good" : "neutral" });
        }
      } catch {
        setPartyBalance(null);
      }
    })();
  }, [form.party_id, form.party_type]);


  const submit = async () => {
    const amt = Number(form.amount);
    if (!form.category_id) return toast.error("اختر التصنيف");
    if (!amt || amt <= 0) return toast.error("أدخل مبلغ صحيح");
    const vErr = validateTransferPayment(pm);
    if (vErr) return toast.error(vErr);
    setBusy(true);
    try {
      const { error } = await supabase.rpc("create_manual_voucher" as any, {
        p_branch_id: branchId,
        p_type: type,
        p_category_id: form.category_id,
        p_amount: amt,
        p_payment_method: pm.method,
        p_reference_number: pm.reference_number ?? null,
        p_transferred_to: pm.transfer_to_account ?? null,
        p_transferred_from: pm.transfer_from_account ?? null,
        p_fee_amount: pm.fee_amount ?? 0,
        p_party_type: form.party_type || null,
        p_party_id: form.party_id || null,
        p_party_name: form.party_name.trim() || null,
        p_description: form.description.trim() || null,
        p_voucher_date: form.voucher_date,
      });
      if (error) throw error;
      toast.success(type === "receipt" ? "تم حفظ سند القبض" : "تم حفظ سند الصرف");
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحفظ");
    } finally {
      setBusy(false);
    }
  };

  const selectedParty = partyOptions.find((p) => p.id === form.party_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{type === "receipt" ? "سند قبض جديد" : "سند صرف جديد"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>التصنيف *</Label>
            <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
              <SelectContent>
                {grouped.map(({ root, children }) => (
                  <div key={root.id}>
                    <SelectItem value={root.id}>{root.name}</SelectItem>
                    {children.map((c) => (
                      <SelectItem key={c.id} value={c.id}>— {c.name}</SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>المبلغ *</Label>
              <Input type="number" min={0} step="0.01" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>التاريخ</Label>
              <Input type="date" value={form.voucher_date}
                onChange={(e) => setForm({ ...form, voucher_date: e.target.value })} className="mt-1.5" />
            </div>
          </div>

          <PaymentMethodPicker amount={Number(form.amount) || 0} value={pm} onChange={setPm} showTransferFrom />

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>{type === "receipt" ? "نوع الحساب" : "الجهة"}</Label>
              <Select value={form.party_type} onValueChange={(v) => setForm({ ...form, party_type: v as any })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder={type === "receipt" ? "اختر نوع الحساب" : "اختر النوع"} /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PARTY_TYPE_LABEL) as VoucherPartyType[]).map((k) => (
                    <SelectItem key={k} value={k}>{PARTY_TYPE_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{form.party_type && form.party_type !== "other" ? (type === "receipt" ? "اختر الحساب" : "اختر الجهة") : (type === "receipt" ? "اسم الحساب" : "اسم الجهة")}</Label>
              {form.party_type && form.party_type !== "other" ? (
                <Popover open={partyOpen} onOpenChange={setPartyOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="mt-1.5 w-full justify-between font-normal">
                      {selectedParty?.name ?? "اختر..."}
                      <ChevronsUpDown className="ms-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                    <Command>
                      <CommandInput placeholder="بحث..." />
                      <CommandList>
                        <CommandEmpty>لا توجد نتائج</CommandEmpty>
                        <CommandGroup>
                          {partyOptions.map((p) => (
                            <CommandItem key={p.id} value={p.name} onSelect={() => {
                              setForm((f) => ({ ...f, party_id: p.id, party_name: p.name }));
                              setPartyOpen(false);
                            }}>
                              <Check className={cn("me-2 h-4 w-4", form.party_id === p.id ? "opacity-100" : "opacity-0")} />
                              {p.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : (
                <Input value={form.party_name} onChange={(e) => setForm({ ...form, party_name: e.target.value })}
                  placeholder={type === "receipt" ? "استُلم من" : "صُرف إلى"} className="mt-1.5" />
              )}
            </div>
          </div>

          {partyBalance && (
            <div className="rounded-md border bg-muted/30 p-2.5 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{partyBalance.label}</span>
              <Badge variant={partyBalance.tone === "bad" ? "destructive" : partyBalance.tone === "good" ? "default" : "secondary"}>
                {formatEGP(partyBalance.amount)}
              </Badge>
            </div>
          )}

          <div>
            <Label>وصف / ملاحظات</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1.5" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} حفظ السند
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
