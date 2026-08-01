import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { BarcodeCameraScanner } from "@/components/BarcodeCameraScanner";
import { searchMatch } from "@/lib/search";
import { toast } from "sonner";
import { Loader2, Send, Search, ScanLine, Save, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { VariantLine } from "@/components/VariantChips";

const PAGE_SIZE = 50;

export default function CountingSheet() {
  const { id: branchId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const { hasRole, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [savedVals, setSavedVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sess, setSess] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [flashRow, setFlashRow] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const allowed = isAdmin || hasRole("warehouse");

  const load = async () => {
    if (!sessionId) return;
    setLoading(true);
    const [s, it] = await Promise.all([
      supabase.from("inventory_sessions" as any).select("*").eq("id", sessionId).maybeSingle(),
      supabase
        .from("inventory_session_items" as any)
        // never select system_quantity — keep keeper blind
        .select("id, product_code, product_name, unit, actual_quantity, brand, model, color, product_type, capacity, size")
        .eq("session_id", sessionId)
        .order("product_name"),
    ]);
    setSess(s.data);
    setItems((it.data as any) ?? []);
    const m: Record<string, string> = {};
    (it.data as any[] | null)?.forEach((r) => {
      if (r.actual_quantity != null) m[r.id] = String(r.actual_quantity);
    });
    setVals(m);
    setSavedVals(m);
    setLoading(false);
  };
  useEffect(() => { load(); }, [sessionId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter((it) =>
      searchMatch(query, it.product_code, it.product_name, it.color, it.product_type, it.capacity, it.size, it.unit)
    );
  }, [items, query]);

  useEffect(() => { setPage(0); }, [query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const counted = useMemo(() => Object.values(vals).filter((v) => v !== "" && v != null).length, [vals]);
  const progress = items.length ? Math.round((counted / items.length) * 100) : 0;

  const pendingChanges = useMemo(() => {
    let changed = 0;
    for (const it of items) {
      const cur = vals[it.id] ?? "";
      const prev = savedVals[it.id] ?? "";
      if (cur !== prev) changed += 1;
    }
    return changed;
  }, [items, vals, savedVals]);

  const focusRow = (rowId: string) => {
    const idx = filtered.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    const targetPage = Math.floor(idx / PAGE_SIZE);
    setPage(targetPage);
    setFlashRow(rowId);
    setTimeout(() => {
      const el = rowRefs.current[rowId];
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); el.select(); }
      setTimeout(() => setFlashRow(null), 1200);
    }, 60);
  };

  const handleScan = (code: string) => {
    const norm = code.trim();
    // exact code match first, then name/attrs contains
    const exact = items.find((it) => String(it.product_code ?? "").trim() === norm);
    const found = exact ?? items.find((it) => searchMatch(norm, it.product_code, it.product_name));
    if (!found) { toast.error(`لم يتم العثور على منتج بالكود: ${norm}`); return; }
    // auto-increment quantity by 1 on scan (fast counting mode)
    setVals((v) => {
      const prev = Number(v[found.id] ?? 0) || 0;
      return { ...v, [found.id]: String(prev + 1) };
    });
    toast.success(`${found.product_name} — الكمية: ${(Number(vals[found.id] ?? 0) || 0) + 1}`);
    focusRow(found.id);
  };

  const save = async (final: boolean) => {
    if (!sessionId) return;
    setSaving(true);
    try {
      // Batch upsert via single RPC
      const payload = items
        .filter((it) => {
          const cur = vals[it.id] ?? "";
          const prev = savedVals[it.id] ?? "";
          return cur !== prev; // only send changed rows
        })
        .map((it) => ({ id: it.id, actual_quantity: vals[it.id] === "" || vals[it.id] == null ? null : Number(vals[it.id]) }));

      if (payload.length > 0) {
        const { error } = await supabase.rpc("upsert_inventory_counts" as any, {
          _session_id: sessionId,
          _items: payload,
        });
        if (error) throw error;
        setSavedVals({ ...vals });
      }

      if (final) {
        if (counted < items.length) {
          setSaving(false);
          return toast.error("يجب إدخال جميع الأصناف قبل الإرسال للمراجعة");
        }
        const { error } = await supabase
          .from("inventory_sessions" as any)
          .update({ status: "reviewing", counted_at: new Date().toISOString() })
          .eq("id", sessionId);
        if (error) throw error;
        toast.success("تم إرسال الجرد للمراجعة");
        navigate(`/branch/${branchId}/inventory-count`);
      } else {
        toast.success(`تم حفظ ${payload.length} تعديل`);
      }
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) {
    return (
      <ConditionalLayout title="جرد الفرع">
        <div className="card-elevated p-8 text-center text-muted-foreground">هذه الصفحة لأمين المخزن فقط.</div>
      </ConditionalLayout>
    );
  }

  return (
    <ConditionalLayout
      title="إدخال كميات الجرد"
      subtitle="أدخل الكمية الفعلية لكل منتج — كميات النظام مخفية"
      actions={
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setScannerOpen(true)}
            disabled={loading || sess?.status !== "counting"}
            className="gap-2"
          >
            <ScanLine className="w-4 h-4" /> مسح باركود
          </Button>
          <Button variant="outline" onClick={() => save(false)} disabled={saving || loading || sess?.status !== "counting" || pendingChanges === 0} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ ({pendingChanges})
          </Button>
          <Button onClick={() => save(true)} disabled={saving || loading || sess?.status !== "counting"} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            إرسال للمراجعة
          </Button>
        </div>
      }
    >
      {sess && sess.status !== "counting" && (
        <div className="card-elevated p-4 mb-4 text-amber-600 bg-amber-500/10 border-amber-500/30">
          هذه الجلسة لم تعد في طور العد — لا يمكن التعديل.
        </div>
      )}

      <div className="card-elevated p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span>التقدم: <b>{counted}</b> / {items.length}</span>
            <span className="text-muted-foreground">•</span>
            <span className="text-primary font-semibold">{progress}%</span>
            {pendingChanges > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs bg-warning/15 text-warning px-2 py-0.5 rounded-full font-bold">
                <Sparkles className="w-3 h-3" /> {pendingChanges} تعديل بانتظار الحفظ
              </span>
            )}
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث بالكود، الاسم، اللون، النوع…"
              className="pr-9"
            />
          </div>
        </div>
        <Progress value={progress} />
      </div>

      {loading ? (
        <div className="card-elevated p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="card-elevated overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-3 py-2 text-right">الكود</th>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">الوحدة</th>
                <th className="px-3 py-2 text-right w-40">الكمية الفعلية</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((it) => {
                const cur = vals[it.id] ?? "";
                const prev = savedVals[it.id] ?? "";
                const isDirty = cur !== prev;
                const isFlash = flashRow === it.id;
                return (
                  <tr
                    key={it.id}
                    className={`border-t border-border transition-colors ${isFlash ? "bg-primary/10" : isDirty ? "bg-warning/5" : ""}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{it.product_code}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{it.product_name}</div>
                      <VariantLine attrs={it as any} />
                      {(it.color || it.product_type || it.capacity || it.size) && (
                        <div className="text-[11px] text-muted-foreground">
                          {[it.product_type, it.color, it.capacity, it.size].filter(Boolean).join(" • ")}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">{it.unit ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Input
                        ref={(el) => { rowRefs.current[it.id] = el; }}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={cur}
                        onChange={(e) => setVals((v) => ({ ...v, [it.id]: e.target.value }))}
                        disabled={sess?.status !== "counting"}
                        placeholder="0"
                        className={isDirty ? "border-warning focus-visible:ring-warning/40" : ""}
                      />
                    </td>
                  </tr>
                );
              })}
              {pageItems.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">لا نتائج مطابقة للبحث</td></tr>
              )}
            </tbody>
          </table>

          {pageCount > 1 && (
            <div className="flex items-center justify-between p-3 border-t border-border bg-surface-2/40">
              <div className="text-xs text-muted-foreground">
                عرض {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} من {filtered.length}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={currentPage === 0}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <div className="text-xs font-bold tabular-nums">{currentPage + 1} / {pageCount}</div>
                <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={currentPage >= pageCount - 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <BarcodeCameraScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={handleScan}
        continuous
      />
    </ConditionalLayout>
  );
}
