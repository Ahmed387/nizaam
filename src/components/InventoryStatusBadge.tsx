import { Badge } from "@/components/ui/badge";

export const INV_STATUS_LABELS: Record<string, string> = {
  counting: "جارٍ العد",
  reviewing: "قيد المراجعة",
  pending_approval: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
  closed: "مغلق",
};

const STYLES: Record<string, string> = {
  counting: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  reviewing: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  pending_approval: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  approved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-600 border-red-500/30",
  closed: "bg-slate-500/15 text-slate-600 border-slate-500/30",
};

export function InventoryStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STYLES[status] ?? ""}>
      {INV_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
