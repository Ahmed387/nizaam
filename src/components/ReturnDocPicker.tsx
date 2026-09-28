import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PickerItemsToggle } from "@/components/PickerItemsPreview";
import { formatDate, formatEGP } from "@/lib/format";

const PAGE = 10;
const RETURNABLE_STATUSES = ["active", "نشطة", "completed", "paid"];

type Kind = "sale" | "purchase";
type Row = { id: string; number: string; name: string; phone: string; date: string | null; total: number };

/** Shared, server-paginated invoice picker for sale & purchase returns (branch-scoped). */
export function ReturnDocPicker({
  kind, branchId, open, onOpenChange, onPick,
}: { kind: Kind; branchId: string; open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: string) => void }) {
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
      const q = debounced.replace(/[,()%*]/g, " ").trim();
      let contactIds: string[] = [];
      if (q) {
        const { data: cs } = await supabase.from("contacts").select("id")
          .or(`name.ilike.%${q}%,phone.ilike.%${q}%`).limit(200);
        contactIds = (cs ?? []).map((c: any) => c.id);
      }
      const table = kind === "sale" ? "invoices" : "shipments";
      const numCol = kind === "sale" ? "invoice_number" : "shipment_number";
      const select = kind === "sale"
        ? "id, invoice_number, total, invoice_date, created_at, contacts:contact_id(name, phone)"
        : "id, shipment_number, total_cost, invoice_date, arrival_date, contacts:contact_id(name, phone)";
      let qb: any = supabase.from(table as any).select(select, { count: "exact" }).eq("branch_id", branchId);
      if (kind === "sale") qb = qb.in("status", RETURNABLE_STATUSES);
      if (q) {
        const ors = [`${numCol}.ilike.%${q}%`];
        if (contactIds.length) ors.push(`contact_id.in.(${contactIds.join(",")})`);
        qb = qb.or(ors.join(","));
      }
      qb = qb.order("invoice_date", { ascending: false, nullsFirst: false })
        .order(kind === "sale" ? "created_at" : "arrival_date", { ascending: false })
        .range((page - 1) * PAGE, page * PAGE - 1);
      const { data, count: c } = await qb;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{kind === "sale" ? "اختر فاتورة لإنشاء مرتجع" : "اختر فاتورة شراء لإنشاء مرتجع"}</DialogTitle>
          <DialogDescription>كل مرتجع لازم يكون مربوط بفاتورة موجودة.</DialogDescription>
        </DialogHeader>
        <Input placeholder={`ابحث برقم الفاتورة أو اسم ${party} أو رقم التليفون...`} value={query}
          onChange={(e) => setQuery(e.target.value)} autoFocus />
        <div className="max-h-[420px] overflow-y-auto border border-border rounded-lg">
          {loading ? (
            <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">مفيش فواتير مطابقة</div>
          ) : rows.map((r) => (
            <PickerItemsToggle key={r.id} kind={kind === "sale" ? "sale" : "shipment"} branchId={branchId} docId={r.id}>
              <button onClick={() => { onOpenChange(false); onPick(r.id); }}
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
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} aria-label="السابقة"><ChevronRight className="w-4 h-4" /></Button>
          <span className="tabular-nums text-muted-foreground">صفحة {page} من {pageCount} ({count})</span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)} aria-label="التالية"><ChevronLeft className="w-4 h-4" /></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
