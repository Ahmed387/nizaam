import { AlertCircle, PackageOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEGP } from "@/lib/format";
import { useInvoiceItems } from "@/hooks/useInvoiceItems";

interface InvoiceItemsAccordionProps {
  tenantId: string;
  branchId: string;
  invoiceId: string;
  expanded: boolean;
}

export function InvoiceItemsAccordion({ tenantId, branchId, invoiceId, expanded }: InvoiceItemsAccordionProps) {
  const { data: items = [], isLoading, isError, error, refetch, isFetching } = useInvoiceItems(
    tenantId,
    branchId,
    invoiceId,
    expanded,
  );

  if (isLoading) {
    return (
      <div className="space-y-2 p-4" aria-label="جارٍ تحميل أصناف الفاتورة">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 p-5 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        <span>{error instanceof Error ? error.message : "تعذر تحميل أصناف الفاتورة"}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`ml-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex items-center justify-center gap-2 p-5 text-sm text-muted-foreground">
        <PackageOpen className="h-4 w-4" /> لا توجد أصناف مسجلة لهذه الفاتورة
      </div>
    );
  }

  return (
    <div className="overflow-x-auto p-3 md:p-4">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="p-2 text-right">#</th>
            <th className="p-2 text-right">المنتج</th>
            <th className="p-2 text-center">الكمية</th>
            <th className="p-2 text-center">سعر الوحدة</th>
            <th className="p-2 text-center">الخصم</th>
            <th className="p-2 text-left">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} className="border-b border-border/60 last:border-0">
              <td className="p-2 text-muted-foreground">{index + 1}</td>
              <td className="p-2 font-medium">{item.product_name}</td>
              <td className="p-2 text-center tabular-nums">{item.quantity}</td>
              <td className="p-2 text-center tabular-nums">{formatEGP(item.selling_price)}</td>
              <td className="p-2 text-center tabular-nums text-destructive">
                {Number(item.line_discount) > 0 ? `- ${formatEGP(item.line_discount)}` : "—"}
              </td>
              <td className="p-2 text-left font-bold tabular-nums">{formatEGP(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}