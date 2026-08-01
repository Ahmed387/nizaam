import { useEffect, useState } from "react";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { toast } from "sonner";
import { formatEGP, formatDateTime } from "@/lib/format";
import { CheckCircle2, XCircle, Clock, Trash2 } from "lucide-react";

interface VoidReq {
  id: string;
  branch_id: string | null;
  entity_id: string;
  entity_label: string;
  reason: string | null;
  payload: any;
  status: "pending" | "approved" | "rejected";
  requested_by_name: string;
  admin_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export default function PendingVoidApprovals() {
  const { isAdmin, isOwner, hasRole } = useAuth();
  const canDecide = isAdmin || isOwner || hasRole("branch_manager");
  const [rows, setRows] = useState<VoidReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [decision, setDecision] = useState<{ req: VoidReq; type: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("approval_requests" as any)
      .select("*")
      .eq("entity_type", "payment_void")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows(((data as any) ?? []) as VoidReq[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeRefresh([{ table: "approval_requests" }], load);

  const submitDecision = async () => {
    if (!decision) return;
    if (decision.type === "reject" && note.trim().length < 3) {
      toast.error("اكتب سبب الرفض");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("decide_payment_void_request" as any, {
      p_request_id: decision.req.id,
      p_approve: decision.type === "approve",
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(decision.type === "approve" ? "تمت الموافقة وتنفيذ الإلغاء" : "تم رفض الطلب");
    setDecision(null);
    setNote("");
    load();
  };

  const list = rows.filter((r) => (tab === "pending" ? r.status === "pending" : r.status !== "pending"));

  return (
    <BranchLayout>
      <PageHeader title="طلبات إلغاء الدفعات" subtitle="مراجعة طلبات الكاشير لإلغاء دفعة مع سبب الإلغاء" />

      <div className="flex gap-2 mb-4">
        <Button variant={tab === "pending" ? "default" : "outline"} size="sm" onClick={() => setTab("pending")} className="gap-1">
          <Clock className="w-4 h-4" /> معلّقة ({rows.filter((r) => r.status === "pending").length})
        </Button>
        <Button variant={tab === "decided" ? "default" : "outline"} size="sm" onClick={() => setTab("decided")}>
          تم البت فيها
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm p-4">جاري التحميل…</div>
      ) : !list.length ? (
        <div className="card-elevated p-8 text-center text-muted-foreground text-sm">لا توجد طلبات</div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <div key={r.id} className="card-elevated p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-destructive" />
                  <b>{r.entity_label}</b>
                </div>
                {r.status === "pending" && <Badge variant="secondary">معلّق</Badge>}
                {r.status === "approved" && <Badge className="bg-success text-success-foreground">تمت الموافقة</Badge>}
                {r.status === "rejected" && <Badge variant="destructive">مرفوض</Badge>}
              </div>

              <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
                <span>الكاشير: <b className="text-foreground">{r.requested_by_name}</b></span>
                <span>المبلغ: <b className="text-foreground">{formatEGP(Number(r.payload?.amount ?? 0))}</b></span>
                <span>الطريقة: <b className="text-foreground">{r.payload?.payment_method ?? "-"}</b></span>
                <span className="sm:col-span-3">التاريخ: {formatDateTime(r.created_at)}</span>
              </div>

              <div className="rounded-md bg-surface-2 p-3 text-sm">
                <span className="text-muted-foreground block text-xs mb-1">سبب الإلغاء</span>
                {r.reason || "—"}
              </div>

              {r.admin_note && (
                <div className="rounded-md bg-surface-2 p-3 text-sm">
                  <span className="text-muted-foreground block text-xs mb-1">ملاحظة المدير</span>
                  {r.admin_note}
                </div>
              )}

              {r.status === "pending" && canDecide && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => { setNote(""); setDecision({ req: r, type: "approve" }); }} className="gap-1">
                    <CheckCircle2 className="w-4 h-4" /> موافقة وتنفيذ الإلغاء
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setNote(""); setDecision({ req: r, type: "reject" }); }}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <XCircle className="w-4 h-4" /> رفض
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!decision} onOpenChange={(o) => { if (!o) { setDecision(null); setNote(""); } }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className={decision?.type === "reject" ? "text-destructive" : ""}>
              {decision?.type === "approve" ? "تأكيد الموافقة على الإلغاء" : "رفض طلب الإلغاء"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {decision?.type === "approve"
                ? "هيتم عكس الدفعة بالكامل من الخزنة والدفتر العام، والقسط هيرجع معلّق."
                : "الدفعة هتفضل زي ما هي والطلب هيتقفل كمرفوض."}
            </p>
            <div className="rounded-md bg-surface-2 p-3">
              <span className="text-muted-foreground block text-xs mb-1">سبب الكاشير</span>
              {decision?.req.reason || "—"}
            </div>
            <label className="text-sm font-semibold block">
              ملاحظة {decision?.type === "reject" ? "(مطلوبة)" : "(اختياري)"}
            </label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecision(null)} disabled={busy}>إلغاء</Button>
            <Button
              onClick={submitDecision}
              disabled={busy}
              variant={decision?.type === "reject" ? "destructive" : "default"}
            >
              {busy ? "جاري..." : "تأكيد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
