import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { printDocuments, type PrintFormat } from "@/lib/bulkPrint";
import type { BulkKind } from "@/lib/bulkDocs";
import { SRC_LABEL, srcPath, type TreasuryLink } from "@/lib/treasuryLinks";

/** «اسم الحساب»: the customer / supplier the money belongs to (automatic vouchers get it from their document). */
export function AccountCell({ name }: { name?: string | null }) {
  return name
    ? <span className="block max-w-[190px] truncate font-semibold" title={name}>{name}</span>
    : <span className="text-muted-foreground">—</span>;
}

/** «المصدر»: the document the money came from (click to open it), else manual / automatic. */
export function SourceCell({ link, branchId, source, fallback }: { link?: TreasuryLink | null; branchId: string; source?: string | null; fallback?: string | null }) {
  const nav = useNavigate();
  const path = link ? srcPath(branchId, link) : null;
  if (link?.cancelled_voucher_number) {
    return <span className="text-xs text-destructive font-semibold whitespace-nowrap">إلغاء سند {link.cancelled_voucher_number}</span>;
  }
  if (path && link?.src_type) {
    return (
      <button type="button" className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
              onClick={(e) => { e.stopPropagation(); nav(path); }} title="فتح المستند">
        {SRC_LABEL[link.src_type]} <span className="font-mono">{link.src_number}</span>
      </button>
    );
  }
  if (fallback) return <span className="text-xs text-muted-foreground whitespace-nowrap">{fallback}</span>;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${source === "manual" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
      {source === "manual" ? "يدوي" : "تلقائي"}
    </span>
  );
}

/** One document's print button: A4 or 80mm, same layout as «طباعة الكل». */
export function PrintDocButton({ kind, id, title = "طباعة" }: { kind: BulkKind; id: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const go = async (f: PrintFormat) => {
    setOpen(false);
    try { await printDocuments(kind, [id], f); } catch (e: any) { toast.error(e?.message ?? "تعذر الطباعة"); }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title={title} onClick={(e) => e.stopPropagation()}>
          <Printer className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="center" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="w-full rounded px-2 py-1.5 text-right text-sm hover:bg-muted" onClick={() => go("a4")}>A4</button>
        <button type="button" className="w-full rounded px-2 py-1.5 text-right text-sm hover:bg-muted" onClick={() => go("thermal")}>حراري 80mm</button>
      </PopoverContent>
    </Popover>
  );
}
