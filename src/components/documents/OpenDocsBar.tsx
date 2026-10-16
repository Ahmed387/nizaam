import { Link, useLocation, useNavigate } from "react-router-dom";
import { X, Layers } from "lucide-react";
import { closeAllDocs, closeDoc, useOpenDocs } from "@/lib/openDocs";
import { cn } from "@/lib/utils";

/** Tabs of the documents opened together from a table selection («فتح الكل»). */
export function OpenDocsBar() {
  const docs = useOpenDocs();
  const { pathname } = useLocation();
  const nav = useNavigate();
  if (!docs.length) return null;

  const close = (path: string) => {
    const i = docs.findIndex((d) => d.path === path);
    closeDoc(path);
    if (pathname === path) {
      const next = docs[i + 1] ?? docs[i - 1];
      if (next) nav(next.path);
    }
  };

  return (
    <div className="no-print mb-3 flex items-center gap-1.5 overflow-x-auto rounded-lg border bg-card px-2 py-1.5" dir="rtl">
      <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {docs.map((d) => {
        const active = pathname === d.path;
        return (
          <span key={d.path} className={cn(
            "group inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors",
            active ? "border-primary bg-primary/10 text-primary" : "border-transparent hover:bg-muted",
          )}>
            <Link to={d.path} className="font-mono">{d.label}</Link>
            <button type="button" aria-label={`إغلاق ${d.label}`} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => close(d.path)}>
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <button type="button" className="mr-auto shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={closeAllDocs}>
        إغلاق الكل
      </button>
    </div>
  );
}
