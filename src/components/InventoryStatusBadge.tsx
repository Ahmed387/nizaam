import { forwardRef } from "react";
import { Badge } from "@/components/ui/badge";

export const INV_STATUS_LABELS: Record<string, string> = {
  counting: "جارٍ العد",
  reviewing: "قيد المراجعة",
  pending_approval: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
  closed: "مغلق",
  cancelled: "ملغى",
};

const STYLES: Record<string, string> = {
  counting: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  reviewing: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  pending_approval: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  approved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-600 border-red-500/30",
  closed: "bg-slate-500/15 text-slate-600 border-slate-500/30",
  cancelled: "bg-gray-500/15 text-gray-600 border-gray-500/30",
};

export const InventoryStatusBadge = forwardRef<
  HTMLDivElement,
  { status: string } & React.HTMLAttributes<HTMLDivElement>
>(function InventoryStatusBadge({ status, className = "", ...rest }, ref) {
  return (
    <Badge ref={ref} variant="outline" {...rest} className={`${STYLES[status] ?? ""} ${className}`}>
      {INV_STATUS_LABELS[status] ?? status}
    </Badge>
  );
});
