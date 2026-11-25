import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";

/** 0285: one badge per state of a goods transfer row. */
export function StockTransferBadge({ status }: { status: string }) {
  const cls: Record<string, [string, string]> = {
    confirmed: ["border-success/30 bg-success/15 text-success", "مؤكد"],
    rejected: ["border-destructive/30 bg-destructive/15 text-destructive", "مرفوض"],
    awaiting_approval: ["border-warning/40 bg-warning/15 text-warning", "⏳ مستني موافقة المالك"],
    refused: ["border-destructive/30 bg-destructive/15 text-destructive", "المالك رفضه"],
    cancelled: ["border-border bg-muted text-muted-foreground", "اتلغى"],
  };
  const [c, l] = cls[status] ?? ["border-warning/30 bg-warning/15 text-warning", "بانتظار الاستلام"];
  return <Badge variant="outline" className={c}>{l}</Badge>;
}

/** the sender may still change it (0285) */
export const stockSenderCanChange = (status: string) => status === "pending" || status === "awaiting_approval";

/** «تعديل الكمية» of one item while it is not received. */
export function EditStockTransferDialog({ row, onClose, onDone }: { row: any | null; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (row) { setQty(String(row.quantity)); setReason(""); } }, [row]);
  if (!row) return null;
  const save = async () => {
    const q = Math.trunc(Number(qty));
    if (!(q > 0)) return toast.error("الكمية لازم تكون 1 أو أكتر — ولو عاوز تشيله استخدم «إلغاء»");
    if (!reason.trim()) return toast.error("اكتب سبب التعديل");
    setBusy(true);
    const { error } = await supabase.rpc("edit_stock_transfer" as any, { p_transfer_id: row.id, p_quantity: q, p_reason: reason.trim() } as any);
    setBusy(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success("اتعدّلت الكمية");
    onDone(); onClose();
  };
  const diff = Math.trunc(Number(qty) || 0) - Number(row.quantity);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>تعديل كمية {row.products?.name ?? "الصنف"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div><Label>الكمية المرسلة</Label><Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1.5" /></div>
          {row.status === "pending" && diff !== 0 && (
            <p className="text-muted-foreground">{diff > 0 ? `هيخرج ${diff} كمان من مخزنك` : `هيرجع ${-diff} لمخزنك`} — في يوم التحويل نفسه.</p>
          )}
          <div><Label>سبب التعديل *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>رجوع</Button>
          <Button onClick={save} disabled={busy}>{busy ? "جاري..." : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** «إلغاء» of one item or of the whole transfer while it is not received. */
export function CancelStockTransferDialog({ target, onClose, onDone }: {
  target: { kind: "row" | "group"; id: string; label: string } | null; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(""); }, [target]);
  if (!target) return null;
  const save = async () => {
    if (!reason.trim()) return toast.error("اكتب سبب الإلغاء");
    setBusy(true);
    const { error } = target.kind === "group"
      ? await supabase.rpc("cancel_stock_transfer_group" as any, { p_group: target.id, p_reason: reason.trim() } as any)
      : await supabase.rpc("cancel_stock_transfer" as any, { p_transfer_id: target.id, p_reason: reason.trim() } as any);
    setBusy(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success("اتلغى التحويل — البضاعة رجعت لمخزنك");
    onDone(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle className="text-destructive">إلغاء {target.label}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p>الكمية بترجع لمخزنك في يوم التحويل نفسه، والفرع التاني بيتبلغ.</p>
          <div><Label>سبب الإلغاء *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>رجوع</Button>
          <Button variant="destructive" onClick={save} disabled={busy}>{busy ? "جاري..." : "تأكيد الإلغاء"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
