import { useState } from "react";
import { Ban, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";

interface Props {
  kind: "sale" | "purchase";
  returnId: string;
  returnNumber: string;
  total: number;
  status: string;
  onDone?: () => void;
}

/**
 * زرار إلغاء المرتجع — للمالك فقط.
 * الإلغاء بيعكس المخزون والخزنة والديْن، والداتابيز بترفض لو:
 * الكمية اتباعت تاني، الخزنة مش كفاية، أو الفترة المحاسبية مقفولة.
 */
export function CancelReturnButton({ kind, returnId, returnNumber, total, status, onDone }: Props) {
  const { isOwner, isSuperAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!(isOwner || isSuperAdmin)) return null;
  if (status !== "active") return null;

  const submit = async () => {
    if (!reason.trim()) { toast.error("لازم تكتب سبب الإلغاء"); return; }
    setBusy(true);
    const fn = kind === "sale" ? "cancel_sale_return" : "cancel_purchase_return";
    const { data, error } = await supabase.rpc(fn as any, { _return_id: returnId, _reason: reason.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const d: any = data ?? {};
    const money = Number(kind === "sale" ? d.money_back ?? 0 : d.money_out ?? 0);
    const debt = Number(kind === "sale" ? d.debt_restored ?? 0 : d.payable_restored ?? 0);
    toast.success(`تم إلغاء المرتجع ${returnNumber}`, {
      description:
        (money > 0
          ? kind === "sale"
            ? `رجع للخزنة: ${formatEGP(money)}`
            : `خرج من الخزنة: ${formatEGP(money)}`
          : "مفيش حركة خزنة") +
        (debt > 0 ? ` • رجع الديْن: ${formatEGP(debt)}` : ""),
    });
    setOpen(false);
    setReason("");
    onDone?.();
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10">
        <Ban className="w-4 h-4" /> إلغاء المرتجع
      </Button>

      {open && (
        <div dir="rtl" className="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={() => !busy && setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-[min(94vw,32rem)] rounded-2xl border-2 border-destructive/50 bg-card shadow-2xl overflow-hidden">
            <div className="p-5 flex items-start gap-4">
              <div className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center bg-destructive/15 text-destructive">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xl font-extrabold text-destructive">إلغاء المرتجع {returnNumber}؟</div>
                <div className="mt-2 text-sm font-medium text-muted-foreground leading-relaxed">
                  قيمة المرتجع {formatEGP(total)}. لما تلغيه هيحصل الآتي تلقائي:
                  <ul className="list-disc pr-5 mt-2 space-y-1">
                    {kind === "sale" ? (
                      <>
                        <li>الكمية اللي رجعت هتتسحب تاني من المخزن</li>
                        <li>الفلوس اللي اترجعت للعميل هتدخل الخزنة تاني</li>
                        <li>الديْن اللي اتخصم هيرجع على الفاتورة زي ما كان</li>
                      </>
                    ) : (
                      <>
                        <li>الكمية هترجع للمخزن تاني</li>
                        <li>الفلوس اللي المورد ردّها هتخرج من الخزنة</li>
                        <li>ذمة المورد هترجع زي ما كانت</li>
                      </>
                    )}
                  </ul>
                  <div className="mt-2 text-xs">
                    السيستم هيرفض الإلغاء لو الكمية اتباعت تاني، أو رصيد الخزنة مش كفاية، أو الشهر المحاسبي اتقفل.
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 pb-4">
              <label className="text-xs font-bold text-muted-foreground">سبب الإلغاء (إجباري)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="مثال: الكاشير سجّل 3 قطع بالغلط والمفروض 2"
                className="mt-1 w-full rounded-xl border-2 border-border bg-background p-2.5 text-sm font-medium outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-2 px-5 py-4 bg-muted/40 border-t border-border">
              <Button onClick={submit} disabled={busy} variant="destructive" className="flex-1 font-extrabold">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} أيوه، الغي المرتجع
              </Button>
              <Button onClick={() => setOpen(false)} disabled={busy} variant="outline" className="flex-1 font-extrabold">
                لأ، ارجع
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** بانر بيظهر فوق المرتجع الملغي. */
export function CancelledReturnBanner({ ret }: { ret: any }) {
  if (ret?.status !== "cancelled") return null;
  return (
    <div dir="rtl" className="mb-4 rounded-xl border-2 border-destructive/40 bg-destructive/10 p-4 text-destructive">
      <div className="font-extrabold">🚫 المرتجع ده متلغي</div>
      <div className="text-sm mt-1 font-medium">
        السبب: {ret.cancel_reason ?? "—"}
        {ret.cancelled_at && ` • بتاريخ ${new Date(ret.cancelled_at).toLocaleString("ar-EG")}`}
      </div>
    </div>
  );
}
