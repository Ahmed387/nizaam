import { useEffect, useMemo, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useParams } from "react-router-dom";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { notifyMany, getBranchManagers } from "@/lib/notifications";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Check, X, ArrowLeftRight, Trash2, ChevronsUpDown, Inbox } from "lucide-react";

type Item = { product_id: string; quantity: string };

export default function StockTransfers({ embedded }: { embedded?: boolean } = {}) {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const [branches, setBranches] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [incoming, setIncoming] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [toBranch, setToBranch] = useState("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<Item[]>([{ product_id: "", quantity: "" }]);
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});


  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    const [b, p, out, inc] = await Promise.all([
      supabase.from("branches").select("*").eq("is_active", true).neq("id", branchId),
      supabase.from("products").select("*").eq("branch_id", branchId).order("name"),
      supabase.from("stock_transfers").select("*, to_branch:branches!to_branch_id(name), products(name)").eq("from_branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("stock_transfers").select("*, from_branch:branches!from_branch_id(name), products(name)").eq("to_branch_id", branchId).order("created_at", { ascending: false }),
    ]);
    setBranches(b.data ?? []);
    setProducts(p.data ?? []);
    setOutgoing(out.data ?? []);
    setIncoming(inc.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);
  useRealtimeRefresh(["stock_transfers"], load);

  const resetForm = () => {
    setToBranch(""); setReason(""); setItems([{ product_id: "", quantity: "" }]);
  };

  const submit = async () => {
    if (!toBranch) return toast.error("اختر الفرع المستلم");
    const cleaned = items
      .map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity) }))
      .filter((i) => i.product_id && i.quantity > 0);
    if (!cleaned.length) return toast.error("أضف صنف واحد على الأقل بكمية صحيحة");

    // validate per-product stock + duplicates
    const seen = new Set<string>();
    for (const it of cleaned) {
      if (seen.has(it.product_id)) return toast.error("لا يمكن تكرار نفس المنتج — اجمعه في صف واحد");
      seen.add(it.product_id);
      const prod = products.find((p) => p.id === it.product_id);
      if (!prod) return toast.error("منتج غير موجود");
      if (it.quantity > prod.quantity) return toast.error(`${prod.name}: المتاح ${prod.quantity} فقط`);
    }

    const { data: groupId, error } = await supabase.rpc("transfer_stock_multi_atomic", {
      p_from_branch: branchId!,
      p_to_branch: toBranch,
      p_items: cleaned as any,
      p_reason: reason || null,
    });
    if (error) return toast.error(error.message);

    const toBr = branches.find((b) => b.id === toBranch);
    const fromBr = { name: profile?.name ? "فرعك" : "فرع آخر" };
    const recipients = await getBranchManagers(toBranch);
    await notifyMany(recipients, {
      title: "طلب نقل بضاعة جديد",
      body: `${cleaned.length} صنف من ${fromBr.name ?? ""} → ${toBr?.name ?? ""}`,
      type: "general",
      link: `/branch/${toBranch}/transfers`,
      relatedEntity: "stock_transfer_group",
      relatedEntityId: groupId as string,
    });

    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "CREATE", entity: "stock_transfer_group", entityId: groupId as string, details: { items: cleaned, to: toBranch } });
    const summary = cleaned.map((c) => {
      const p = products.find((x) => x.id === c.product_id);
      return `• ${p?.name ?? "—"} × ${c.quantity}`;
    }).join("\n");
    toast.success(`تم إرسال الطلب إلى ${toBr?.name ?? "الفرع"}`, {
      description: `${cleaned.length} صنف بانتظار تأكيد الفرع المستلم:\n${summary}`,
      duration: 6000,
    });
    setOpen(false);
    resetForm();
    load();
  };

  // Partial / full confirm with received quantity
  const confirmTransfer = async (t: any, receivedOverride?: number) => {
    const received = receivedOverride ?? Number(recvQty[t.id] ?? t.quantity);
    if (!Number.isFinite(received) || received < 0 || received > t.quantity) {
      return toast.error(`الكمية المستلمة يجب أن تكون بين 0 و ${t.quantity}`);
    }
    const { data, error } = await supabase.rpc("partial_confirm_transfer" as any, {
      p_transfer_id: t.id,
      p_received: received,
    });
    if (error) return toast.error(error.message);
    const res = (data ?? {}) as { received: number; returned: number; total: number };

    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "UPDATE", entity: "stock_transfer", entityId: t.id, details: { received: res.received, returned: res.returned } });

    const senderMgrs = await getBranchManagers(t.from_branch_id);
    const isPartial = res.returned > 0 && res.received > 0;
    const isNone = res.received === 0;
    await notifyMany(senderMgrs, {
      title: isNone ? "❌ لم يتم استلام الصنف" : isPartial ? "⚠️ استلام جزئي" : "✅ تم استلام الصنف بالكامل",
      body: `${t.products?.name ?? "منتج"}: مستلم ${res.received} / ${res.total}${res.returned > 0 ? ` — رجع ${res.returned} لمخزنك` : ""}`,
      type: "general",
      link: `/branch/${t.from_branch_id}/transfers`,
      relatedEntity: "stock_transfer", relatedEntityId: t.id,
    });
    toast.success(isNone ? `لم يُستلم — رجع ${res.returned} للمخزن المرسل` : isPartial ? `تم استلام ${res.received} ورجع ${res.returned} للمرسل` : "تم استلام الكمية كاملة");
    setRecvQty((m) => { const n = { ...m }; delete n[t.id]; return n; });
    load();
  };


  const rejectTransfer = async (t: any) => {
    if (!confirm("رفض الصنف وإرجاع الكمية لمخزن الفرع المرسل؟")) return;
    const { error: rpcErr } = await supabase.rpc("reject_transfer", { p_transfer_id: t.id });
    if (rpcErr) { toast.error(rpcErr.message); return; }
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "UPDATE", entity: "stock_transfer", entityId: t.id, details: { rejected: true } });

    const senderMgrs = await getBranchManagers(t.from_branch_id);
    await notifyMany(senderMgrs, {
      title: "❌ تم رفض صنف وإرجاعه للمخزن",
      body: `رُفض: ${t.products?.name ?? "منتج"} × ${t.quantity} — تم إرجاع الكمية لمخزن فرعك`,
      type: "general",
      link: `/branch/${t.from_branch_id}/transfers`,
      relatedEntity: "stock_transfer", relatedEntityId: t.id,
    });
    toast.info("تم الرفض وإرجاع الكمية لمخزن الفرع المرسل");
    load();
  };

  // Group bulk actions
  const confirmGroup = async (groupId: string, fromBranchId: string, rows: any[]) => {
    const { data, error } = await supabase.rpc("confirm_transfer_group", { p_group: groupId });
    if (error) return toast.error(error.message);
    const list = rows.filter((r) => r.status === "pending").map((r) => `• ${r.products?.name ?? "—"} × ${r.quantity}`).join("\n");
    const senderMgrs = await getBranchManagers(fromBranchId);
    await notifyMany(senderMgrs, {
      title: `✅ تم استلام كل الأصناف (${data})`,
      body: `الأصناف المستلمة:\n${list}`,
      type: "general",
      link: `/branch/${fromBranchId}/transfers`,
      relatedEntity: "stock_transfer_group", relatedEntityId: groupId,
    });
    toast.success(`تم استلام ${data} صنف`);
    load();
  };

  const rejectGroup = async (groupId: string, fromBranchId: string, rows: any[]) => {
    if (!confirm("رفض كل الأصناف وإرجاع الكميات لمخزن فرعك المرسل؟")) return;
    const { data, error } = await supabase.rpc("reject_transfer_group", { p_group: groupId });
    if (error) return toast.error(error.message);
    const list = rows.filter((r) => r.status === "pending").map((r) => `• ${r.products?.name ?? "—"} × ${r.quantity}`).join("\n");
    const senderMgrs = await getBranchManagers(fromBranchId);
    await notifyMany(senderMgrs, {
      title: `❌ تم رفض كل الأصناف (${data}) — رجعت للمخزن`,
      body: `الأصناف المرفوضة وتم إرجاعها لمخزن فرعك:\n${list}`,
      type: "general",
      link: `/branch/${fromBranchId}/transfers`,
      relatedEntity: "stock_transfer_group", relatedEntityId: groupId,
    });
    toast.info(`تم رفض ${data} صنف وإرجاعها للمخزن`);
    load();
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = { pending: "text-warning", confirmed: "text-success", rejected: "text-destructive" };
    const lbl: Record<string, string> = { pending: "قيد الانتظار", confirmed: "تم الاستلام", rejected: "مرفوض" };
    return <span className={`font-bold ${map[s]}`}>{lbl[s] ?? s}</span>;
  };

  // Group incoming by group_id (or by id if no group)
  const incomingGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of incoming) {
      const key = t.group_id ?? `single-${t.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([key, rows]) => ({
      key, rows,
      groupId: rows[0].group_id as string | null,
      from_branch_id: rows[0].from_branch_id,
      from_name: rows[0].from_branch?.name,
      created_at: rows[0].created_at,
      reason: rows[0].reason,
      pendingCount: rows.filter((r) => r.status === "pending").length,
    }));
  }, [incoming]);

  const outgoingGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of outgoing) {
      const key = t.group_id ?? `single-${t.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([key, rows]) => ({
      key, rows,
      to_name: rows[0].to_branch?.name,
      created_at: rows[0].created_at,
      reason: rows[0].reason,
    }));
  }, [outgoing]);

  const totalPendingIncoming = incoming.filter((t) => t.status === "pending").length;

  return (
    <ConditionalLayout
      embedded={embedded}
      title="نقل المخزون"
      subtitle="إرسال واستقبال البضاعة بين الفروع"
      actions={<Button onClick={() => setOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> طلب نقل جديد</Button>}
    >
      <Tabs defaultValue="incoming">
        <TabsList>
          <TabsTrigger value="incoming">واردة ({totalPendingIncoming})</TabsTrigger>
          <TabsTrigger value="outgoing">صادرة</TabsTrigger>
        </TabsList>

        <TabsContent value="incoming" className="mt-4 space-y-3">
          {loading && <p className="text-muted-foreground text-sm">جاري التحميل…</p>}
          {!loading && incomingGroups.length === 0 && <p className="text-muted-foreground text-sm">لا توجد طلبات واردة</p>}
          {incomingGroups.map((g) => (
            <div key={g.key} className="bg-surface border border-border rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <div className="font-bold">من: {g.from_name}</div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(g.created_at)} • {g.rows.length} صنف</div>
                  {g.reason && <div className="text-xs text-muted-foreground mt-1">السبب: {g.reason}</div>}
                </div>
                {g.groupId && g.pendingCount > 1 && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => confirmGroup(g.groupId!, g.from_branch_id, g.rows)} className="gap-1">
                      <Check className="w-3 h-3" /> استلام كل الأصناف ({g.pendingCount})
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => rejectGroup(g.groupId!, g.from_branch_id, g.rows)} className="gap-1 text-destructive">
                      <X className="w-3 h-3" /> رفض الكل
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                {g.rows.map((r: any) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-t border-border text-sm">
                    <div className="flex-1 min-w-[160px]">
                      {r.products?.name ?? "—"} <span className="text-muted-foreground">× {r.quantity}</span>
                      {r.status === "confirmed" && r.received_quantity !== null && r.received_quantity !== r.quantity && (
                        <span className="text-xs text-warning mr-2">(مستلم {r.received_quantity} / {r.quantity})</span>
                      )}
                    </div>
                    <div>{statusBadge(r.status)}</div>
                    {r.status === "pending" && (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" min={0} max={r.quantity}
                          value={recvQty[r.id] ?? String(r.quantity)}
                          onChange={(e) => setRecvQty((m) => ({ ...m, [r.id]: e.target.value }))}
                          className="w-20 h-8"
                          title="الكمية المستلمة فعلياً"
                        />
                        <Button size="sm" onClick={() => confirmTransfer(r)} className="gap-1"><Check className="w-3 h-3" /> استلام</Button>
                        <Button size="sm" variant="outline" onClick={() => rejectTransfer(r)} className="gap-1 text-destructive"><X className="w-3 h-3" /> رفض</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

            </div>
          ))}
        </TabsContent>

        <TabsContent value="outgoing" className="mt-4 space-y-3">
          {loading && <p className="text-muted-foreground text-sm">جاري التحميل…</p>}
          {!loading && outgoingGroups.length === 0 && <p className="text-muted-foreground text-sm">لا توجد طلبات صادرة</p>}
          {outgoingGroups.map((g) => (
            <div key={g.key} className="bg-surface border border-border rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <div className="font-bold">إلى: {g.to_name}</div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(g.created_at)} • {g.rows.length} صنف</div>
                  {g.reason && <div className="text-xs text-muted-foreground mt-1">السبب: {g.reason}</div>}
                </div>
              </div>
              <div className="space-y-1">
                {g.rows.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-2 border-t border-border text-sm">
                    <div className="flex-1">
                      {r.products?.name ?? "—"} <span className="text-muted-foreground">× {r.quantity}</span>
                      {r.status === "confirmed" && r.received_quantity !== null && r.received_quantity !== r.quantity && (
                        <span className="text-xs text-warning mr-2">(مستلم {r.received_quantity} — رجع {r.quantity - r.received_quantity} لمخزنك)</span>
                      )}
                    </div>
                    <div>{statusBadge(r.status)}</div>
                  </div>

                ))}
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="w-5 h-5" /> طلب نقل بضاعة</DialogTitle></DialogHeader>
          <div className="space-y-3 min-w-0">
            <div className="min-w-0">
              <Label>الفرع المستلم *</Label>
              <select value={toBranch} onChange={(e) => setToBranch(e.target.value)}
                className="w-full mt-1 bg-surface border border-border rounded-md px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
            </div>

            <div className="min-w-0">
              <div className="flex items-center justify-between mb-2 gap-2">
                <Label>الأصناف *</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, { product_id: "", quantity: "" }])} className="gap-1 shrink-0">
                  <Plus className="w-3 h-3" /> إضافة صنف
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => {
                  const prod = products.find((p) => p.id === it.product_id);
                  return (
                    <div key={idx} className="flex gap-2 items-start min-w-0">
                      <ProductCombobox
                        products={products}
                        value={it.product_id}
                        excludeIds={items.map((x, i) => i !== idx ? x.product_id : "").filter(Boolean)}
                        onChange={(id) => {
                          const next = [...items]; next[idx] = { ...next[idx], product_id: id }; setItems(next);
                        }}
                      />
                      <Input type="number" min={1} max={prod?.quantity} placeholder="الكمية" value={it.quantity}
                        onChange={(e) => { const next = [...items]; next[idx] = { ...next[idx], quantity: e.target.value }; setItems(next); }}
                        className="w-24 shrink-0" />
                      <Button type="button" size="icon" variant="ghost" onClick={() => {
                        const next = items.filter((_, i) => i !== idx);
                        setItems(next.length ? next : [{ product_id: "", quantity: "" }]);
                      }} className="text-destructive shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0"><Label>السبب</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5 w-full" /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>إرسال الطلب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConditionalLayout>
  );
}
