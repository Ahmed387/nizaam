import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { waLink, waPhone } from "@/lib/whatsappShare";

/**
 * «ابعت للعميل واتساب» (owner 2026-11-18 «زرار الواتساب مش شغال»): the button was disabled whenever the account had no
 * mobile — and no account had one (the «سهل» files carry no phone numbers), so it never worked. Now it is always on:
 * with a saved mobile WhatsApp opens at once; without one the cashier types the number (a walk-in sale too) and, when he
 * may edit the account, can save it to the account for next time. WhatsApp opens in the click itself (a window opened
 * after an await is blocked by the browser), the save runs after.
 */
export function WhatsAppSendButton({ phone, contactId, canSavePhone, buildText }: {
  phone: string | null | undefined;
  contactId: string | null | undefined;
  /** the person may change the account's details (save_contact refuses others) */
  canSavePhone: boolean;
  buildText: () => string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [save, setSave] = useState(true);
  const saved = waPhone(phone);
  const typedOk = waPhone(typed);

  const send = (to: string) => { window.open(waLink(to, buildText()), "_blank", "noopener"); };

  const sendTyped = async () => {
    if (!typedOk) return toast.error("اكتب رقم موبايل صحيح — زي 01001234567");
    send(typedOk);
    setOpen(false);
    if (save && canSavePhone && contactId) {
      const { error } = await supabase.rpc("save_contact" as any, { p_id: contactId, p_data: { phone: typed.trim() } } as any);
      if (error) toast.error(`اتبعت، بس الرقم ما اتحفظش في ملف العميل: ${error.message}`);
      else toast.success("الرقم اتحفظ في ملف العميل");
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => (saved ? send(saved) : setOpen(true))}
        title={saved ? "يفتح واتساب على محادثة العميل والرسالة مكتوبة — دوس «إرسال»" : "مفيش رقم موبايل محفوظ — هتكتبه وتبعت"}
        className="border-success text-success hover:bg-success/10">
        <MessageCircle className="w-4 h-4 ml-1" /> ابعت للعميل واتساب
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>رقم موبايل العميل</DialogTitle>
            <DialogDescription>مفيش رقم محفوظ للعميل ده. اكتبه وواتساب هيفتح على محادثته والرسالة مكتوبة.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
            <div>
              <Label htmlFor="wa-phone">الموبايل</Label>
              <Input id="wa-phone" inputMode="tel" dir="ltr" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder="01001234567" className="mt-1.5 text-left" aria-invalid={!!typed && !typedOk} />
              {typed && !typedOk && <p className="text-xs text-destructive mt-1">الرقم ده مش موبايل — اكتبه 11 رقم يبدأ بـ 010 / 011 / 012 / 015</p>}
            </div>
            {canSavePhone && contactId && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={save} onCheckedChange={(v) => setSave(!!v)} /> احفظ الرقم في ملف العميل
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>رجوع</Button>
              <Button type="submit" disabled={!typedOk} className="gap-1.5"><MessageCircle className="w-4 h-4" /> افتح واتساب</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
