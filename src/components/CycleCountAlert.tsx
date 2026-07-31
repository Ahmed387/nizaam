import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarClock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const STALE_DAYS = 90;

interface StaleProduct {
  id: string;
  name: string;
  lastCounted: string | null;
}

/** Flags products in this branch that were never counted, or not counted in the last 90 days. */
export function CycleCountAlert({ branchId, onStartCount }: { branchId?: string; onStartCount?: () => void }) {
  const [stale, setStale] = useState<StaleProduct[]>([]);
  const [openList, setOpenList] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!branchId) return;
      const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();

      const { data: products } = await supabase
        .from("products")
        .select("id,name,created_at")
        .eq("branch_id", branchId)
        .is("archived_at", null);
      if (!products?.length) { if (!cancelled) setStale([]); return; }

      const { data: counts } = await supabase
        .from("inventory_session_items" as any)
        .select("product_id, counted_at, session:inventory_sessions!inner(branch_id,status)")
        .eq("session.branch_id", branchId)
        .not("counted_at", "is", null);

      const lastByProduct: Record<string, string> = {};
      for (const c of (counts ?? []) as any[]) {
        const prev = lastByProduct[c.product_id];
        if (!prev || c.counted_at > prev) lastByProduct[c.product_id] = c.counted_at;
      }

      const out: StaleProduct[] = [];
      for (const p of products as any[]) {
        const last = lastByProduct[p.id] ?? null;
        // Give brand-new products a grace period equal to the stale window.
        if (!last && p.created_at > cutoff) continue;
        if (!last || last < cutoff) out.push({ id: p.id, name: p.name, lastCounted: last });
      }
      if (!cancelled) setStale(out);
    })();
    return () => { cancelled = true; };
  }, [branchId]);

  if (!stale.length) return null;

  return (
    <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <CalendarClock className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div className="flex-1 min-w-[200px]">
          <div className="font-bold">جرد دوري مستحق — {stale.length} صنف</div>
          <div className="text-sm text-muted-foreground">
            الأصناف دي معدّاش عليها جرد فعلي من أكتر من {STALE_DAYS} يوم (أو عمرها ما اتجردت).
          </div>
        </div>
        {onStartCount && (
          <Button size="sm" onClick={onStartCount}>ابدأ جلسة جرد</Button>
        )}
      </div>

      <Collapsible open={openList} onOpenChange={setOpenList}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="mt-2 gap-1">
            <ChevronDown className={`w-4 h-4 transition-transform ${openList ? "rotate-180" : ""}`} />
            {openList ? "إخفاء الأصناف" : "عرض الأصناف"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-2 grid sm:grid-cols-2 lg:grid-cols-3 gap-1 text-sm">
            {stale.slice(0, 60).map((p) => (
              <li key={p.id} className="flex justify-between gap-2 rounded-md bg-background/60 px-2 py-1">
                <span className="truncate">{p.name}</span>
                <span className="text-muted-foreground text-xs shrink-0">
                  {p.lastCounted ? new Date(p.lastCounted).toLocaleDateString("ar-EG") : "لم يُجرد"}
                </span>
              </li>
            ))}
          </ul>
          {stale.length > 60 && (
            <div className="text-xs text-muted-foreground mt-1">و{stale.length - 60} صنف آخر…</div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
