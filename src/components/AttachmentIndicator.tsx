import { Paperclip } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function AttachmentIndicator({ count }: { count: number }) {
  if (!count) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-0.5 text-primary cursor-default" aria-label={`يوجد ${count} مرفق`}>
            <Paperclip className="w-3.5 h-3.5" />
            {count > 1 && <span className="text-[10px] font-bold">{count}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent>يوجد {count} {count === 1 ? "مرفق" : "مرفقات"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
