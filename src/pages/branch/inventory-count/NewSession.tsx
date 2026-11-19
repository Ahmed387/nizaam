import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { fetchAllRows } from "@/lib/fetchAll";
import { matchProducts } from "@/lib/codeSuggest";
import { cairoTodayDay } from "@/lib/cairoDate";
import { COUNT_MODE_LABEL, partialProblem, pickByWords, type CountMode, type CountProduct } from "@/lib/partialCount";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Navigate } from "react-router-dom";
import { rpcErrorText } from "@/lib/rpcError";

export default function NewSession() {
  const { id: branchId } = useParams<{ id: string }>();
  const { isOwner, canInBranch, branches } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // 0271: «كل الأصناف» أو «جزء بس» (بكلمة / أصناف بعينها / اتحركت في فترة)
  const [partial, setPartial] = useState(false);
  const [mode, setMode] = useState<CountMode>("words");
  const [words, setWords] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(() => { const d = new Date(`${cairoTodayDay()}T00:00:00`); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(cairoTodayDay());
  const [products, setProducts] = useState<CountProduct[] | null>(null);
  const [moved, setMoved] = useState<(CountProduct & { moves: number })[] | null>(null);

  useEffect(() => {
    if (!partial || products || !branchId) return;
    fetchAllRows<CountProduct>(() => supabase.from("products").select("id,name,sku,quantity").eq("branch_id", branchId).is("archived_at", null).order("id"))
      .then(setProducts).catch((e) => toast.error(rpcErrorText(e)));
  }, [partial, products, branchId]);
  useEffect(() => {
    if (!partial || mode !== "moved" || !branchId || !from || !to || to < from) { setMoved(null); return; }
    let off = false;
    supabase.rpc("count_moved_products" as any, { p_branch_id: branchId, p_from: from, p_to: to } as any).then(({ data, error }) => {
      if (off) return;
      if (error) { toast.error(rpcErrorText(error)); setMoved([]); return; }
      setMoved(((data as any[]) ?? []).map((r) => ({ id: r.product_id, name: r.name, sku: r.sku, quantity: r.quantity, moves: Number(r.moves) })));
    });
    return () => { off = true; };
  }, [partial, mode, branchId, from, to]);

  const chosen: CountProduct[] = useMemo(() => {
    if (!partial) return [];
    if (mode === "words") return pickByWords(products ?? [], words);
    if (mode === "moved") return moved ?? [];
    return (products ?? []).filter((p) => picked.has(p.id));
  }, [partial, mode, products, words, moved, picked]);
  const searchHits = useMemo(() => (mode === "items" && query.trim() ? matchProducts(query, products ?? [], 40) : []), [mode, query, products]);

  // 0267: «جرد المخزن ← يضيف» in this branch (warehouse / manager by default) or the owner
  if (!isOwner && !canInBranch("stock_count.create", branchId)) {
    return <Navigate to={`/branch/${branchId}/inventory-count`} replace />;
  }

  const branch = branches.find((b) => b.id === branchId);

  const submit = async () => {
    if (!branchId) return;
    if (partial) {
      const problem = partialProblem(mode, chosen.map((p) => p.id), { words, from, to });
      if (problem) return toast.error(problem);
    }
    setSaving(true);
    const { data, error } = partial
      ? await supabase.rpc("create_partial_inventory_session" as any, {
          p_branch_id: branchId, p_notes: notes || null, p_product_ids: chosen.map((p) => p.id),
          p_scope: { mode, words: mode === "words" ? words.trim() : undefined, from: mode === "moved" ? from : undefined, to: mode === "moved" ? to : undefined },
        } as any)
      : await supabase.rpc("create_inventory_session" as any, {
          p_branch_id: branchId,
          p_notes: notes || null,
        });
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success(partial ? `اتفتح جرد جزئي على ${chosen.length} صنف — الأصناف التانية مش هتتلمس` : "تم فتح جلسة جرد جديدة — تم التقاط الكميات الحالية");

    // Notify accountant + warehouse keepers of this branch
    try {
      const { getBranchUsersByRoles, notifyMany } = await import("@/lib/notifications");
      const recipients = await getBranchUsersByRoles(branchId, ["branch_manager", "warehouse"]);
      if (recipients.length) {
        await notifyMany(recipients, {
          title: "تم فتح جلسة جرد جديدة",
          body: `اتفتح جرد في فرع ${branch?.name ?? ""} — أمين المخزن أو المدير يدخّل العد`,
          type: "general",
          link: `/branch/${branchId}/inventory?tab=count`,
          relatedEntity: "inventory_session",
          relatedEntityId: String(data),
        });
      }
    } catch (e) {
      console.error("notify failed", e);
    }

    navigate(`/branch/${branchId}/inventory-count/${data}/count`);
  };

  return (
    <ConditionalLayout
      title="بدء جرد جديد"
      subtitle="عند البدء بيتاخد صورة من كميات المخزون الحالية"
    >
      <div className="card-elevated p-6 max-w-2xl space-y-5">
        <div>
          <Label>المخزن</Label>
          <div className="mt-2 p-3 rounded-lg bg-surface-2 border border-border font-semibold">
            {branch?.name ?? "—"}
          </div>
        </div>
        <div data-testid="count-scope">
          <Label>هتجرد إيه؟</Label>
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={() => setPartial(false)} className={`flex-1 rounded-lg border p-3 text-sm font-bold ${!partial ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>كل أصناف الفرع</button>
            <button type="button" onClick={() => setPartial(true)} className={`flex-1 rounded-lg border p-3 text-sm font-bold ${partial ? "border-primary bg-primary/10 text-primary" : "border-border"}`} data-testid="count-partial">جزء بس (جرد جزئي)</button>
          </div>
        </div>
        {partial && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap gap-1">
              {(Object.keys(COUNT_MODE_LABEL) as CountMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} data-testid={`count-mode-${m}`}
                  className={`rounded-md border px-3 py-1.5 text-xs font-bold ${mode === m ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{COUNT_MODE_LABEL[m]}</button>
              ))}
            </div>
            {!products && <div className="text-sm text-muted-foreground">بيحمّل أصناف الفرع…</div>}
            {mode === "words" && (
              <div>
                <Input value={words} onChange={(e) => setWords(e.target.value)} placeholder="مثلاً: غسالة — أو: شاشة سامسونج" data-testid="count-words" />
                <div className="text-xs text-muted-foreground mt-1">كل صنف في اسمه الكلمات دي هيدخل الجرد.</div>
              </div>
            )}
            {mode === "items" && (
              <div className="space-y-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الكود وعلّم على الأصناف" />
                {searchHits.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded border border-border">
                    {searchHits.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm border-b border-border/50 cursor-pointer">
                        <Checkbox checked={picked.has(p.id)} onCheckedChange={() => setPicked((s0) => { const n = new Set(s0); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} />
                        <span className="flex-1">{p.name}</span><span className="text-xs text-muted-foreground" dir="ltr">{p.sku}</span>
                        <span className="text-xs tabular-nums">رصيد {p.quantity ?? 0}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mode === "moved" && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">من</Label><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1" /></div>
                <div><Label className="text-xs">إلى</Label><Input type="date" value={to} max={cairoTodayDay()} onChange={(e) => setTo(e.target.value)} className="mt-1" /></div>
                <div className="col-span-2 text-xs text-muted-foreground">كل صنف اتباع أو اتشرى أو رجع أو اتحول في الفترة دي هيدخل الجرد.</div>
              </div>
            )}
            <div className="rounded-md bg-surface-2 p-2 text-sm" data-testid="count-chosen">
              <b>{chosen.length}</b> صنف هيدخلوا الجرد{chosen.length > 0 && <span className="text-xs text-muted-foreground"> — {chosen.slice(0, 6).map((p) => p.name).join("، ")}{chosen.length > 6 ? "…" : ""}</span>}
            </div>
          </div>
        )}
        <div>
          <Label>ملاحظات (اختياري)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="أي ملاحظات تخص هذه الجلسة..."
            className="mt-2"
          />
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          ⚠️ بمجرد بدء الجلسة سيتم تثبيت كميات النظام لحظياً ولن تتأثر بأي مبيعات أو مشتريات لاحقة.
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => navigate(-1)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {partial ? `بدء جرد ${chosen.length} صنف` : "بدء الجرد"}
          </Button>
        </div>
      </div>
    </ConditionalLayout>
  );
}
