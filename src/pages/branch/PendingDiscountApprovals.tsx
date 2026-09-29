import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { scopeToBranch } from "@/lib/branchQuery";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { toast } from "sonner";
import { formatEGP, formatDateTime } from "@/lib/format";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { notify } from "@/lib/notifications";

interface Req {
  id: string;
  branch_id: string;
  cashier_id: string;
  cashier_name: string;
  product_name: string;
  original_price: number;
  requested_price: number;
  discount_percent: number;
  quantity: number;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export default function PendingDiscountApprovals() {
  const { tenantId, user, hasRole, isAdmin } = useAuth();
  const canDecide = isAdmin || hasRole("branch_manager");
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [decision, setDecision] = useState<{ req: Req; type: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { id: branchId } = useParams<{ id: string }>();
  const load = async () => {
    setLoading(true);
    const { data } = await scopeToBranch(
      supabase.from("discount_approval_requests" as any).select("*") as any,
      branchId, tenantId,
    ).order("created_at", { ascending: false });
    setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { if (tenantId) load(); }, [tenantId, branchId]);
  useRealtimeRefresh(["discount_approval_requests"], load);

  const filtered = rows.filter((r) => tab === "pending" ? r.status === "pending" : r.status !== "pending");

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    const { error } = await supabase.from("discount_approval_requests" as any).update({
      status: decision.type === "approve" ? "approved" : "rejected",
      decided_by: user?.id,
      decided_at: new Date().toISOString(),
      admin_note: note || null,
    }).eq("id", decision.req.id);
    if (error) { setBusy(false); return toast.error(error.message); }

    // Notify cashier
    try {
      await notify({
        userId: decision.req.cashier_id ?? (decision.req as any).cashier_id,
        title: decision.type === "approve" ? "تمت الموافقة على طلب الخصم" : "تم رفض طلب الخصم",
        body: `${decision.req.product_name}${note ? ` — ${note}` : ""}`,
        link: `/branch/${decision.req.branch_id}/sales/new`,
      });
    } catch (e) { console.warn("notify cashier failed", e); }

    setBusy(false);
    toast.success(decision.type === "approve" ? "تمت الموافقة" : "تم الرفض");
    setDecision(null);
    setNote("");
    load();
  };

  return (
    <BranchLayout>
      <PageHeader title="موافقات الخصم" subtitle="طلبات الكاشير لتخفيض الأسعار" />

      <div className="flex gap-2 mb-4">
        <Button variant={tab === "pending" ? "default" : "outline"} onClick={() => setTab("pending")}>
          <Clock className="w-4 h-4 ml-1" /> المعلّقة ({rows.filter(r => r.status === "pending").length})
        </Button>
        <Button variant={tab === "decided" ? "default" : "outline"} onClick={() => setTab("decided")}>
          المنتهية ({rows.filter(r => r.status !== "pending").length})
        </Button>
      </div>

      <DataTable loading={loading} rows={filtered as any} columns={[
        { key: "created_at", header: "الوقت", render: (r: Req) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
        { key: "cashier_name", header: "الكاشير" },
        { key: "product_name", header: "المنتج", render: (r: Req) => <span className="font-semibold">{r.product_name}</span> },
        { key: "quantity", header: "الكمية", render: (r: Req) => r.quantity },
        { key: "original_price", header: "السعر الأصلي", render: (r: Req) => formatEGP(r.original_price) },
        { key: "requested_price", header: "السعر المطلوب", render: (r: Req) => formatEGP(r.requested_price) },
        { key: "discount_percent", header: "الخصم %", render: (r: Req) => <span className="text-destructive font-bold">{Number(r.discount_percent).toFixed(1)}%</span> },
        { key: "status", header: "الحالة", render: (r: Req) => {
          if (r.status === "pending") return <span className="px-2 py-1 rounded text-xs bg-warning/10 text-warning">معلّق</span>;
          if (r.status === "approved") return <span className="px-2 py-1 rounded text-xs bg-success/10 text-success">موافق</span>;
          return <span className="px-2 py-1 rounded text-xs bg-destructive/10 text-destructive">مرفوض</span>;
        }},
        { key: "actions", header: "إجراءات", render: (r: Req) => r.status === "pending" && canDecide ? (
          <div className="flex gap-1">
            <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground" onClick={() => { setDecision({ req: r, type: "approve" }); setNote(""); }}>
              <CheckCircle2 className="w-3.5 h-3.5 ml-1" /> موافقة
            </Button>
            <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={() => { setDecision({ req: r, type: "reject" }); setNote(""); }}>
              <XCircle className="w-3.5 h-3.5 ml-1" /> رفض
            </Button>
          </div>
        ) : <span className="text-xs text-muted-foreground">{r.admin_note ?? "—"}</span> },
      ]} />

      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.type === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div><b>الكاشير:</b> {decision?.req.cashier_name}</div>
            <div><b>المنتج:</b> {decision?.req.product_name}</div>
            <div><b>السعر الأصلي:</b> {formatEGP(decision?.req.original_price ?? 0)}</div>
            <div><b>السعر المطلوب:</b> {formatEGP(decision?.req.requested_price ?? 0)}</div>
            <div><b>الخصم:</b> {Number(decision?.req.discount_percent ?? 0).toFixed(1)}%</div>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={busy}>إلغاء</Button>
            <Button
              className={decision?.type === "approve" ? "bg-success hover:bg-success/90 text-success-foreground" : ""}
              variant={decision?.type === "approve" ? "default" : "destructive"}
              onClick={decide} disabled={busy}
            >
              {decision?.type === "approve" ? "موافقة" : "رفض"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
