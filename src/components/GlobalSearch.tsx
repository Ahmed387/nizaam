// «بحث في السيستم كله» (Ctrl+K / ⌘K, owner 2026-11-16): one box on every page — an invoice / purchase / return /
// voucher number, an account name / phone / account number, an item code / name — Enter opens it. Reads
// `global_search` (migration 0235, the user's own RLS); shapes in src/lib/globalSearch.ts.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Search, FileText, Truck, Undo2, Receipt, User, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { friendlyError } from "@/lib/friendlyError";
import { groupHits, searchTarget, type SearchHit, type SearchKind } from "@/lib/globalSearch";

const ICON: Record<SearchKind, typeof FileText> = {
  sale: FileText, purchase: Truck, sale_return: Undo2, purchase_return: Undo2, voucher: Receipt, contact: User, product: Package,
};

const OPEN_EVENT = "nizam:global-search";

/** The header button (mounted in both the mobile and the desktop header) — it only opens the one dialog. */
export function GlobalSearchButton() {
  return (
    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} title="بحث في السيستم كله (Ctrl+K)">
      <Search className="w-4 h-4" />
      <span className="hidden md:inline text-xs">بحث</span>
      <kbd className="hidden md:inline rounded border bg-muted px-1 text-[10px]" dir="ltr">Ctrl K</kbd>
    </Button>
  );
}

/** The dialog + Ctrl+K, mounted ONCE in App.tsx (two copies would open and close each other). */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const nav = useNavigate();
  const { isAdmin, user } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K" || e.code === "KeyK")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); setError(null); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("global_search" as any, { p_q: term, p_limit: 6 });
      if (my !== seq.current) return;
      setLoading(false);
      if (error) { setError(friendlyError(error.message, error.code)); setHits([]); return; }
      setError(null);
      setHits(((data as SearchHit[]) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const go = (h: SearchHit) => {
    const to = searchTarget(h, isAdmin);
    if (!to) return;
    setOpen(false);
    setQ("");
    nav(to);
  };

  const groups = groupHits(hits, q);
  if (!user) return null;
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
        <DialogContent className="overflow-hidden p-0 max-w-xl" dir="rtl">
          <DialogTitle className="sr-only">بحث في السيستم كله</DialogTitle>
          <CommandPrimitive shouldFilter={false} className="flex flex-col" loop>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <CommandPrimitive.Input
                autoFocus value={q} onValueChange={setQ}
                placeholder="رقم فاتورة أو سند، اسم أو تليفون عميل / مورد، كود أو اسم صنف…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
            </div>
            <CommandPrimitive.List className="max-h-[60vh] overflow-y-auto p-1">
              {q.trim().length < 2 && <div className="p-4 text-center text-xs text-muted-foreground">اكتب حرفين على الأقل. ↑↓ للتنقل و Enter للفتح.</div>}
              {error && <div className="p-4 text-center text-sm text-destructive">{error}</div>}
              {!loading && !error && q.trim().length >= 2 && hits.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">مفيش نتايج لـ «{q.trim()}»</div>
              )}
              {groups.map((g) => (
                <CommandPrimitive.Group key={g.label} heading={g.label}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
                  {g.hits.map((h) => {
                    const Icon = ICON[h.kind];
                    return (
                      <CommandPrimitive.Item key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}`} onSelect={() => go(h)}
                        className="flex items-center gap-3 rounded-md px-2 py-2 text-sm cursor-pointer aria-selected:bg-accent">
                        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {h.title}{h.status === "cancelled" && <span className="mr-2 text-xs text-destructive">ملغي</span>}
                          </div>
                          {(h.sub || h.day) && (
                            <div className="truncate text-xs text-muted-foreground">
                              {[h.sub, h.day ? new Date(h.day).toLocaleDateString("en-GB") : null].filter(Boolean).join(" • ")}
                            </div>
                          )}
                        </div>
                        <div className="text-left shrink-0 text-xs text-muted-foreground">
                          {h.amount != null && <div className="tabular-nums text-foreground">{formatEGP(Number(h.amount))}</div>}
                          {h.branch && <div>{h.branch}</div>}
                        </div>
                      </CommandPrimitive.Item>
                    );
                  })}
                </CommandPrimitive.Group>
              ))}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>
    </>
  );
}
