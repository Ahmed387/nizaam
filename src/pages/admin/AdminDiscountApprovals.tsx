import { Fragment, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { toast } from "sonner";
import { formatEGP, formatDateTime } from "@/lib/format";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { notify } from "@/lib/notifications";
import { loadDiscountPolicy } from "@/lib/discountPolicy";
import { useBranchScope } from "@/lib/branchScope";

interface Req {
  id: string;
  branch_id: string;
  cashier_id: string;
  cashier_name: string;
  product_id: string | null;
  product_name: string;
  original_price: number;
  requested_price: number;
  discount_percent: number;
  quantity: number;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
  draft_payload: any;
}

interface Group {
  draft_id: string;
  branch_id: string;
  branch_name: string;
  cashier_name: string;
  cashier_id: string;
  items_count: number;
  invoice_value: number;
  max_pct: number;
  allowed_pct: number;
  diff: number;
  status: "pending" | "approved" | "rejected" | "mixed";
  created_at: string;
  req_ids: string[];
  reqs: Req[];
  expired: boolean;
}

const EXPIRY_HOURS = 24;
const isExpired = (createdAt: string) =>
  Date.now() - new Date(createdAt).getTime() > EXPIRY_HOURS * 3600_000;

export default function AdminDiscountApprovals({ embedded }: { embedded?: boolean } = {}) {
  const Wrapper: any = embedded ? Fragment : AdminLayout;
  const { tenantId, user } = useAuth();
  const [rows, setRows] = useState<Req[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const { filterBranches } = useBranchScope();
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [allowed, setAllowed] = useState<Record<string, number>>({}); // branch_id -> %
  const [decision, setDecision] = useState<{ group: Group; type: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  // Load current available stock per product for the open decision group.
  useEffect(() => {
    (async () => {
      if (!decision) { setStockMap({}); return; }
      const ids = Array.from(new Set(decision.group.reqs.map((r) => r.product_id).filter(Boolean))) as string[];
      if (!ids.length) return;
      const entries = await Promise.all(ids.map(async (pid) => {
        const { data } = await supabase.rpc("get_available_quantity" as any, {
          p_product_id: pid, p_branch_id: decision.group.branch_id,
        });
        return [pid, Number(data ?? 0)] as [string, number];
      }));
      setStockMap(Object.fromEntries(entries));
    })();
  }, [decision]);

  const load = async () => {
    setLoading(true);
    const [{ data: br }, { data }, policy] = await Promise.all([
      supabase.from("branches").select("id, name").eq("tenant_id", tenantId).neq("code", "PARTNER-CASH"),
      supabase.from("discount_approval_requests" as any).select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      loadDiscountPolicy(),
    ]);
    setBranches(filterBranches((br ?? []) as any) as any);
    const allRows = (data ?? []) as any as Req[];
    // Auto-reject any pending request older than 24h — reservation is no longer valid.
    const expiredIds = allRows.filter((r) => r.status === "pending" && isExpired(r.created_at)).map((r) => r.id);
    if (expiredIds.length > 0) {
      await supabase.from("discount_approval_requests" as any).update({
        status: "rejected",
        decided_at: new Date().toISOString(),
        admin_note: "انتهت صلاحية الحجز (24 ساعة) — الطلب مرفوض تلقائياً",
      }).in("id", expiredIds);
      allRows.forEach((r) => { if (expiredIds.includes(r.id)) { r.status = "rejected"; (r as any).admin_note = "انتهت صلاحية الحجز (24 ساعة) — الطلب مرفوض تلقائياً"; } });
    }
    setRows(allRows);
    const map: Record<string, number> = {};
    if (policy?.mode === "global") {
      (br ?? []).forEach((b: any) => { map[b.id] = policy.percent; });
    } else if (policy?.mode === "per_branch") {
      Object.assign(map, policy.branches);
    } else {
      (br ?? []).forEach((b: any) => { map[b.id] = 10; });
    }
    setAllowed(map);
    setLoading(false);
  };

  useEffect(() => { if (tenantId) load(); /* eslint-disable-next-line */ }, [tenantId]);
  useRealtimeRefresh(["discount_approval_requests", "settings"], load);

  const groups = useMemo<Group[]>(() => {
    const branchMap = new Map(branches.map((b: any) => [b.id, b.name]));
    const map = new Map<string, Group>();
    for (const r of rows) {
      const did = r.draft_payload?.draft_id ?? r.id;
      const itemValue = Math.max(0, Number(r.requested_price) * Number(r.quantity));
      const g = map.get(did) ?? {
        draft_id: did,
        branch_id: r.branch_id,
        branch_name: (branchMap.get(r.branch_id) as string) ?? "—",
        cashier_id: r.cashier_id,
        cashier_name: r.cashier_name,
        items_count: 0,
        invoice_value: 0,
        max_pct: 0,
        allowed_pct: allowed[r.branch_id] ?? 10,
        diff: 0,
        status: r.status,
        created_at: r.created_at,
        req_ids: [],
        reqs: [],
        expired: false,
      };
      g.items_count += 1;
      g.invoice_value += itemValue;
      g.max_pct = Math.max(g.max_pct, Number(r.discount_percent));
      g.req_ids.push(r.id);
      g.reqs.push(r);
      // status aggregation
      if (g.reqs.length > 1) {
        const statuses = new Set(g.reqs.map((x) => x.status));
        g.status = statuses.size === 1 ? (g.reqs[0].status as any) : "mixed";
      }
      map.set(did, g);
    }
    for (const g of map.values()) {
      g.diff = Math.max(0, g.max_pct - g.allowed_pct);
      g.expired = isExpired(g.created_at);
    }
    return Array.from(map.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [rows, branches, allowed]);

  const filtered = groups.filter((g) => {
    if (branchFilter && g.branch_id !== branchFilter) return false;
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    return true;
  });

  const decide = async () => {
    if (!decision) return;
    if (decision.type === "reject" && !note.trim()) return toast.error("اكتب سبب الرفض");
    setBusy(true);
    const newStatus = decision.type === "approve" ? "approved" : "rejected";
    const { error } = await supabase.from("discount_approval_requests" as any).update({
      status: newStatus,
      decided_by: user?.id,
      decided_at: new Date().toISOString(),
      admin_note: note || null,
    }).in("id", decision.group.req_ids);
    if (error) { setBusy(false); return toast.error(error.message); }

    try {
      const allowedPct = decision.group.allowed_pct;
      await notify({
        userId: decision.group.cashier_id,
        title: decision.type === "approve" ? "تمت الموافقة على الخصم" : "تم رفض الخصم",
        body: decision.type === "approve"
          ? "تمت الموافقة على الخصم — أتمم الفاتورة"
          : `تم رفض الخصم — أقصى خصم مسموح به ${allowedPct}%${note ? ` — ${note}` : ""}`,
        type: "general",
        link: `/branch/${decision.group.branch_id}/sales/new`,
      });
    } catch (e) { console.warn("notify cashier failed", e); }

    setBusy(false);
    toast.success(decision.type === "approve" ? "تمت الموافقة" : "تم الرفض");
    setDecision(null);
    setNote("");
    load();
  };

  const pendingCount = groups.filter((g) => g.status === "pending").length;

  return (
    <Wrapper>
      <PageHeader title="موافقات الخصم" subtitle="طلبات الكاشير لتخفيض الأسعار — كل الفروع" />

      <div className="card-elevated p-4 mb-4 grid md:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">الفرع</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">كل الفروع</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">الحالة</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="pending">معلق</option>
            <option value="approved">موافق عليه</option>
            <option value="rejected">مرفوض</option>
            <option value="all">الكل</option>
          </select>
        </div>
        <div className="flex items-end">
          <div className="text-sm">المعلق الآن: <span className="font-bold text-warning">{pendingCount}</span></div>
        </div>
      </div>

      <DataTable loading={loading} rows={filtered as any} columns={[
        { key: "created_at", header: "الوقت", render: (g: Group) => <span className="text-xs">{formatDateTime(g.created_at)}</span> },
        { key: "branch_name", header: "الفرع" },
        { key: "cashier_name", header: "الكاشير" },
        { key: "items_count", header: "المنتجات", render: (g: Group) => `${g.items_count} صنف` },
        { key: "invoice_value", header: "قيمة الفاتورة", render: (g: Group) => formatEGP(g.invoice_value) },
        { key: "max_pct", header: "الخصم المطلوب %", render: (g: Group) => <span className="text-destructive font-bold">{g.max_pct.toFixed(1)}%</span> },
        { key: "allowed_pct", header: "الحد المسموح %", render: (g: Group) => `${Number(g.allowed_pct).toFixed(1)}%` },
        { key: "diff", header: "الفرق", render: (g: Group) => <span className="text-warning font-bold">+{g.diff.toFixed(1)}%</span> },
        { key: "status", header: "الحالة", render: (g: Group) => {
          if (g.expired && g.status === "pending") return <span className="px-2 py-1 rounded text-xs bg-destructive/15 text-destructive font-bold">منتهي الصلاحية</span>;
          if (g.status === "pending") {
            const hoursLeft = Math.max(0, EXPIRY_HOURS - (Date.now() - new Date(g.created_at).getTime()) / 3600_000);
            return <span className="px-2 py-1 rounded text-xs bg-warning/10 text-warning">معلّق · باقي {hoursLeft.toFixed(1)}س</span>;
          }
          if (g.status === "approved") return <span className="px-2 py-1 rounded text-xs bg-success/10 text-success">موافق</span>;
          if (g.status === "rejected") return <span className="px-2 py-1 rounded text-xs bg-destructive/10 text-destructive">مرفوض</span>;
          return <span className="px-2 py-1 rounded text-xs bg-muted">مختلط</span>;
        }},
        { key: "actions", header: "إجراء", render: (g: Group) => {
          if (g.expired && g.status === "pending") {
            return <span className="text-xs text-destructive font-semibold">انتهت صلاحية الحجز — سيُرفض تلقائياً</span>;
          }
          return g.status === "pending" ? (
            <div className="flex gap-1">
              <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground" onClick={() => { setDecision({ group: g, type: "approve" }); setNote(""); }}>
                <CheckCircle2 className="w-3.5 h-3.5 ml-1" /> موافقة
              </Button>
              <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={() => { setDecision({ group: g, type: "reject" }); setNote(""); }}>
                <XCircle className="w-3.5 h-3.5 ml-1" /> رفض
              </Button>
            </div>
          ) : <span className="text-xs text-muted-foreground">{g.reqs[0]?.admin_note ?? "—"}</span>;
        }},
      ]} />

      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.type === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}</DialogTitle>
          </DialogHeader>
          {decision && (
            <div className="space-y-2 text-sm">
              <div><b>الفرع:</b> {decision.group.branch_name}</div>
              <div><b>الكاشير:</b> {decision.group.cashier_name}</div>
              <div><b>عدد الأصناف:</b> {decision.group.items_count}</div>
              <div><b>قيمة الفاتورة:</b> {formatEGP(decision.group.invoice_value)}</div>
              <div><b>الخصم المطلوب:</b> {decision.group.max_pct.toFixed(1)}% (الحد {decision.group.allowed_pct}%)</div>
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border rounded p-2 bg-muted/30">
                {decision.group.reqs.map((r) => {
                  const stock = stockMap[r.product_id ?? ""] ?? null;
                  const short = stock !== null && stock < r.quantity;
                  return (
                    <div key={r.id} className={`flex justify-between text-xs ${short ? "text-destructive font-bold" : ""}`}>
                      <span>{r.product_name} × {r.quantity} {stock !== null && <span className="text-[10px] text-muted-foreground">(المخزون: {stock})</span>}</span>
                      <span>{formatEGP(r.requested_price)} ({Number(r.discount_percent).toFixed(1)}%)</span>
                    </div>
                  );
                })}
              </div>
              <Label className="mt-3 block">{decision.type === "reject" ? "سبب الرفض (مطلوب)" : "ملاحظة (اختياري)"}</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision.type === "reject" ? "اكتب السبب الذي سيظهر للكاشير" : "ملاحظة"} />
            </div>
          )}
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
    </Wrapper>
  );
}
