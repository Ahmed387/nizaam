import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Asks one reason before a cancel; nothing happens until «تأكيد». */
export function ReasonDialog({ title, description, confirm = "تأكيد", onConfirm, onClose }: {
  title: string; description?: string; confirm?: string; onConfirm: (reason: string) => Promise<void> | void; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div><Label>السبب</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={async () => {
            setBusy(true);
            try { await onConfirm(reason.trim()); } finally { setBusy(false); }
          }}>{confirm}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
