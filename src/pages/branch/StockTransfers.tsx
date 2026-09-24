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
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { notifyMany, getBranchManagers } from "@/lib/notifications";
import { formatDateTime } from "@/lib/format";
import { searchMatch } from "@/lib/search";
import { toast } from "sonner";
import { Plus, Check, X, ArrowLeftRight, Trash2, ChevronsUpDown, Inbox, Search, CalendarIcon } from "lucide-react";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { confirmAlert } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/DataTable";
import { format as formatDateFns } from "date-fns";
import { cn } from "@/lib/utils";

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
  // نافذة الاستلام / الرفض الموحدة
  const [recvOpen, setRecvOpen] = useState(false);
  const [recvRows, setRecvRows] = useState<any[]>([]);
  const [recvFrom, setRecvFrom] = useState<string>("");
  const [rejOpen, setRejOpen] = useState(false);
  const [rejRows, setRejRows] = useState<any[]>([]);
  const [rejGroup, setRejGroup] = useState<string | null>(null);
  const [rejFrom, setRejFrom] = useState<string>("");
  const [rejReason, setRejReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [selfBranchName, setSelfBranchName] = useState<string>("");
  const [allBranches, setAllBranches] = useState<any[]>([]);
  // فلاتر تبويب "ما تم استلامه بالفعل"
  const [productQuery, setProductQuery] = useState("");
  const [fromBranchFilter, setFromBranchFilter] = useState<string>("ALL");
  const [toBranchFilter, setToBranchFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "confirmed" | "rejected">("ALL");
  const [hideTarget, setHideTarget] = useState<string | null>(null);
  const [hideBusy, setHideBusy] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
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
    const [b, allB, p, out, inc, self] = await Promise.all([
      supabase.from("branches").select("*").eq("is_active", true).neq("code", "PARTNER-CASH").neq("id", branchId),
      supabase.from("branches").select("*").eq("is_active", true).neq("code", "PARTNER-CASH"),
      supabase.from("products").select("*").eq("branch_id", branchId).order("name"),
      supabase.from("stock_transfers").select("*, to_branch:branches!to_branch_id(name), products(name, sku, brand, model, legacy_code, color, size, capacity, product_type, image)").eq("from_branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("stock_transfers").select("*, from_branch:branches!from_branch_id(name), products(name, sku, brand, model, legacy_code, color, size, capacity, product_type, image)").eq("to_branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("branches").select("name").eq("id", branchId).maybeSingle(),
    ]);
    setBranches(b.data ?? []);
    setAllBranches(allB.data ?? []);
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

  // ===== نافذة الاستلام الموحدة =====
  const openReceive = (rows: any[], fromBranchId: string) => {
    const pending = rows.filter((r) => r.status === "pending");
    if (!pending.length) return;
    setRecvQty(Object.fromEntries(pending.map((r) => [r.id, String(r.quantity)])));
    setRecvRows(pending);
    setRecvFrom(fromBranchId);
    setRecvOpen(true);
  };

  const submitReceive = async () => {
    for (const t of recvRows) {
      const received = Number(recvQty[t.id] ?? t.quantity);
      if (!Number.isFinite(received) || received < 0 || received > t.quantity) {
        return toast.error(`${t.products?.name ?? "صنف"}: الكمية المستلمة لازم تكون بين 0 و ${t.quantity}`);
      }
    }
    setBusy(true);
    let ok = 0, totalRecv = 0, totalRet = 0;
    const lines: string[] = [];
    for (const t of recvRows) {
      const received = Number(recvQty[t.id] ?? t.quantity);
      const { data, error } = await supabase.rpc("partial_confirm_transfer" as any, {
        p_transfer_id: t.id,
        p_received: received,
      });
      if (error) { toast.error(`${t.products?.name ?? "صنف"}: ${error.message}`); continue; }
      const res = (data ?? {}) as { received: number; returned: number; total: number };
      ok++; totalRecv += Number(res.received ?? 0); totalRet += Number(res.returned ?? 0);
      lines.push(`• ${t.products?.name ?? "—"}: مستلم ${res.received} / ${res.total}${res.returned > 0 ? ` — رجع ${res.returned} لمخزنك` : ""}`);
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "UPDATE", entity: "stock_transfer", entityId: t.id, details: { received: res.received, returned: res.returned } });
    }
    if (ok) {
      const senderMgrs = await getBranchManagers(recvFrom);
      await notifyMany(senderMgrs, {
        title: totalRet > 0 ? "⚠️ استلام جزئي للأصناف" : "✅ تم استلام الأصناف بالكامل",
        body: lines.join("\n"),
        type: "general",
        link: `/branch/${recvFrom}/transfers`,
        relatedEntity: "stock_transfer", relatedEntityId: recvRows[0]?.id,
      });
      toast.success(`تم استلام ${ok} صنف — إجمالي ${totalRecv}${totalRet > 0 ? ` ورجع ${totalRet} لمخزن الفرع المرسل` : ""}`);
    }
    setBusy(false);
    setRecvOpen(false);
    setRecvRows([]);
    setRecvQty({});
    load();
  };

  // ===== نافذة الرفض المسبب =====
  const openReject = (rows: any[], fromBranchId: string, groupId: string | null) => {
    const pending = rows.filter((r) => r.status === "pending");
    if (!pending.length) return;
    setRejRows(pending);
    setRejFrom(fromBranchId);
    setRejGroup(pending.length > 1 ? groupId : null);
    setRejReason("");
    setRejOpen(true);
  };

  const submitReject = async () => {
    if (!rejReason.trim()) return toast.error("اكتب سبب الرفض أولاً");
    setBusy(true);
    let count = 0;
    if (rejGroup) {
      const { data, error } = await supabase.rpc("reject_transfer_group" as any, { p_group: rejGroup, p_reason: rejReason.trim() });
      if (error) { setBusy(false); return toast.error(error.message); }
      count = Number(data ?? 0);
    } else {
      for (const t of rejRows) {
        const { error } = await supabase.rpc("reject_transfer" as any, { p_transfer_id: t.id, p_reason: rejReason.trim() });
        if (error) { toast.error(`${t.products?.name ?? "صنف"}: ${error.message}`); continue; }
        count++;
      }
    }
    if (count) {
      const list = rejRows.map((r) => `• ${r.products?.name ?? "—"} × ${r.quantity}`).join("\n");
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "UPDATE", entity: "stock_transfer", entityId: rejRows[0]?.id, details: { rejected: count, reason: rejReason.trim() } });
      const senderMgrs = await getBranchManagers(rejFrom);
      await notifyMany(senderMgrs, {
        title: `❌ تم رفض ${count} صنف — رجعت لمخزنك`,
        body: `السبب: ${rejReason.trim()}\n${list}`,
        type: "general",
        link: `/branch/${rejFrom}/transfers`,
        relatedEntity: "stock_transfer", relatedEntityId: rejRows[0]?.id,
      });
      toast.info(`تم رفض ${count} صنف وإرجاع الكميات لمخزن الفرع المرسل`);
    }
    setBusy(false);
    setRejOpen(false);
    setRejRows([]);
    setRejReason("");
    load();
  };


  const confirmHide = async () => {
    if (!hideTarget || !branchId) return;
    setHideBusy(true);
    const { error } = await supabase.rpc("hide_rejected_transfer" as any, { _transfer_id: hideTarget, _branch_id: branchId });
    setHideBusy(false);
    if (error) { toast.error(error.message); return; }
    const id = hideTarget;
    const mark = (list: any[]) => list.map((t) => t.id === id ? { ...t, hidden_for_branches: [...(t.hidden_for_branches ?? []), branchId] } : t);
    setIncoming(mark); setOutgoing(mark);
    setHideTarget(null);
    toast.success("تم إخفاء التحويل المرفوض من الشاشة");
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
      ...incoming.filter((t) => t.status === "confirmed" || t.status === "rejected").map((t) => ({
        ...t,
        direction: "in" as const,
        from_name: t.from_branch?.name ?? "—",
        to_name: selfBranchName,
      })),
      ...outgoing.filter((t) => t.status === "confirmed" || t.status === "rejected").map((t) => ({
        ...t,
        direction: "out" as const,
        from_name: selfBranchName,
        to_name: t.to_branch?.name ?? "—",
      })),
    ].sort((a, b) => String(b.confirmed_at ?? b.created_at).localeCompare(String(a.confirmed_at ?? a.created_at)));

    return rows.filter((r) => {
      if (Array.isArray(r.hidden_for_branches) && r.hidden_for_branches.includes(branchId)) return false;
      // 0. فلتر الحالة (الكل / مستلم / مرفوض)
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      // 1. فلتر الفرع المرسل
      if (fromBranchFilter && fromBranchFilter !== "ALL" && r.from_branch_id !== fromBranchFilter) return false;
      // 2. فلتر الفرع المستلم
      if (toBranchFilter && toBranchFilter !== "ALL" && r.to_branch_id !== toBranchFilter) return false;
      // 3. فلتر التاريخ من / إلى
      const confirmedAt = r.confirmed_at ?? r.created_at;
      if (confirmedAt) {
        const d = new Date(confirmedAt);
        if (dateFrom) {
          const from = new Date(dateFrom); from.setHours(0, 0, 0, 0);
          if (d < from) return false;
        }
        if (dateTo) {
          const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
          if (d > to) return false;
        }
      }
      // 4. فلتر المنتج بالمحرك الذكي متعدد الكلمات
      if (productQuery.trim()) {
        const prod = r.products ?? {};
        if (!searchMatch(productQuery, prod.name, prod.sku, prod.brand, prod.model, prod.legacy_code)) {
          return false;
        }
      }
      return true;
    });
  }, [incoming, outgoing, selfBranchName, productQuery, fromBranchFilter, toBranchFilter, statusFilter, dateFrom, dateTo]);

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
          <TabsTrigger value="done">ما تم استلامه بالفعل</TabsTrigger>
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
                <div className="flex gap-2 items-center">
                  {g.groupId && g.pendingCount > 1 && (
                    <>
                      <Button size="sm" onClick={() => openReceive(g.rows, g.from_branch_id)} className="gap-1">
                        <Check className="w-3 h-3" /> استلام كل الأصناف ({g.pendingCount})
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openReject(g.rows, g.from_branch_id, g.groupId)} className="gap-1 text-destructive">
                        <X className="w-3 h-3" /> رفض الكل
                      </Button>
                    </>
                  )}
                  <Button size="icon" variant="ghost" title="إخفاء من الشاشة النشطة"
                    onClick={() => dismissGroup(g.key, g.rows.map((r: any) => r.id))}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
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
                        <Button size="sm" onClick={() => openReceive([r], r.from_branch_id)} className="gap-1"><Check className="w-3 h-3" /> استلام</Button>
                        <Button size="sm" variant="outline" onClick={() => openReject([r], r.from_branch_id, null)} className="gap-1 text-destructive"><X className="w-3 h-3" /> رفض</Button>
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
                <Button size="icon" variant="ghost" title="إخفاء من الشاشة النشطة"
                  onClick={() => dismissGroup(g.key, g.rows.map((r: any) => r.id))}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
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

        <TabsContent value="done" className="mt-4 space-y-3">
          {/* شريط الفلاتر المتعدد المعايير */}
          <div className="bg-surface border border-border rounded-lg p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              {/* البحث الذكي بالمنتج */}
              <div className="flex-1 min-w-[220px]">
                <Label className="text-xs mb-1.5 block text-muted-foreground">بحث بالمنتج</Label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                    placeholder="بحث بالاسم، الكود، الموديل، الماركة…"
                    className="pr-9"
                  />
                </div>
              </div>

              {/* الفرع المرسل */}
              <div className="w-full sm:w-44">
                <Label className="text-xs mb-1.5 block text-muted-foreground">الفرع المرسل</Label>
                <Select value={fromBranchFilter} onValueChange={setFromBranchFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="كل الفروع المرسلة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">كل الفروع المرسلة</SelectItem>
                    {allBranches.map((b) => (
                      <SelectItem key={`from-${b.id}`} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* الفرع المستلم */}
              <div className="w-full sm:w-44">
                <Label className="text-xs mb-1.5 block text-muted-foreground">الفرع المستلم</Label>
                <Select value={toBranchFilter} onValueChange={setToBranchFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="كل الفروع المستلمة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">كل الفروع المستلمة</SelectItem>
                    {allBranches.map((b) => (
                      <SelectItem key={`to-${b.id}`} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* فلتر الحالة */}
              <div className="w-full sm:w-40">
                <Label className="text-xs mb-1.5 block text-muted-foreground">الحالة</Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                  <SelectTrigger>
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">الكل</SelectItem>
                    <SelectItem value="confirmed">مستلم</SelectItem>
                    <SelectItem value="rejected">مرفوض</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* فلتر التاريخ من / إلى */}
              <div className="w-full sm:w-auto">
                <Label className="text-xs mb-1.5 block text-muted-foreground">من تاريخ</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full sm:w-40 justify-start text-right font-normal",
                        !dateFrom && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="w-4 h-4 ml-2" />
                      {dateFrom ? formatDateFns(dateFrom, "yyyy/MM/dd") : "اختر تاريخ"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={setDateFrom}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="w-full sm:w-auto">
                <Label className="text-xs mb-1.5 block text-muted-foreground">إلى تاريخ</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full sm:w-40 justify-start text-right font-normal",
                        !dateTo && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="w-4 h-4 ml-2" />
                      {dateTo ? formatDateFns(dateTo, "yyyy/MM/dd") : "اختر تاريخ"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={setDateTo}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* زر إعادة ضبط الفلاتر */}
              {(productQuery || fromBranchFilter !== "ALL" || toBranchFilter !== "ALL" || statusFilter !== "ALL" || dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setProductQuery("");
                    setFromBranchFilter("ALL");
                    setToBranchFilter("ALL");
                    setStatusFilter("ALL");
                    setDateFrom(undefined);
                    setDateTo(undefined);
                  }}
                  className="gap-1 text-muted-foreground"
                >
                  <X className="w-4 h-4" /> تفريغ الفلاتر
                </Button>
              )}
            </div>
          </div>

          <DataTable
            loading={loading}
            empty="لا توجد عمليات مستلمة أو مرفوضة بعد"
            rows={completedRows}
            columns={[
              { key: "date", header: "تاريخ الاستلام / الرفض", align: "right", render: (r: any) => <span className="text-xs">{formatDateTime(r.confirmed_at ?? r.created_at)}</span> },
              { key: "from", header: "الفرع المرسل", align: "right", render: (r: any) => r.from_name ?? "—" },
              { key: "to", header: "الفرع المستلم", align: "right", render: (r: any) => r.to_name ?? "—" },
              {
                key: "dir", header: "الحركة", align: "center", render: (r: any) =>
                  r.direction === "in" ? (
                    <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-success/15 text-success border border-success/30">وارد من {r.from_name}</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-primary/15 text-primary border border-primary/30">صادر إلى {r.to_name}</span>
                  ),
              },
              {
                key: "item", header: "الصنف والكمية", align: "right", render: (r: any) => (
                  <div>
                    <div className="font-medium">{r.products?.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.products?.sku ? `${r.products.sku} • ` : ""}
                      {r.status === "rejected"
                        ? `الكمية المرفوضة: ${r.quantity}`
                        : `الكمية المستلمة: ${r.received_quantity ?? r.quantity}${r.received_quantity != null && r.received_quantity !== r.quantity ? ` من ${r.quantity}` : ""}`}
                    </div>
                    {r.status === "rejected" && r.rejection_reason && (
                      <div className="text-xs text-destructive mt-1">سبب الرفض: {r.rejection_reason}</div>
                    )}
                  </div>
                ),
              },
              {
                key: "status", header: "الحالة", align: "center", render: (r: any) =>
                  r.status === "rejected" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-destructive/15 text-destructive border border-destructive/30">مرفوض</span>
                      <button
                        type="button"
                        aria-label="إخفاء التحويل المرفوض"
                        title="إخفاء من الشاشة"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setHideTarget(r.id); }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-success/15 text-success border border-success/30">تم الاستلام بنجاح</span>
                  ),
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* نافذة تأكيد الاستلام بالكمية الفعلية */}
      <Dialog open={recvOpen} onOpenChange={(v) => { if (!busy) { setRecvOpen(v); if (!v) { setRecvRows([]); setRecvQty({}); } } }}>
        <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Check className="w-5 h-5 text-success" /> تأكيد استلام البضاعة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {recvRows.map((r) => {
              const entered = Number(recvQty[r.id] ?? r.quantity);
              const diff = Number(r.quantity) - (Number.isFinite(entered) ? entered : 0);
              return (
                <div key={r.id} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="font-bold">{r.products?.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">الكمية المحوّلة: {r.quantity}</div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm shrink-0">الكمية المستلمة فعلياً</Label>
                    <Input
                      type="number" min={0} max={r.quantity}
                      value={recvQty[r.id] ?? String(r.quantity)}
                      onChange={(e) => setRecvQty((m) => ({ ...m, [r.id]: e.target.value }))}
                      className="w-28 h-9 font-bold"
                    />
                  </div>
                  {diff > 0 && (
                    <div className="text-xs font-bold text-warning bg-warning/10 border border-warning/30 rounded-md px-2 py-1.5">
                      هيرجع {diff} تلقائياً لرصيد الفرع المرسل كمرتجع نقل.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setRecvOpen(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={submitReceive}>تأكيد الاستلام</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة الرفض المسبب */}
      <Dialog open={rejOpen} onOpenChange={(v) => { if (!busy) { setRejOpen(v); if (!v) setRejRows([]); } }}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)]">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><X className="w-5 h-5" /> رفض البضاعة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              هترفض {rejRows.length} صنف، والكميات هترجع لمخزن الفرع المرسل.
            </div>
            <div className="space-y-1 text-sm">
              {rejRows.map((r) => <div key={r.id}>• {r.products?.name ?? "—"} × {r.quantity}</div>)}
            </div>
            <div>
              <Label>سبب الرفض *</Label>
              <Textarea rows={3} value={rejReason} onChange={(e) => setRejReason(e.target.value)} className="mt-1.5" placeholder="اكتب سبب الرفض…" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setRejOpen(false)}>إلغاء</Button>
            <Button variant="destructive" disabled={busy || !rejReason.trim()} onClick={submitReject}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



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
