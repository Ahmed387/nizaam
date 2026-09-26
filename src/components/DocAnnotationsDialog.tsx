import { useEffect, useState } from "react";
import { StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AnnotationKind, saveDocAnnotations } from "@/lib/docAnnotations";

interface Props {
  kind: AnnotationKind;
  id: string;
  recipient?: string | null;
  notes?: string | null;
  onSaved?: () => void;
}

/** Icon button + dialog to edit «المستلم» and «الملاحظات» on any document. */
export function DocAnnotationsButton({ kind, id, recipient, notes, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [r, setR] = useState(recipient ?? "");
  const [n, setN] = useState(notes ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setR(recipient ?? ""); setN(notes ?? ""); } }, [open, recipient, notes]);

  const save = async () => {
    setBusy(true);
    try {
      await saveDocAnnotations(kind, id, r, n);
      toast.success("تم حفظ المستلم والملاحظات");
      setOpen(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر الحفظ");
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل الملاحظات" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <StickyNote className="w-4 h-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="text-right" onClick={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>المستلم والملاحظات</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>المستلم</Label>
              <Input value={r} readOnly disabled className="bg-muted cursor-not-allowed select-none" />
              <p className="text-[11px] text-muted-foreground">🔒 المستلم الأصلي لا يمكن تعديله بعد إصدار المستند</p>
            </div>
            <div className="space-y-1.5">
              <Label>الملاحظات</Label>
              <Textarea rows={3} value={n} onChange={(e) => setN(e.target.value)} maxLength={1000} />
            </div>
            <p className="text-xs text-muted-foreground">التعديل ده بيغيّر المستلم والملاحظات بس — المبالغ والتواريخ والقيود مش بتتأثر.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} disabled={busy}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
