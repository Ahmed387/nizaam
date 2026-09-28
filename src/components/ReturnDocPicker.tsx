import { ReactNode, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PickerItemsToggle } from "@/components/PickerItemsPreview";
import { formatDate, formatEGP } from "@/lib/format";

const PAGE = 10;
const RETURNABLE_STATUSES = ["active", "نشطة", "completed", "paid"];

type Kind = "sale" | "purchase";
type Row = { id: string; number: string; name: string; phone: string; date: string | null; total: number };

/**
 * Turns a user query into a tolerant ILIKE pattern: Arabic letter variants
 * (أ/إ/آ/ا، ى/ي، ة/ه) become single-char wildcards and words are joined with %.
 */
function toIlikePattern(raw: string): string {
  const cleaned = raw
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[,()%*_"\\]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean).map((w) => w.replace(/[إأآاىيةه]/g, "_"));
  return words.length ? `%${words.join("%")}%` : "";
}

/** Inline, server-paginated invoice combobox for sale & purchase returns (branch-scoped). */
export function ReturnDocPicker({
  kind, branchId, open, onOpenChange, onPick, children,
}: { kind: Kind; branchId: string; open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: string) => void; children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setDebounced(query.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [query]);

  useEffect(() => {
    if (!open || !branchId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Same query shape as Invoices.tsx: plain %term% ILIKE, contacts resolved first, empty-list guarded.
      const term = debounced.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,()%*"\\]/g, " ").trim();
      const table = kind === "sale" ? "invoices" : "shipments";
      const numCol = kind === "sale" ? "invoice_number" : "shipment_number";
      let contactIds: string[] = [];
      if (term) {
        const { data: cs } = await supabase.from("contacts").select("id")
          .or(`name.ilike.%${term}%,phone.ilike.%${term}%`).limit(500);
        contactIds = (cs ?? []).map((c: any) => c.id).filter(Boolean);
      }
      const select = kind === "sale"
        ? "id, invoice_number, total, status, invoice_date, created_at, recipient_name, contact_id, contacts:contact_id(id, name, phone)"
        : "id, shipment_number, total_cost, invoice_date, arrival_date, contact_id, contacts:contact_id(id, name, phone)";
      let qb: any = supabase.from(table as any).select(select, { count: "exact" }).eq("branch_id", branchId);
      if (kind === "sale") qb = qb.in("status", RETURNABLE_STATUSES);
      if (term) {
        const ors = [`${numCol}.ilike.%${term}%`];
        if (kind === "sale") ors.push(`recipient_name.ilike.%${term}%`);
        if (contactIds.length > 0) ors.push(`contact_id.in.(${contactIds.join(",")})`);
        qb = qb.or(ors.join(","));
      }
      qb = qb.order("invoice_date", { ascending: false, nullsFirst: false })
        .order(kind === "sale" ? "created_at" : "arrival_date", { ascending: false })
        .range((page - 1) * PAGE, page * PAGE - 1);
      const { data, count: c, error } = await qb;
      if (error) console.error("[ReturnDocPicker Query Error]:", error);
      if (cancelled) return;
      setRows((data ?? []).map((r: any) => ({
        id: r.id,
        number: (kind === "sale" ? r.invoice_number : r.shipment_number) ?? "—",
        name: r.contacts?.name ?? (kind === "sale" ? "نقدي" : "—"),
        phone: r.contacts?.phone ?? "",
        date: r.invoice_date ?? (kind === "sale" ? r.created_at : r.arrival_date),
        total: Number(kind === "sale" ? r.total : r.total_cost) || 0,
      })));
      setCount(c ?? 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, branchId, kind, debounced, page]);

  const pageCount = Math.max(1, Math.ceil(count / PAGE));
  const party = kind === "sale" ? "العميل" : "المورد";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[min(36rem,calc(100vw-2rem))] p-0">
        <div className="p-2 border-b border-border relative">
          <Search className="w-4 h-4 text-muted-foreground absolute right-4 top-1/2 -translate-y-1/2" />
          <Input placeholder={`ابحث برقم الفاتورة أو اسم ${party} أو رقم التليفون...`} value={query}
            onChange={(e) => setQuery(e.target.value)} autoFocus className="pr-8" />
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {loading ? (
            <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">مفيش فواتير مطابقة</div>
          ) : rows.map((r) => (
            <PickerItemsToggle key={r.id} kind={kind === "sale" ? "sale" : "shipment"} branchId={branchId} docId={r.id}>
              <button type="button" onClick={() => { onOpenChange(false); onPick(r.id); }}
                className="w-full flex items-center justify-between gap-3 p-3 hover:bg-accent text-right transition-colors">
                <div className="flex flex-col items-start gap-0.5">
                  <span className="font-mono font-bold text-primary">{r.number}</span>
                  <span className="text-xs text-muted-foreground">{r.name}{r.phone ? ` • ${r.phone}` : ""}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="font-bold">{formatEGP(r.total)}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(r.date)}</span>
                </div>
              </button>
            </PickerItemsToggle>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 text-sm p-2 border-t border-border">
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} aria-label="السابقة"><ChevronRight className="w-4 h-4" /></Button>
          <span className="tabular-nums text-muted-foreground">صفحة {page} من {pageCount} ({count})</span>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)} aria-label="التالية"><ChevronLeft className="w-4 h-4" /></Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
