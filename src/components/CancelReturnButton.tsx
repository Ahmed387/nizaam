import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";

export interface CancelReturnTarget {
  id: string;
  returnNumber: string;
  type: "sale" | "purchase";
  total: number;
}

interface Props {
  kind: "sale" | "purchase";
  returnId: string;
  returnNumber: string;
  total: number;
  status: string;
  onDone?: () => void;
  /** Compact red «إلغاء» icon for table action columns */
  iconOnly?: boolean;
  /** When given, the button only reports the target; the parent renders ONE hoisted <CancelReturnDialog>. */
  onRequest?: (t: CancelReturnTarget) => void;
}

/**
 * زرار إلغاء المرتجع — للمالك فقط.
 * جوه الجداول: مرّر onRequest والأب يعرض نافذة واحدة بس (مش نافذة لكل صف).
 */
export function CancelReturnButton({ kind, returnId, returnNumber, total, status, onDone, iconOnly, onRequest }: Props) {
  const { isOwner, isSuperAdmin } = useAuth();
  const [local, setLocal] = useState<CancelReturnTarget | null>(null);

  if (!(isOwner || isSuperAdmin)) return null;
  if (status !== "active") return null;

  const target: CancelReturnTarget = { id: returnId, returnNumber, type: kind, total };
  const request = () => (onRequest ? onRequest(target) : setLocal(target));

  return (
    <>
      {iconOnly ? (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="إلغاء المرتجع — يعكس المخزون والخزنة والقيد (المرتجع بيفضل في القايمة ملغي)" aria-label={`إلغاء المرتجع ${returnNumber}`} onClick={(e) => { e.stopPropagation(); request(); }}>
          <Ban className="w-4 h-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={request} className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10">
          <Ban className="w-4 h-4" /> إلغاء المرتجع
        </Button>
      )}
      {!onRequest && <CancelReturnDialog target={local} onClose={() => setLocal(null)} onDone={onDone} />}
    </>
  );
}

/**
 * نافذة تأكيد إلغاء المرتجع — نسخة واحدة، بتتعرض في document.body عن طريق portal
 * (برا أي جدول) ومن غير قفل سكرول الصفحة، فمفيش اهتزاز ولا انحراف عن منتصف الشاشة.
 */
export function CancelReturnDialog({ target, onClose, onDone }: { target: CancelReturnTarget | null; onClose: () => void; onDone?: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (target) setReason(""); }, [target?.id]);
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, busy, onClose]);

  if (!target || typeof document === "undefined") return null;
  const kind = target.type;

  const submit = async () => {
    if (!reason.trim()) { toast.error("لازم تكتب سبب الإلغاء"); return; }
    setBusy(true);
    const fn = kind === "sale" ? "cancel_sale_return" : "cancel_purchase_return";
    const { data, error } = await supabase.rpc(fn as any, { _return_id: target.id, _reason: reason.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const d: any = data ?? {};
    const money = Number(kind === "sale" ? d.money_back ?? 0 : d.money_out ?? 0);
    const debt = Number(kind === "sale" ? d.debt_restored ?? 0 : d.payable_restored ?? 0);
    toast.success(`تم إلغاء المرتجع ${target.returnNumber}`, {
      description:
        (money > 0
          ? kind === "sale"
            ? `رجع للخزنة: ${formatEGP(money)}`
            : `خرج من الخزنة: ${formatEGP(money)}`
          : "مفيش حركة خزنة") +
        (debt > 0 ? ` • رجع الديْن: ${formatEGP(debt)}` : ""),
    });
    onClose();
    onDone?.();
  };

  return createPortal(
    <div dir="rtl" role="alertdialog" aria-modal="true" className="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-[min(94vw,32rem)] max-h-[90vh] overflow-y-auto rounded-2xl border-2 border-destructive/50 bg-card shadow-2xl">
            <div className="p-5 flex items-start gap-4">
              <div className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center bg-destructive/15 text-destructive">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xl font-extrabold text-destructive">إلغاء المرتجع {target.returnNumber}؟</div>
                <div className="mt-2 text-sm font-medium text-muted-foreground leading-relaxed">
                  قيمة المرتجع {formatEGP(target.total)}. لما تلغيه هيحصل الآتي تلقائي:
                  <ul className="list-disc pr-5 mt-2 space-y-1">
                    {kind === "sale" ? (
                      <>
                        <li>الكمية اللي رجعت هتتسحب تاني من المخزن</li>
                        <li>الفلوس اللي اترجعت للعميل هتدخل الخزنة تاني</li>
                        <li>الديْن اللي اتخصم هيرجع على الفاتورة زي ما كان</li>
                        <li>الكميات هترجع متاحة للإرجاع تاني على الفاتورة الأصلية</li>
                        <li>القيد المحاسبي للمرتجع هيتشال</li>
                      </>
                    ) : (
                      <>
                        <li>الكمية هترجع للمخزن تاني</li>
                        <li>الفلوس اللي المورد ردّها هتخرج من الخزنة</li>
                        <li>ذمة المورد هترجع زي ما كانت</li>
                        <li>القيد المحاسبي للمرتجع هيتشال</li>
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
                autoFocus
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
              <Button onClick={onClose} disabled={busy} variant="outline" className="flex-1 font-extrabold">
                لأ، ارجع
              </Button>
            </div>
      </div>
    </div>,
    document.body,
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
