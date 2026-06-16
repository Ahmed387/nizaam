import { useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecordAttachments } from "./RecordAttachments";
import type { RecordType } from "@/hooks/useAttachmentCounts";

/**
 * Compact button that opens a dialog containing the shared RecordAttachments
 * component. Useful for list screens where there is no dedicated detail page.
 */
export function AttachmentsDialogButton({
  recordType, recordId, canEdit = true, count, label = "المرفقات",
}: {
  recordType: RecordType;
  recordId: string;
  canEdit?: boolean;
  count?: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="icon" variant="ghost" className="h-7 w-7 relative"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={label}
      >
        <Paperclip className="w-4 h-4" />
        {!!count && count > 0 && (
          <span className="absolute -top-1 -left-1 text-[9px] bg-primary text-primary-foreground rounded-full px-1 min-w-[14px] h-[14px] flex items-center justify-center">
            {count}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
          <RecordAttachments recordType={recordType} recordId={recordId} canEdit={canEdit} />
        </DialogContent>
      </Dialog>
    </>
  );
}
