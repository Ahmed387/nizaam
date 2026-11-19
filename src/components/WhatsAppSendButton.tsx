import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, PhoneOff, UserPen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { waLink, waPhone } from "@/lib/whatsappShare";
import { phoneProblem } from "@/lib/whatsappFix";

/**
 * «ابعت للعميل / للمورد واتساب».
 * - A saved mobile: WhatsApp opens at once on his chat with the message written (in the click itself — a window opened
 *   after an await is blocked by the browser).
 * - No usable mobile (owner 2026-11-19 «يظهر Alert بالمشكلة و ينقله بخفة ولذاذه لصفحة المورد او العميل»): an alert says
 *   what is missing; «سجّل رقمه في ملفه» moves to the account's page with the phone field open (`fixPath`, see
 *   src/lib/whatsappFix.ts) and, once a mobile is saved, back here with the button pointed out (`highlight`). Who may not
 *   edit the account is told to ask the manager and may type the number for this one message (the old way, 2026-11-18).
 * - A walk-in sale (no account): the number is typed directly.
 */
export function WhatsAppSendButton({ phone, contactId, canSavePhone, buildText, who = "customer", fixPath, highlight }: {
  phone: string | null | undefined;
  contactId: string | null | undefined;
  /** the person may change the account's details (save_contact refuses others) */
  canSavePhone: boolean;
  buildText: () => string;
  who?: "customer" | "supplier";
  /** the account's page with the phone to fix and the way back here; null = no trip (walk-in / no right) */
  fixPath?: string | null;
  /** came back from the account's page with a mobile saved */
  highlight?: boolean;
}) {
  const nav = useNavigate();
  const [mode, setMode] = useState<null | "problem" | "type">(null);
  const [typed, setTyped] = useState("");
  const [save, setSave] = useState(true);
  const saved = waPhone(phone);
  const typedOk = waPhone(typed);
  const party = who === "supplier" ? "المورد" : "العميل";
  const toParty = who === "supplier" ? "للمورد" : "للعميل";
  const problem = phoneProblem(phone);
  const canGoFix = !!(contactId && canSavePhone && fixPath);

  const send = (to: string) => { window.open(waLink(to, buildText()), "_blank", "noopener"); };

  const click = () => {
    if (saved) return send(saved);
    setMode(contactId ? "problem" : "type");
  };

  const goFix = () => {
    setMode(null);
    toast.info(`سجّل رقم موبايل ${party} واحفظ — هترجع للفاتورة لوحدك`);
    nav(fixPath!);
  };

  const sendTyped = async () => {
    if (!typedOk) return toast.error("اكتب رقم موبايل صحيح — زي 01001234567");
    send(typedOk);
    setMode(null);
    if (save && canSavePhone && contactId) {
      const { error } = await supabase.rpc("save_contact" as any, { p_id: contactId, p_data: { phone: typed.trim() } } as any);
      if (error) toast.error(`اتبعت، بس الرقم ما اتحفظش في ملف ${party}: ${error.message}`);
      else toast.success(`الرقم اتحفظ في ملف ${party}`);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={click} data-ready={highlight ? "1" : undefined}
        title={saved ? `يفتح واتساب على محادثة ${party} والرسالة مكتوبة — دوس «إرسال»` : `مفيش رقم موبايل صالح ${toParty}`}
        className={`border-success text-success hover:bg-success/10 transition-shadow ${highlight ? "ring-4 ring-success/40 animate-pulse" : ""}`}>
        <MessageCircle className="w-4 h-4 ml-1" /> {who === "supplier" ? "ابعت للمورد واتساب" : "ابعت للعميل واتساب"}
      </Button>

      <Dialog open={mode === "problem"} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-w-sm animate-in fade-in-0 zoom-in-95 duration-200" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PhoneOff className="w-5 h-5 text-warning" /> مش هينفع نبعت {toParty} واتساب دلوقتي</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm" data-testid="wa-problem">
                <p>{problem?.text ?? "مفيش رقم موبايل متسجل في ملفه."}</p>
                <p>الواتساب بيفتح على محادثة {party} برقم موبايله، فلازم الرقم يتسجل في ملف {party} الأول.</p>
                {canGoFix
                  ? <p className="text-foreground">دوس «سجّل رقمه في ملفه»: هتروح لصفحة {party} وخانة التليفون مفتوحة، وبعد الحفظ هترجع هنا وتبعت.</p>
                  : <p className="text-foreground">مش من صلاحيتك تعدّل ملف {party} — اطلب من المدير يسجّل رقمه، أو اكتب الرقم وابعت المرة دي.</p>}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setMode("type")}>اكتب الرقم وابعت المرة دي</Button>
            {canGoFix && <Button type="button" onClick={goFix} className="gap-1.5"><UserPen className="w-4 h-4" /> سجّل رقمه في ملفه</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "type"} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>رقم موبايل {party}</DialogTitle>
            <DialogDescription>اكتب الرقم وواتساب هيفتح على محادثته والرسالة مكتوبة.</DialogDescription>
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
                <Checkbox checked={save} onCheckedChange={(v) => setSave(!!v)} /> احفظ الرقم في ملف {party}
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMode(null)}>رجوع</Button>
              <Button type="submit" disabled={!typedOk} className="gap-1.5"><MessageCircle className="w-4 h-4" /> افتح واتساب</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
