import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

const STATUS_LABEL: Record<string, { ar: string; cls: string }> = {
  pending:   { ar: "في الانتظار", cls: "bg-warning/15 text-warning" },
  received:  { ar: "وصل — جاهز للاستلام", cls: "bg-primary/15 text-primary" },
  completed: { ar: "اكتمل", cls: "bg-success/15 text-success" },
  cancelled: { ar: "ملغي", cls: "bg-destructive/15 text-destructive" },
};

export default function PreOrders() {
  const { id: branchId } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const focusId = params.get("focus");
  const nav = useNavigate();
  const { isAdmin, hasRole } = useAuth();
  const canManage = isAdmin || hasRole("branch_manager");

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [completeFor, setCompleteFor] = useState<any | null>(null);
  const [cancelFor, setCancelFor] = useState<any | null>(null);

  const load = async () => {
    if (!branchId) return;
    const { data } = await supabase.from("pre_orders").select("*").eq("branch_id", branchId).order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    const ch = supabase.channel(`po-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pre_orders", filter: `branch_id=eq.${branchId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [branchId]);

  // Auto-open complete dialog when ?focus=<id>
  useEffect(() => {
    if (!focusId || !rows.length) return;
    const r = rows.find((x) => x.id === focusId);
    if (r && (r.status === "pending" || r.status === "received") && canManage) {
      setCompleteFor(r);
    }
  }, [focusId, rows, canManage]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return r.order_number?.toLowerCase().includes(q)
          || r.customer_name?.toLowerCase().includes(q)
          || r.customer_phone?.toLowerCase().includes(q)
          || r.product_name?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  return (
    <BranchLayout>
      <PageHeader title="طلبات الحجز" subtitle="إدارة حجوزات العملاء" />

      <div className="card-elevated p-4 mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="ابحث برقم/عميل/منتج" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-1 flex-wrap">
          {[
            { v: "all", label: "الكل" },
            { v: "pending", label: "في الانتظار" },
            { v: "received", label: "وصل" },
            { v: "completed", label: "اكتمل" },
            { v: "cancelled", label: "ملغي" },
          ].map((f) => (
            <Button key={f.v} size="sm" variant={statusFilter === f.v ? "default" : "outline"} onClick={() => setStatusFilter(f.v)}>{f.label}</Button>
          ))}
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        empty="لا توجد حجوزات"
        columns={[
          { key: "order_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary font-bold">{r.order_number}</span> },
          { key: "customer", header: "العميل", render: (r: any) => (
            <div>
              <div className="font-semibold">{r.customer_name}</div>
              {r.customer_phone && <div className="text-xs text-muted-foreground" dir="ltr">{r.customer_phone}</div>}
            </div>
          )},
          { key: "product", header: "المنتج", render: (r: any) => (
            <div>
              <div>{r.product_name}</div>
              {r.model_code && <div className="text-xs text-muted-foreground">{r.model_code}</div>}
              <div className="text-xs text-muted-foreground">كمية: {r.quantity}</div>
            </div>
          )},
          { key: "deposit", header: "العربون", render: (r: any) =>
            Number(r.deposit_amount) > 0 ? <span className="text-success font-bold">{formatEGP(r.deposit_amount)}</span>
              : <span className="text-[11px] px-2 py-0.5 rounded bg-warning/15 text-warning">بدون عربون</span>
          },
          { key: "remaining", header: "المتبقي", render: (r: any) => formatEGP(Math.max(0, Number(r.expected_price) * r.quantity - Number(r.deposit_amount))) },
          { key: "status", header: "الحالة", render: (r: any) => {
            const s = STATUS_LABEL[r.status] ?? { ar: r.status, cls: "" };
            return <span className={`px-2 py-1 rounded text-xs font-bold ${s.cls}`}>{s.ar}</span>;
          }},
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
          { key: "actions", header: "إجراءات", render: (r: any) => (
            <div className="flex gap-1">
              {(r.status === "pending" || r.status === "received") && canManage && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setCompleteFor(r)}>
                    <CheckCircle2 className="w-3 h-3 ml-1" /> إتمام البيع
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCancelFor(r)}>
                    <XCircle className="w-3 h-3 ml-1 text-destructive" /> إلغاء
                  </Button>
                </>
              )}
              {r.status === "completed" && r.invoice_id && (
                <Button size="sm" variant="ghost" onClick={() => nav(`/branch/${branchId}/sales/${r.invoice_id}`)}>عرض الفاتورة</Button>
              )}
            </div>
          )},
        ]}
      />

      {completeFor && (
        <CompleteDialog
          po={completeFor}
          onClose={() => setCompleteFor(null)}
          onDone={(invId) => { setCompleteFor(null); load(); if (invId) nav(`/branch/${branchId}/sales/${invId}`); }}
        />
      )}
      {cancelFor && (
        <CancelDialog po={cancelFor} onClose={() => setCancelFor(null)} onDone={() => { setCancelFor(null); load(); }} />
      )}
    </BranchLayout>
  );
}

