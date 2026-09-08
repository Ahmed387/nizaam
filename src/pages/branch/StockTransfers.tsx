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
import { Plus, Check, X, ArrowLeftRight, Trash2, ChevronsUpDown, Inbox, Search } from "lucide-react";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { confirmAlert } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/DataTable";

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
  const [selfBranchName, setSelfBranchName] = useState<string>("");
  const [doneSearch, setDoneSearch] = useState("");
  // إخفاء بصري فقط — لا يمس قاعدة البيانات إطلاقاً
  const hiddenKey = `stock-transfers-hidden-${branchId ?? ""}`;
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try { setHidden(JSON.parse(localStorage.getItem(hiddenKey) ?? "[]")); } catch { setHidden([]); }
  }, [hiddenKey]);
  const dismissGroup = async (key: string, ids: string[]) => {
    if (!(await confirmAlert({
      title: "إخفاء هذه العملية من الشاشة النشطة؟",
      description: "الإخفاء بصري فقط — العملية هتفضل محفوظة بكل تفاصيلها في تبويب «ما تم استلامه بالفعل».",
      confirmLabel: "أيوه، اخفيها", cancelLabel: "لأ، سيبها", tone: "warning",
    }))) return;
    const next = Array.from(new Set([...hidden, key, ...ids]));
    setHidden(next);
    try { localStorage.setItem(hiddenKey, JSON.stringify(next)); } catch { /* ignore */ }
    toast.success("تم إخفاء العملية من الشاشة النشطة");
  };

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    const [b, p, out, inc, self] = await Promise.all([
      supabase.from("branches").select("*").eq("is_active", true).neq("code", "PARTNER-CASH").neq("id", branchId),
      supabase.from("products").select("*").eq("branch_id", branchId).order("name"),
      supabase.from("stock_transfers").select("*, to_branch:branches!to_branch_id(name), products(name, sku)").eq("from_branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("stock_transfers").select("*, from_branch:branches!from_branch_id(name), products(name, sku)").eq("to_branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("branches").select("name").eq("id", branchId).maybeSingle(),
    ]);
    setBranches(b.data ?? []);
    setProducts(p.data ?? []);
    setOutgoing(out.data ?? []);
    setIncoming(inc.data ?? []);
    setSelfBranchName((self.data as any)?.name ?? "فرعك");
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
    if (!(await confirmAlert({ title: "رفض الصنف وإرجاع الكمية لمخزن الفرع المرسل؟", description: "الكمية هترجع لمخزن الفرع المرسل.", confirmLabel: "أيوه، ارفض", cancelLabel: "لأ، سيبها", tone: "danger" }))) return;
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
    if (!(await confirmAlert({ title: "رفض كل الأصناف وإرجاع الكميات لمخزن فرعك المرسل؟", description: "الكمية هترجع لمخزن الفرع المرسل.", confirmLabel: "أيوه، ارفض", cancelLabel: "لأ، سيبها", tone: "danger" }))) return;
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

  // Group incoming by group_id (or by id if no group) — pending only + not visually dismissed
  const incomingGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of incoming) {
      if (t.status !== "pending") continue;
      const key = t.group_id ?? `single-${t.id}`;
      if (hidden.includes(key) || hidden.includes(t.id)) continue;
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
  }, [incoming, hidden]);

  const outgoingGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of outgoing) {
      if (t.status !== "pending") continue;
      const key = t.group_id ?? `single-${t.id}`;
      if (hidden.includes(key) || hidden.includes(t.id)) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([key, rows]) => ({
      key, rows,
      to_name: rows[0].to_branch?.name,
      created_at: rows[0].created_at,
      reason: rows[0].reason,
    }));
  }, [outgoing, hidden]);

  // ما تم استلامه بالفعل — سجل تاريخي كامل (وارد + صادر) لا يتأثر بالإخفاء البصري
  const completedRows = useMemo(() => {
    const rows = [
      ...incoming.filter((t) => t.status === "confirmed").map((t) => ({
        ...t,
        direction: "in" as const,
        from_name: t.from_branch?.name ?? "—",
        to_name: selfBranchName,
      })),
      ...outgoing.filter((t) => t.status === "confirmed").map((t) => ({
        ...t,
        direction: "out" as const,
        from_name: selfBranchName,
        to_name: t.to_branch?.name ?? "—",
      })),
    ].sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at)));
    const q = doneSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.from_name, r.to_name, r.products?.name, r.products?.sku, r.reason]
        .filter(Boolean)
        .some((v: any) => String(v).toLowerCase().includes(q))
    );
  }, [incoming, outgoing, selfBranchName, doneSearch]);

  const totalPendingIncoming = incomingGroups.reduce((s, g) => s + g.pendingCount, 0);


  const allIds = useMemo(() => [...incoming, ...outgoing].map((t: any) => t.id), [incoming, outgoing]);
  const attCounts = useAttachmentCounts("stock_transfer", allIds);

  return (
    <ConditionalLayout
      embedded={embedded}
      title="نقل المخزون بين الفروع"
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
                    <AttachmentsDialogButton recordType="stock_transfer" recordId={r.id} count={attCounts[r.id] ?? 0} />
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
                    <AttachmentsDialogButton recordType="stock_transfer" recordId={r.id} count={attCounts[r.id] ?? 0} />
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

function ProductCombobox({
  products, value, onChange, excludeIds = [],
}: {
  products: any[];
  value: string;
  onChange: (id: string) => void;
  excludeIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const selected = products.find((p) => p.id === value);
  const available = products.filter((p) => !excludeIds.includes(p.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="flex-1 min-w-0 justify-between font-normal"
        >
          <span className="truncate text-right">
            {selected ? `${selected.name} (متاح: ${selected.quantity})` : "— اختر منتج —"}
          </span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[min(420px,calc(100vw-2rem))]" align="start">
        <Command
          filter={(val, search) => {
            const q = search.trim().toLowerCase();
            if (!q) return 1;
            return val.toLowerCase().includes(q) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="بحث بالاسم أو الكود…" />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            <CommandGroup>
              {available.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.sku ?? ""} ${p.legacy_code ?? ""}`}
                  onSelect={() => { onChange(p.id); setOpen(false); }}
                  className="group"
                >
                  <Check className={`w-4 h-4 ml-2 ${value === p.id ? "opacity-100" : "opacity-0"}`} />
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.sku}{p.legacy_code ? ` • ${p.legacy_code}` : ""}</div>
                    </div>
                    <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-md bg-muted/80 text-foreground border border-border/50 group-data-[selected=true]:bg-white/20 group-data-[selected=true]:text-white group-data-[selected=true]:border-white/30">
                      متاح: {p.quantity}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
