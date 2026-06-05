import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import { CheckCircle2, XCircle, Clock } from "lucide-react";

interface Req {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  action: "delete" | "update";
  payload: any;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  requested_by_name: string;
  admin_note: string | null;
  created_at: string;
  decided_at: string | null;
}

const ENTITY_LABEL: Record<string, string> = {
  contact: "جهة تواصل",
  invoice: "فاتورة",
  shipment: "شحنة",
};

export default function ApprovalRequests() {
  const { tenantId, user, profile } = useAuth();
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [decision, setDecision] = useState<{ req: Req; type: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("approval_requests" as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { if (tenantId) load(); }, [tenantId]);
  useRealtimeRefresh(["approval_requests"], load);

  const filtered = rows.filter((r) => tab === "pending" ? r.status === "pending" : r.status !== "pending");

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    const { error } = await supabase.from("approval_requests" as any).update({
      status: decision.type === "approve" ? "approved" : "rejected",
      admin_id: user?.id,
      admin_note: note || null,
    }).eq("id", decision.req.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(decision.type === "approve" ? "تمت الموافقة وتنفيذ الإجراء" : "تم رفض الطلب");
    setDecision(null);
    setNote("");
    load();
  };

  return (
    <AdminLayout>
      <PageHeader title="طلبات الموافقة" subtitle="طلبات الحذف والتعديل من مدراء الفروع" />

      <div className="flex gap-2 mb-4">
        <Button variant={tab === "pending" ? "default" : "outline"} onClick={() => setTab("pending")}>
          <Clock className="w-4 h-4 ml-1" /> المعلّقة ({rows.filter(r => r.status === "pending").length})
        </Button>
        <Button variant={tab === "decided" ? "default" : "outline"} onClick={() => setTab("decided")}>
          المنتهية ({rows.filter(r => r.status !== "pending").length})
        </Button>
      </div>

      <DataTable loading={loading} rows={filtered as any} columns={[
        { key: "created_at", header: "التاريخ", render: (r: Req) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
        { key: "requested_by_name", header: "مقدم الطلب" },
        { key: "action", header: "النوع", render: (r: Req) => (
          <span className={`px-2 py-1 rounded text-xs ${r.action === "delete" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
            {r.action === "delete" ? "حذف" : "تعديل"}
          </span>
        )},
        { key: "entity_type", header: "النوع", render: (r: Req) => <span className="text-sm">{ENTITY_LABEL[r.entity_type] ?? r.entity_type}</span> },
        { key: "entity_label", header: "العنصر", render: (r: Req) => <span className="font-semibold">{r.entity_label}</span> },
        { key: "reason", header: "السبب", render: (r: Req) => <span className="text-xs text-muted-foreground">{r.reason ?? "—"}</span> },
        { key: "status", header: "الحالة", render: (r: Req) => {
          if (r.status === "pending") return <span className="px-2 py-1 rounded text-xs bg-warning/10 text-warning">معلّق</span>;
          if (r.status === "approved") return <span className="px-2 py-1 rounded text-xs bg-success/10 text-success">موافق</span>;
          return <span className="px-2 py-1 rounded text-xs bg-destructive/10 text-destructive">مرفوض</span>;
        }},
        { key: "actions", header: "إجراءات", render: (r: Req) => r.status === "pending" ? (
          <div className="flex gap-1">
            <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground" onClick={() => { setDecision({ req: r, type: "approve" }); setNote(""); }}>
              <CheckCircle2 className="w-3.5 h-3.5 ml-1" /> موافقة
            </Button>
            <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={() => { setDecision({ req: r, type: "reject" }); setNote(""); }}>
              <XCircle className="w-3.5 h-3.5 ml-1" /> رفض
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{r.admin_note ?? "—"}</span>
        )},
      ]} />

      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.type === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}</DialogTitle>
            <DialogDescription>
              {decision?.req.requested_by_name} يطلب {decision?.req.action === "delete" ? "حذف" : "تعديل"} <b>{decision?.req.entity_label}</b>
              {decision?.req.reason && <div className="mt-2 text-sm">السبب: {decision.req.reason}</div>}
              {decision?.req.action === "update" && decision?.req.payload && (
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">{JSON.stringify(decision.req.payload, null, 2)}</pre>
              )}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>ملاحظة (اختياري)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5" placeholder="ملاحظتك تظهر لمدير الفرع في الإشعار" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={busy}>إلغاء</Button>
            <Button
              className={decision?.type === "approve" ? "bg-success hover:bg-success/90 text-success-foreground" : ""}
              variant={decision?.type === "approve" ? "default" : "destructive"}
              onClick={decide}
              disabled={busy}
            >
              {decision?.type === "approve" ? "موافقة وتنفيذ" : "رفض"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