function CompleteDialog({ po, onClose, onDone }: { po: any; onClose: () => void; onDone: (invId?: string) => void }) {
  const [available, setAvailable] = useState<number | null>(null);
  const [payment, setPayment] = useState("cash");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("products")
        .select("quantity").eq("branch_id", po.branch_id).ilike("name", po.product_name).maybeSingle();
      setAvailable(data?.quantity ?? 0);
    })();
  }, [po.id]);

  const qtySell = available != null ? Math.min(available, po.quantity) : 0;
  const subtotal = qtySell * Number(po.expected_price);
  const remaining = Math.max(0, subtotal - Number(po.deposit_amount));

  const submit = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("complete_pre_order_sale", {
        p_pre_order_id: po.id, p_payment_method: payment,
      });
      if (error) throw error;
      toast.success("تم إتمام البيع");
      onDone(data as string);
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>إتمام بيع الحجز {po.order_number}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-surface-2 p-3">
            <div><strong>العميل:</strong> {po.customer_name} {po.customer_phone && <span dir="ltr" className="text-xs text-muted-foreground">({po.customer_phone})</span>}</div>
            <div><strong>المنتج:</strong> {po.product_name} {po.model_code && <span className="text-xs">({po.model_code})</span>}</div>
          </div>

          {available == null ? (
            <div className="text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
          ) : available <= 0 ? (
            <div className="rounded p-3 bg-destructive/10 text-destructive text-center font-bold">المنتج غير متاح في المخزون حالياً</div>
          ) : (
            <>
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1">
                <div className="flex justify-between"><span>كمية الحجز</span><span>{po.quantity}</span></div>
                <div className="flex justify-between"><span>المتاح في المخزون</span><span>{available}</span></div>
                <div className="flex justify-between"><span>الكمية اللي هتتباع الآن</span><strong>{qtySell}</strong></div>
                {qtySell < po.quantity && (
                  <div className="text-[11px] px-2 py-1 rounded bg-warning/10 text-warning text-center">
                    الكمية المتاحة أقل من المطلوب — هيتم بيع {qtySell} والباقي يفضل في الحجز
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="flex justify-between"><span>السعر الكلي</span><span>{formatEGP(subtotal)}</span></div>
                <div className="flex justify-between"><span>العربون المدفوع</span><span className="text-success">- {formatEGP(po.deposit_amount)}</span></div>
                <div className="flex justify-between border-t border-border pt-1"><strong>المتبقي عند الاستلام</strong><strong className="text-primary text-lg">{formatEGP(remaining)}</strong></div>
              </div>
              <div>
                <label className="text-xs">طريقة دفع المتبقي</label>
                <select className="w-full bg-input border border-border rounded-lg p-2 mt-1" value={payment} onChange={(e) => setPayment(e.target.value)}>
                  <option value="cash">كاش</option><option value="visa">فيزا</option><option value="transfer">تحويل</option>
                </select>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button className="btn-gradient" onClick={submit} disabled={busy || !available || available <= 0}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد إتمام البيع"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ po, onClose, onDone }: { po: any; onClose: () => void; onDone: () => void }) {
  const [refund, setRefund] = useState(true);
  const [busy, setBusy] = useState(false);
  const hasDeposit = Number(po.deposit_amount) > 0 && !po.deposit_refunded;

  const submit = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("cancel_pre_order", { p_pre_order_id: po.id, p_refund: hasDeposit && refund });
      if (error) throw error;
      toast.success("تم إلغاء الحجز");
      onDone();
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>إلغاء الحجز {po.order_number}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-surface-2 p-3">
            <div><strong>{po.customer_name}</strong> — {po.product_name}</div>
            {hasDeposit && <div className="mt-2">العربون المدفوع: <strong className="text-success">{formatEGP(po.deposit_amount)}</strong></div>}
          </div>

          {hasDeposit ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={refund} onChange={() => setRefund(true)} />
                <span>استرداد العربون للعميل ({formatEGP(po.deposit_amount)})</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={!refund} onChange={() => setRefund(false)} />
                <span>الاحتفاظ بالعربون (لن يُسترد)</span>
              </label>
              {refund && (
                <div className="text-[11px] px-2 py-1 rounded bg-warning/10 text-warning">
                  سيتم صرف {formatEGP(po.deposit_amount)} من خزينة الفرع
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground">لا يوجد عربون لاسترداده</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>تراجع</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد الإلغاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
