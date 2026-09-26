import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  expanded?: boolean;
  label: string;
  onClick: () => void;
  className?: string;
}

export function DetailsChevron({ expanded = false, label, onClick, className }: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      className={cn("h-7 w-7 shrink-0 text-muted-foreground hover:text-primary", className)}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
    >
      <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
    </Button>
  );
}