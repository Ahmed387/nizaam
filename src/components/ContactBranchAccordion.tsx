import { useState } from "react";
import { AlertCircle, Building2, PackageOpen, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEGP } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useContactBranchBreakdown } from "@/hooks/useContactBranchBreakdown";
import { ContactSettleDialog } from "@/components/ContactSettleDialog";

interface Props {
  contactId: string;
  contactName: string;
  contactType: string;
  tenantId: string;
  /** الفرع الحالي = الفرع المستلم للنقدية عند السداد */
  receivingBranchId: string;
  expanded: boolean;
  canSettle: boolean;
  onSettled?: () => void;
}

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

const fmtDate = (v: string) => (v ? new Date(v).toLocaleDateString("ar-EG") : "—");

/** الملف المالي للجهة عبر كل الفروع — يُحمَّل فقط عند فتح الصف. */
export function ContactBranchAccordion({
  contactId,
  contactName,
  contactType,
  tenantId,
  receivingBranchId,
  expanded,
  canSettle,
  onSettled,
}: Props) {
  const { data, isLoading, isError, error, refetch, isFetching } = useContactBranchBreakdown(
    contactId,
    tenantId,
    expanded,
  );
  const [settleOpen, setSettleOpen] = useState(false);

  if (isLoading) {
    return (
      <Container className="p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="mt-2 h-24 w-full" />
      </Container>
    );
  }

  if (isError) {
    return (
      <Container>
        <div className="flex flex-wrap items-center justify-center gap-3 p-5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error instanceof Error ? error.message : "تعذر تحميل الملف المالي للجهة"}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`ml-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> إعادة المحاولة
          </Button>
        </div>
      </Container>
    );
  }

  if (!data) return null;
  const { totals, branches, openInvoices } = data;
  const net = totals.net_balance;
  const canUseSettle = canSettle && (contactType === "customer" || contactType === "both");

  return (
    <Container>
      {/* Global position header */}
      <div className="grid grid-cols-2 gap-2 border-b border-slate-200/80 bg-slate-200/70 p-3 text-center dark:border-slate-800/80 dark:bg-slate-800/70 md:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">إجمالي المبيعات</div>
          <div className="font-extrabold tabular-nums">{formatEGP(totals.total_sales)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">إجمالي التوريدات</div>
          <div className="font-extrabold tabular-nums">{formatEGP(totals.total_supplies)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">إجمالي المدفوع</div>
          <div className="font-extrabold tabular-nums">{formatEGP(totals.total_paid)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">صافي الحساب</div>
          <div className={cn("font-extrabold tabular-nums", net > 0.01 ? "text-success" : net < -0.01 ? "text-destructive" : "")}>
            {formatEGP(Math.abs(net))}{" "}
            <span className="text-xs font-semibold">
              {net > 0.01 ? "(لينا عنده)" : net < -0.01 ? "(ليه عندنا)" : "(متعادل)"}
            </span>
          </div>
        </div>
      </div>

      {/* Branch breakdown */}
      <div className="p-3 md:p-4">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold">
          <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" /> التوزيع على الفروع
        </div>
        {branches.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <th className="rounded-tr-lg p-2.5 text-right font-bold">الفرع</th>
                  <th className="p-2.5 text-center font-bold">المبيعات</th>
                  <th className="p-2.5 text-center font-bold">التوريدات</th>
                  <th className="p-2.5 text-center font-bold">المدفوع بالفرع</th>
                  <th className="rounded-tl-lg p-2.5 text-left font-bold">رصيد الفرع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {branches.map((b) => (
                  <tr key={b.branch_id} className="hover:bg-blue-50/40 dark:hover:bg-blue-950/20">
                    <td className="p-2.5 text-right font-semibold">{b.branch_name}</td>
                    <td className="p-2.5 text-center tabular-nums">{formatEGP(b.total_sales)}</td>
                    <td className="p-2.5 text-center tabular-nums">{formatEGP(b.total_supplies)}</td>
                    <td className="p-2.5 text-center tabular-nums">{formatEGP(b.paid_at_branch)}</td>
                    <td
                      className={cn(
                        "p-2.5 text-left font-bold tabular-nums",
                        b.branch_balance > 0.01 ? "text-success" : b.branch_balance < -0.01 ? "text-destructive" : "",
                      )}
                    >
                      {formatEGP(Math.abs(b.branch_balance))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <PackageOpen className="h-4 w-4" /> لا توجد حركات على أي فرع
          </div>
        )}
      </div>

      {/* Open invoices */}
      <div className="px-3 pb-3 md:px-4 md:pb-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold">
            الفواتير المفتوحة{" "}
            <Badge variant="secondary" className="font-bold">{openInvoices.length}</Badge>
          </div>
          {canUseSettle && openInvoices.length > 0 && (
            <Button size="sm" className="btn-gradient gap-1.5" onClick={() => setSettleOpen(true)}>
              <Wallet className="h-4 w-4" /> سداد وإقفال
            </Button>
          )}
        </div>
        {openInvoices.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <th className="rounded-tr-lg p-2.5 text-right font-bold">رقم الفاتورة</th>
                  <th className="p-2.5 text-right font-bold">الفرع</th>
                  <th className="p-2.5 text-center font-bold">التاريخ</th>
                  <th className="p-2.5 text-center font-bold">الإجمالي</th>
                  <th className="p-2.5 text-center font-bold">المدفوع</th>
                  <th className="rounded-tl-lg p-2.5 text-left font-bold">المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {openInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-blue-50/40 dark:hover:bg-blue-950/20">
                    <td className="p-2.5 text-right font-semibold">{inv.invoice_number}</td>
                    <td className="p-2.5 text-right text-muted-foreground">{inv.branch_name}</td>
                    <td className="p-2.5 text-center">{fmtDate(inv.invoice_date)}</td>
                    <td className="p-2.5 text-center tabular-nums">{formatEGP(inv.total)}</td>
                    <td className="p-2.5 text-center tabular-nums">{formatEGP(inv.paid)}</td>
                    <td className="p-2.5 text-left font-bold tabular-nums text-destructive">
                      {formatEGP(inv.remaining)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <PackageOpen className="h-4 w-4" /> كل الفواتير مسددة
          </div>
        )}
      </div>

      {/* Summary bar */}
      <div className="rounded-b-xl border-t border-slate-200/80 bg-gradient-to-l from-blue-600/10 to-slate-200/60 p-3 dark:border-slate-800/80 dark:from-blue-600/15 dark:to-slate-800/60">
        <div className="flex flex-wrap items-center justify-end gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">عدد الفروع:</span>
            <Badge variant="secondary" className="font-bold">{branches.length}</Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">الموقف المالي الإجمالي — رصيد تحت الحساب (طرف الإدارة):</span>
            <span className="font-extrabold">{formatEGP(Math.abs(totals.credit_balance))}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">إجمالي المتبقي:</span>
            <span className="font-extrabold text-destructive">
              {formatEGP(openInvoices.reduce((s, i) => s + i.remaining, 0))}
            </span>
          </div>
        </div>
      </div>

      {settleOpen && (
        <ContactSettleDialog
          open={settleOpen}
          onOpenChange={setSettleOpen}
          contactId={contactId}
          contactName={contactName}
          receivingBranchId={receivingBranchId}
          openInvoices={openInvoices}
          onDone={() => { refetch(); onSettled?.(); }}
        />
      )}
    </Container>
  );
}
