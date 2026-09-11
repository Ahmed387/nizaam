import { AlertCircle, PackageOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatEGP } from "@/lib/format";
import { useInvoiceItems } from "@/hooks/useInvoiceItems";
import { cn } from "@/lib/utils";

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

  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalAmount = items.reduce((sum, item) => sum + Number(item.total || 0), 0);

  const Container = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div
      className={cn(
        "mx-4 my-2 rounded-xl border border-slate-200/80 bg-slate-100/90 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/80",
        "border-r-4 border-r-blue-600 dark:border-r-blue-500",
        className,
      )}
    >
      {children}
    </div>
  );

  if (isLoading) {
    return (
      <Container className="p-4" aria-label="جارٍ تحميل أصناف الفاتورة">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="mt-2 h-9 w-full" />
      </Container>
    );
  }

  if (isError) {
    return (
      <Container>
        <div className="flex flex-wrap items-center justify-center gap-3 p-5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error instanceof Error ? error.message : "تعذر تحميل أصناف الفاتورة"}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`ml-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> إعادة المحاولة
          </Button>
        </div>
      </Container>
    );
  }

  if (!items.length) {
    return (
      <Container>
        <div className="flex items-center justify-center gap-2 p-5 text-sm text-muted-foreground">
          <PackageOpen className="h-4 w-4" /> لا توجد أصناف مسجلة لهذه الفاتورة
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <div className="overflow-x-auto p-3 md:p-4">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <th className="rounded-tr-lg p-2.5 text-right font-bold">#</th>
              <th className="p-2.5 text-right font-bold">المنتج</th>
              <th className="p-2.5 text-center font-bold">الكمية</th>
              <th className="p-2.5 text-center font-bold">سعر الوحدة</th>
              <th className="p-2.5 text-center font-bold">الخصم</th>
              <th className="rounded-tl-lg p-2.5 text-left font-bold">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.map((item, index) => (
              <tr key={item.id} className="transition-colors hover:bg-blue-50/40 dark:hover:bg-blue-950/20">
                <td className="p-2.5 align-middle">
                  <Badge
                    variant="secondary"
                    className="h-6 w-6 justify-center rounded-full border border-slate-300/60 bg-slate-100 p-0 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {index + 1}
                  </Badge>
                </td>
                <td className="p-2.5 text-right align-middle">
                  <div className="font-semibold text-foreground">{item.product_name}</div>
                  {item.product_name && item.product_name.length > 40 && (
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">اسم الصنف مفصل — يُعرض كاملاً أعلاه</div>
                  )}
                </td>
                <td className="p-2.5 text-center align-middle">
                  <Badge
                    variant="outline"
                    className="border-blue-200 bg-blue-50/70 px-2.5 text-xs font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    {item.quantity}
                  </Badge>
                </td>
                <td className="p-2.5 text-center align-middle tabular-nums text-foreground">
                  {formatEGP(item.selling_price)}
                </td>
                <td className="p-2.5 text-center align-middle tabular-nums text-destructive">
                  {Number(item.line_discount) > 0 ? `- ${formatEGP(item.line_discount)}` : "—"}
                </td>
                <td className="p-2.5 text-left align-middle font-bold tabular-nums text-foreground">
                  {formatEGP(item.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary highlight bar */}
      <div className="rounded-b-xl border-t border-slate-200/80 bg-gradient-to-l from-blue-600/10 to-slate-200/60 p-3 dark:border-slate-800/80 dark:from-blue-600/15 dark:to-slate-800/60">
        <div className="flex flex-wrap items-center justify-end gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">عدد الأصناف:</span>
            <Badge variant="secondary" className="font-bold">
              {items.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">إجمالي القطع:</span>
            <Badge variant="secondary" className="font-bold">
              {totalQuantity}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">إجمالي البضاعة:</span>
            <span className="font-extrabold text-foreground">{formatEGP(totalAmount)}</span>
          </div>
        </div>
      </div>
    </Container>
  );
}
