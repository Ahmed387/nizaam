import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * «فرع داخلي» badge (owner 2026-11-14 «علامة صغيره جنب كل حركة زي بادج»): next to the name of an account that is one of
 * our own branches (`contacts.internal_branch_id`, migration 0144 — today «معرض سكة تلة (حساب خاص)» and
 * «معرض عبد المنعم الغربى (حساب خاص)»). Display only: the tag is set in the database, the picker was removed (0206).
 * The list is read ONCE per page load and shared by every cell (one small query, not one per row).
 */
type Internal = { byId: Map<string, string>; byName: Map<string, string> };
let cache: Internal | null = null;
let pending: Promise<Internal> | null = null;
const listeners = new Set<(v: Internal) => void>();

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function load(): Promise<Internal> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = (async () => {
      const { data } = await supabase.from("contacts" as any)
        .select("id, name, internal_branch_id, branches:internal_branch_id(name)")
        .not("internal_branch_id", "is", null);
      const v: Internal = { byId: new Map(), byName: new Map() };
      (data as any[] | null ?? []).forEach((r) => {
        const br = r.branches?.name ?? "فرع داخلي";
        v.byId.set(r.id, br);
        if (r.name) v.byName.set(norm(r.name), br);
      });
      cache = v;
      listeners.forEach((f) => f(v));
      return v;
    })().catch(() => { pending = null; return { byId: new Map(), byName: new Map() }; });
  }
  return pending;
}

export function useInternalAccounts(): Internal | null {
  const [v, setV] = useState<Internal | null>(cache);
  useEffect(() => {
    if (cache) return;
    listeners.add(setV);
    load();
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}

/** Pass the account id when the row has it, else its name. Renders nothing for an ordinary account. */
export function InternalBranchBadge({ id, name, className = "" }: { id?: string | null; name?: string | null; className?: string }) {
  const v = useInternalAccounts();
  if (!v) return null;
  const br = (id && v.byId.get(id)) || (name && v.byName.get(norm(name))) || null;
  if (!br) return null;
  return (
    <span className={`ms-1 inline-flex shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] font-bold leading-4 text-primary align-middle whitespace-nowrap ${className}`}
          title={`حساب فرع من فروعنا: ${br} — بيعه بيتحسب «بين الفروع» في تقرير الشركة`} data-testid="internal-badge">
      فرع داخلي
    </span>
  );
}
