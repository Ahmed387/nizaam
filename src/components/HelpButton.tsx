import { useNavigate } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** أيقونة مساعدة (؟) ثابتة في الهيدر — بتفتح دليل الاستخدام. */
export function HelpButton() {
  const nav = useNavigate();
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          onClick={() => nav("/guide")}
          className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          aria-label="دليل الاستخدام"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>دليل الاستخدام — ابدأ من هنا</TooltipContent>
    </Tooltip>
  );
}
