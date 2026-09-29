import { useRef, useState } from "react";
import { Calculator, Database, Info, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface MetricHintProps {
  meaning: string;
  source: string;
  formula: string;
  label?: string;
}

const CLOSE_DELAY_MS = 120;

/** شرح موحّد لمعنى المؤشر ومصدره ومعادلته؛ يدعم المرور بالماوس والنقر واللمس. */
export function MetricHint({ meaning, source, formula, label = "شرح الرقم وطريقة حسابه" }: MetricHintProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const openHint = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="inline-flex shrink-0" onMouseEnter={openHint} onMouseLeave={scheduleClose}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            className="h-6 w-6 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            <Info className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          dir="rtl"
          align="start"
          sideOffset={8}
          className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-4 text-right"
          onMouseEnter={openHint}
          onMouseLeave={scheduleClose}
          onClick={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex gap-3">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div><div className="text-xs font-bold text-foreground">المعنى</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{meaning}</p></div>
          </div>
          <div className="flex gap-3 border-t pt-3">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div><div className="text-xs font-bold text-foreground">مصدر البيانات</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{source}</p></div>
          </div>
          <div className="flex gap-3 border-t pt-3">
            <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div><div className="text-xs font-bold text-foreground">المعادلة</div><p className="mt-1 rounded-md bg-muted px-2.5 py-2 text-xs font-semibold leading-5 text-foreground">{formula}</p></div>
          </div>
        </PopoverContent>
      </span>
    </Popover>
  );
}