import { useEffect, useState, useMemo, useRef } from "react";
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
import { fetchVoucherCategories, VoucherCategory, VoucherType, PARTY_TYPE_LABEL, VoucherPartyType, Voucher } from "@/lib/vouchers";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { tenantStoragePath } from "@/lib/attachmentPath";
import { Loader2, Check, ChevronsUpDown, Paperclip, Upload, X, FileText, Image as ImageIcon, ArrowDownCircle, ArrowUpCircle, Wallet, Receipt, User as UserIcon, StickyNote, CalendarDays, Tag, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

const ATT_BUCKET = "record-attachments";
const ATT_MAX_SIZE = 5 * 1024 * 1024;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string;
  type: VoucherType;
  onSuccess?: () => void;
  /** When provided, dialog runs in edit mode and calls edit_voucher RPC */
  editingVoucher?: Voucher | null;
}

const FIELD_LABELS_AR: Record<string, string> = {
  amount: "المبلغ",
  voucher_date: "التاريخ",
  category: "التصنيف",
  payment_method: "طريقة الدفع",
  party: "الجهة",
  description: "الوصف",
  reference_number: "رقم المرجع",
  transferred_to: "التحويل إلى",
  fee_amount: "العمولة",
};

interface PartyOption { id: string; name: string; }

