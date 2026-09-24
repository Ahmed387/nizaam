import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}

function windowPages(page: number, total: number): (number | "…")[] {
  const set = new Set<number>([1, total]);
  for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= total) set.add(p);
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

export function NumberedPagination({ page, pageCount, onChange, disabled }: Props) {
  if (pageCount <= 1) return null;
  const go = (p: number) => { if (p >= 1 && p <= pageCount && p !== page) onChange(p); };
  return (
    <nav className="flex items-center justify-center gap-1.5 mt-3 w-full" aria-label="التنقل بين الصفحات">
      <Button variant="outline" size="icon" className="h-9 w-9 rounded-full" disabled={disabled || page <= 1} onClick={() => go(page - 1)} aria-label="السابقة">
        <ChevronRight className="w-4 h-4" />
      </Button>
      <span className="sm:hidden px-3 py-1.5 rounded-full bg-muted text-sm tabular-nums">
        صفحة {page.toLocaleString("en-US")} من {pageCount.toLocaleString("en-US")}
      </span>
      <div className="hidden sm:flex items-center gap-1.5">
        {windowPages(page, pageCount).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              size="sm"
              variant={p === page ? "default" : "outline"}
              className={`h-9 min-w-9 rounded-full px-3 tabular-nums ${p === page ? "font-bold" : "font-normal"}`}
              disabled={disabled}
              onClick={() => go(p)}
              aria-current={p === page ? "page" : undefined}
            >
              {p.toLocaleString("en-US")}
            </Button>
          ),
        )}
      </div>
      <Button variant="outline" size="icon" className="h-9 w-9 rounded-full" disabled={disabled || page >= pageCount} onClick={() => go(page + 1)} aria-label="التالية">
        <ChevronLeft className="w-4 h-4" />
      </Button>
    </nav>
  );
}
