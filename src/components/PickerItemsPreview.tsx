import { useState } from "react";
import { PermTable } from "@/components/PermTable";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useInvoiceItems } from "@/hooks/useInvoiceItems";
import { useDocumentItems } from "@/hooks/useDocumentItems";
import { formatEGP } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = { id: string; name: string; qty: number; price: number | null; total: number };

/** Read-only, lazy items preview for picker rows. Fetches only on expand; React Query caches per doc. */
function PreviewTable({ rows, loading, error }: { rows: Row[]; loading: boolean; error: boolean }) {
  if (loading)
    return (
      <div className="space-y-1.5 p-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  if (error) return <div className="p-3 text-center text-xs text-destructive">تعذر تحميل الأصناف</div>;
  if (!rows.length) return <div className="p-3 text-center text-xs text-muted-foreground">لا توجد أصناف</div>;
  return (
    <PermTable noFilter className="w-full text-xs">
      <thead>
        <tr className="bg-muted text-muted-foreground">
          <th className="p-1.5 text-right font-semibold">اسم الصنف</th>
          <th className="p-1.5 text-center font-semibold">الكمية</th>
          <th className="p-1.5 text-center font-semibold">السعر</th>
          <th className="p-1.5 text-left font-semibold">الإجمالي</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="p-1.5 text-right text-foreground">{r.name}</td>
            <td className="p-1.5 text-center tabular-nums">{r.qty}</td>
            <td className="p-1.5 text-center tabular-nums">{r.price != null ? formatEGP(r.price) : "—"}</td>
            <td className="p-1.5 text-left font-semibold tabular-nums">{formatEGP(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </PermTable>
  );
}

function SaleBody({ branchId, docId }: { branchId: string; docId: string }) {
  const { tenantId } = useAuth();
  const q = useInvoiceItems(tenantId, branchId, docId, true);
  const rows: Row[] = (q.data ?? []).map((i) => ({
    id: i.id, name: i.product_name, qty: Number(i.quantity), price: Number(i.selling_price), total: Number(i.total),
  }));
  return <PreviewTable rows={rows} loading={q.isLoading} error={q.isError} />;
}

function ShipmentBody({ branchId, docId }: { branchId: string; docId: string }) {
  const { tenantId } = useAuth();
  const q = useDocumentItems("shipment", tenantId, branchId, docId, true);
  const rows: Row[] = (q.data ?? []).map((i) => ({
    id: i.id, name: i.product_name, qty: i.quantity, price: i.unit_price, total: i.total,
  }));
  return <PreviewTable rows={rows} loading={q.isLoading} error={q.isError} />;
}

export function PickerItemsToggle({
  kind, branchId, docId, children,
}: { kind: "sale" | "shipment"; branchId: string; docId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-stretch">
        <button
          type="button"
          aria-label={open ? "إخفاء الأصناف" : "عرض الأصناف"}
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((o) => !o); }}
          className={cn("flex w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors", open && "text-primary")}
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {open && (
        <div className="mx-3 mb-3 overflow-hidden rounded-md border border-border bg-muted/30" onClick={(e) => e.stopPropagation()}>
          {kind === "sale" ? <SaleBody branchId={branchId} docId={docId} /> : <ShipmentBody branchId={branchId} docId={docId} />}
        </div>
      )}
    </div>
  );
}
