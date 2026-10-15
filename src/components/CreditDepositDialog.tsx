import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { PiggyBank } from "lucide-react";
import { attachPaymentProofs, proofClock } from "@/lib/paymentProofs";
import { PaymentProofInput } from "@/components/payments/PaymentProofInput";

type ContactOpt = { id: string; name: string; phone: string | null };

interface Props {
  /** Pre-selected contact (from a contact panel). Omit to pick one. */
  contact?: { id: string; name: string } | null;
  onDone?: () => void;
  size?: "sm" | "default";
}

/** Admin/owner-only: deposit credit into the central management account, never an operational branch drawer. */
export function CreditDepositButton({ contact, onDone, size = "default" }: Props) {
  const { isAdmin, tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<ContactOpt[]>([]);
  const [contactId, setContactId] = useState(contact?.id ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [ref, setRef] = useState("");
  const [proofs, setProofs] = useState<File[]>([]);
  const [fromAcc, setFromAcc] = useState("");
  const [toAcc, setToAcc] = useState("");
  const [date, setDate] = useState(cairoTodayDay());
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setContactId(contact?.id ?? ""); setDate(cairoTodayDay()); } }, [open, contact?.id]);

  useEffect(() => {
    if (!open || contact || !tenantId) return;
    const t = setTimeout(async () => {
      let qb = supabase.from("contacts").select("id,name,phone").eq("tenant_id", tenantId).eq("is_archived", false).order("name").limit(50);
      const s = q.trim().replace(/[,()%*]/g, " ");
      if (s) qb = qb.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
      const { data } = await qb;
      setOpts((data ?? []) as ContactOpt[]);
    }, 300);
    return () => clearTimeout(t);
  }, [q, open, contact, tenantId]);

  if (!isAdmin) return null;

  const submit = async () => {
    const amt = Number(amount);
    if (!contactId) return toast.error("اختار الجهة");
    if (!(amt > 0)) return toast.error("المبلغ لازم يكون أكبر من صفر");
    if (method === "bank" && (!ref.trim() || !fromAcc.trim() || !toAcc.trim()))
      return toast.error("رقم العملية والحساب المحوَّل منه وإليه مطلوبين للبنك");
    setBusy(true);
    const proofSince = proofClock();
    const { error } = await supabase.rpc("create_contact_credit_deposit" as any, {
      p_contact_id: contactId, p_amount: amt, p_method: method,
      p_description: desc.trim() || null, p_voucher_date: date,
      p_reference_number: method === "bank" ? ref.trim() : null,
      p_transferred_from: method === "bank" ? fromAcc.trim() : null,
      p_transferred_to: method === "bank" ? toAcc.trim() : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (method !== "cash") await attachPaymentProofs([{ files: proofs, method, amount: amt }], proofSince);
    setProofs([]);
    toast.success(`تم إيداع ${formatEGP(amt)} تحت الحساب`);
    setOpen(false); setAmount(""); setDesc(""); setRef(""); setFromAcc(""); setToAcc(""); setQ("");
    onDone?.();
  };

  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <PiggyBank className="w-4 h-4 ml-1" /> إيداع رصيد تحت الحساب
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إيداع رصيد تحت الحساب</DialogTitle>
            <DialogDescription>
              المبلغ يدخل الخزينة الرئيسية (الإدارة) أو الحساب البنكي العام للشركة فقط — لا يمس درج أي فرع — ويُضاف لرصيد الجهة المتاح تحت الحساب.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الجهة</Label>
              {contact ? (
                <Input value={contact.name} readOnly />
              ) : (
                <>
                  <Input placeholder="ابحث بالاسم أو الموبايل" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Select value={contactId} onValueChange={setContactId}>
                    <SelectTrigger className="mt-2"><SelectValue placeholder="اختار الجهة" /></SelectTrigger>
                    <SelectContent>
                      {opts.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}{o.phone ? ` — ${o.phone}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>المبلغ</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <div>
              <Label>طريقة الاستلام</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as "cash" | "bank")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">الخزينة الرئيسية (الإدارة) — نقدي</SelectItem>
                  <SelectItem value="bank">الحساب البنكي العام للشركة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {method === "bank" && (
              <div className="grid grid-cols-3 gap-2">
                <div><Label>رقم العملية</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
                <div><Label>من حساب</Label><Input value={fromAcc} onChange={(e) => setFromAcc(e.target.value)} /></div>
                <div><Label>إلى حساب</Label><Input value={toAcc} onChange={(e) => setToAcc(e.target.value)} /></div>
                <div className="col-span-3"><PaymentProofInput compact files={proofs} onChange={setProofs} /></div>
              </div>
            )}
            <div>
              <Label>البيان / الملاحظات</Label>
              <Textarea placeholder="إيداع دفعة تحت الحساب طرف الإدارة" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ السند"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