export function VoucherDialog({ open, onOpenChange, branchId, type, onSuccess, editingVoucher }: Props) {
  const { user } = useAuth();
  const isEdit = !!editingVoucher;
  const [cats, setCats] = useState<VoucherCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [editReason, setEditReason] = useState("");
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
  const [attachFiles, setAttachFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    fetchVoucherCategories(type, true).then(setCats).catch((e) => toast.error(e.message));
    if (editingVoucher) {
      setForm({
        category_id: editingVoucher.category_id,
        amount: String(editingVoucher.amount ?? ""),
        party_type: (editingVoucher.party_type ?? "") as any,
        party_id: editingVoucher.party_id ?? "",
        party_name: editingVoucher.party_name ?? "",
        description: editingVoucher.description ?? "",
        voucher_date: editingVoucher.voucher_date,
      });
      const initPm = emptyPaymentValue(editingVoucher.payment_method as any);
      initPm.reference_number = editingVoucher.reference_number ?? undefined;
      initPm.transfer_to_account = editingVoucher.transferred_to ?? undefined;
      initPm.transfer_from_account = (editingVoucher as any).transferred_from ?? undefined;
      initPm.fee_amount = Number(editingVoucher.fee_amount ?? 0);
      setPm(initPm);
    } else {
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
    }
    setPartyOptions([]);
    setPartyBalance(null);
    setAttachFiles([]);
    setEditReason("");
  }, [open, type, editingVoucher]);

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
          // TODO Phase 2.2B: Remove after contacts.balance column is dropped
          const { data } = await supabase.from("v_contact_balances" as any).select("total_balance").eq("contact_id", form.party_id).maybeSingle();
          const amt = Number((data as any)?.total_balance ?? 0);
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


  const formatDiffValue = (v: any) => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "number") return formatEGP(v);
    return String(v);
  };

  const submit = async () => {
    const amt = Number(form.amount);
    if (!form.category_id) return toast.error("اختر التصنيف");
    if (!amt || amt <= 0) return toast.error("أدخل مبلغ صحيح");
    const vErr = validateTransferPayment(pm);
    if (vErr) return toast.error(vErr);
    if (isEdit && !editReason.trim()) return toast.error("سبب التعديل مطلوب");
    setBusy(true);
    try {
      let voucherId: string | null = null;

      if (isEdit && editingVoucher) {
        const { data: res, error } = await supabase.rpc("edit_voucher" as any, {
          p_voucher_id: editingVoucher.id,
          p_category_id: form.category_id,
          p_amount: amt,
          p_payment_method: pm.method,
          p_voucher_date: form.voucher_date,
          p_party_type: form.party_type || null,
          p_party_id: form.party_id || null,
          p_party_name: form.party_name.trim() || null,
          p_description: form.description.trim() || null,
          p_reference_number: pm.reference_number ?? null,
          p_transferred_to: pm.transfer_to_account ?? null,
          p_transferred_from: pm.transfer_from_account ?? null,
          p_fee_amount: pm.fee_amount ?? 0,
          p_edit_reason: editReason.trim(),
        });
        if (error) throw error;
        const result = res as any;
        voucherId = result?.new_voucher_id ?? null;
        const changes = (result?.changes ?? {}) as Record<string, { old: any; new: any }>;
        const changeCount = Object.keys(changes).length;
        const lines = Object.entries(changes).map(
          ([k, v]) => `• ${FIELD_LABELS_AR[k] ?? k}: ${formatDiffValue(v.old)} ← ${formatDiffValue(v.new)}`
        );
        toast.success(
          `تم تعديل السند (${changeCount} حقل)`,
          { description: lines.join("\n"), duration: 8000 }
        );
      } else {
        const { data: newId, error } = await supabase.rpc("create_manual_voucher" as any, {
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
        voucherId = newId as unknown as string | null;
        toast.success(type === "receipt" ? "تم حفظ سند القبض" : "تم حفظ سند الصرف");
      }

      // Upload any pending attachments (create + edit both support adding new attachments)
      if (voucherId && attachFiles.length > 0) {
        const { compressImage } = await import("@/lib/compressImage");
        let okCount = 0;
        for (const file of attachFiles) {
          try {
            const originalSize = file.size;
            const working = file.type.startsWith("image/") ? await compressImage(file) : file;
            if (working.size > 5 * 1024 * 1024) {
              toast.error(`${file.name}: الحجم كبير حتى بعد الضغط`);
              continue;
            }
            const safeName = working.name.replace(/[^\w.\-]/g, "_");
            const path = await tenantStoragePath(`voucher/${voucherId}/${Date.now()}_${safeName}`);
            const { error: upErr } = await supabase.storage.from(ATT_BUCKET).upload(path, working, { contentType: working.type });
            if (upErr) throw upErr;
            const { error: insErr } = await supabase.from("attachments" as any).insert({
              record_type: "voucher",
              record_id: voucherId,
              file_path: path,
              file_name: file.name,
              file_type: working.type,
              file_size: working.size,
              original_size: originalSize,
              uploaded_by: user?.id,
            });
            if (insErr) {
              await supabase.storage.from(ATT_BUCKET).remove([path]);
              throw insErr;
            }
            okCount++;
          } catch (e: any) {
            toast.error(`فشل رفع ${file.name}: ${e.message ?? ""}`);
          }
        }
        if (okCount > 0) toast.success(`تم رفع ${okCount} مرفق`);
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error(e.message ?? (isEdit ? "فشل التعديل" : "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  };


  const selectedParty = partyOptions.find((p) => p.id === form.party_id);

  const isReceipt = type === "receipt";
  const accentClass = isReceipt ? "text-success" : "text-destructive";
  const accentBg = isReceipt ? "bg-success/10 border-success/30" : "bg-destructive/10 border-destructive/30";
  const HeaderIcon = isReceipt ? ArrowDownCircle : ArrowUpCircle;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0">
        {/* Header banner */}
        <div className={cn("px-6 py-4 border-b flex items-center gap-3", accentBg)}>
          <div className={cn("w-11 h-11 rounded-full bg-background flex items-center justify-center shadow-sm", accentClass)}>
            <HeaderIcon className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <DialogHeader className="space-y-0.5">
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                {isEdit && <Pencil className="w-4 h-4" />}
                {isEdit
                  ? (isReceipt ? `تعديل سند قبض ${editingVoucher?.voucher_number ?? ""}` : `تعديل سند صرف ${editingVoucher?.voucher_number ?? ""}`)
                  : (isReceipt ? "سند قبض جديد" : "سند صرف جديد")}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? "سيتم إلغاء السند الأصلي وإصدار سند جديد بالبيانات المعدلة (يتم عكس الأثر المحاسبي تلقائياً)"
                  : (isReceipt ? "تسجيل مبلغ مستلم في خزينة الفرع" : "تسجيل مبلغ مصروف من خزينة الفرع")}
              </p>
            </DialogHeader>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 1. Classification + Amount + Date */}
          <section className="rounded-lg border bg-card p-4 space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Tag className="w-4 h-4 text-primary" /> بيانات السند الأساسية
            </h3>
            <div>
              <Label className="text-xs font-medium">التصنيف *</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger className="mt-1.5 h-10"><SelectValue placeholder="اختر التصنيف المناسب" /></SelectTrigger>
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
                <Label className="text-xs font-medium flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> المبلغ (ج.م) *</Label>
                <Input
                  type="number" min={0} step="0.01" value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className={cn("mt-1.5 h-11 text-lg font-bold tabular-nums", accentClass)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label className="text-xs font-medium flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> تاريخ السند</Label>
                <Input type="date" value={form.voucher_date}
                  onChange={(e) => setForm({ ...form, voucher_date: e.target.value })} className="mt-1.5 h-11" />
              </div>
            </div>
          </section>

          {/* 2. Payment method */}
          <section className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Receipt className="w-4 h-4 text-primary" /> طريقة الدفع
            </h3>
            <PaymentMethodPicker amount={Number(form.amount) || 0} value={pm} onChange={setPm} showTransferFrom />
          </section>

          {/* 3. Party */}
          <section className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <UserIcon className="w-4 h-4 text-primary" />
              {isReceipt ? "الجهة المُستلَم منها" : "الجهة المصروف إليها"}
              <span className="text-xs font-normal text-muted-foreground">(اختياري)</span>
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">{isReceipt ? "نوع الحساب" : "نوع الجهة"}</Label>
                <Select value={form.party_type} onValueChange={(v) => setForm({ ...form, party_type: v as any })}>
                  <SelectTrigger className="mt-1.5 h-10"><SelectValue placeholder={isReceipt ? "اختر نوع الحساب" : "اختر النوع"} /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PARTY_TYPE_LABEL) as VoucherPartyType[]).map((k) => (
                      <SelectItem key={k} value={k}>{PARTY_TYPE_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium">{form.party_type && form.party_type !== "other" ? (isReceipt ? "اختر الحساب" : "اختر الجهة") : (isReceipt ? "اسم الحساب" : "اسم الجهة")}</Label>
                {form.party_type && form.party_type !== "other" ? (
                  <Popover open={partyOpen} onOpenChange={setPartyOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="mt-1.5 w-full justify-between font-normal h-10">
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
                    placeholder={isReceipt ? "استُلم من..." : "صُرف إلى..."} className="mt-1.5 h-10" />
                )}
              </div>
            </div>

            {partyBalance && (
              <div className={cn(
                "rounded-md border p-3 flex items-center justify-between text-sm",
                partyBalance.tone === "bad" ? "bg-destructive/10 border-destructive/30" :
                partyBalance.tone === "good" ? "bg-success/10 border-success/30" :
                "bg-muted/40"
              )}>
                <span className="font-medium">{partyBalance.label}</span>
                <span className={cn(
                  "font-bold tabular-nums",
                  partyBalance.tone === "bad" ? "text-destructive" :
                  partyBalance.tone === "good" ? "text-success" : ""
                )}>
                  {formatEGP(partyBalance.amount)}
                </span>
              </div>
            )}
          </section>

          {/* 4. Notes */}
          <section className="rounded-lg border bg-card p-4 space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <StickyNote className="w-4 h-4 text-primary" /> وصف / ملاحظات
              <span className="text-xs font-normal text-muted-foreground">(اختياري)</span>
            </h3>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2} placeholder="أضف ملاحظة أو وصف يوضّح سبب السند..." />
          </section>

          {/* 5. Attachments */}
          <section className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Paperclip className="w-4 h-4 text-primary" /> المرفقات
                {attachFiles.length > 0 && <span className="text-xs font-normal text-muted-foreground">({attachFiles.length} ملف)</span>}
              </h3>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.xls,.xlsx,.csv"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  const valid: File[] = [];
                  for (const f of files) {
                    if (f.size > ATT_MAX_SIZE) {
                      toast.error(`${f.name}: تجاوز الحد الأقصى 5 ميجابايت`);
                    } else {
                      valid.push(f);
                    }
                  }
                  if (valid.length) setAttachFiles((prev) => [...prev, ...valid]);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                <Upload className="w-4 h-4" /> إضافة مرفق
              </Button>
            </div>
            {attachFiles.length === 0 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full text-xs text-muted-foreground py-4 bg-muted/30 hover:bg-muted/50 rounded border border-dashed transition-colors"
              >
                لا توجد مرفقات — اضغط لإضافة صور / PDF / Excel (حتى 5MB لكل ملف)
              </button>
            ) : (
              <div className="space-y-1.5">
                {attachFiles.map((f, idx) => {
                  const isImg = f.type.startsWith("image/");
                  return (
                    <div key={idx} className="flex items-center gap-2 p-2 rounded border bg-muted/30 text-sm">
                      <div className="shrink-0 w-8 h-8 rounded bg-background flex items-center justify-center border">
                        {isImg ? <ImageIcon className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{f.name}</div>
                        <div className="text-[10px] text-muted-foreground">{Math.round(f.size / 1024)} KB</div>
                      </div>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                        onClick={() => setAttachFiles((prev) => prev.filter((_, i) => i !== idx))}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Edit reason - only shown in edit mode */}
          {isEdit && (
            <section className="rounded-lg border-2 border-warning/40 bg-warning/5 p-4 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Pencil className="w-4 h-4 text-warning" /> سبب التعديل *
              </h3>
              <Textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={2}
                placeholder="اذكر سبب التعديل — سيُسجَّل في سجل التدقيق ويرافق السند الجديد"
              />
              <p className="text-[11px] text-muted-foreground">
                ⚠️ عند الحفظ: يُلغى السند الأصلي ({editingVoucher?.voucher_number}) ويُصدَر سند جديد. الأثر المحاسبي والقيود تُحدَّث تلقائياً.
              </p>
            </section>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/20">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>إلغاء</Button>
          <Button onClick={submit} disabled={busy} className="gap-2 min-w-32">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? "حفظ التعديلات" : "حفظ السند"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
