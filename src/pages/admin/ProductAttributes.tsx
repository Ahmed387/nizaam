import { useEffect, useMemo, useState } from "react";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { extractAttributes, fillableAttrs } from "@/lib/productAttributeExtract";
import { VARIANT_LABELS, VariantAttrs, hasVariantInfo } from "@/lib/productVariant";
import { searchMatch } from "@/lib/search";
import { Wand2, Package, CheckCircle2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

type Prod = {
  id: string;
  name: string;
  sku: string | null;
  branch_id: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  product_type: string | null;
  capacity: string | null;
  size: string | null;
  branches?: { name?: string } | null;
};

const FIELDS: (keyof VariantAttrs)[] = ["brand", "model", "color", "product_type", "capacity", "size"];

export default function ProductAttributes({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<Prod[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [draft, setDraft] = useState<Record<string, Partial<VariantAttrs>>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("id, name, sku, branch_id, brand, model, color, product_type, capacity, size, branches(name)")
      .is("archived_at", null)
      .order("name");
    if (error) toast.error("تعذر تحميل المنتجات");
    setRows((data as any as Prod[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  /** Run the heuristics over every visible product and stage the result as a draft. */
  const runExtraction = () => {
    const next: Record<string, Partial<VariantAttrs>> = {};
    const sel: Record<string, boolean> = {};
    for (const p of visible) {
      const suggestion = extractAttributes(p.name, p.sku);
      const patch = fillableAttrs(p, suggestion, overwrite);
      if (Object.keys(patch).length) { next[p.id] = patch; sel[p.id] = true; }
    }
    setDraft(next);
    setSelected(sel);
    const n = Object.keys(next).length;
    toast[n ? "success" : "info"](n ? `تم استخراج خصائص لـ ${n} منتج — راجعها قبل الحفظ` : "لا توجد خصائص جديدة للاستخراج");
  };

  const visible = useMemo(() => {
    return rows.filter((p) => {
      if (onlyMissing && hasVariantInfo(p)) return false;
      if (!q.trim()) return true;
      return searchMatch(q, p.name, p.sku ?? "", p.brand ?? "", p.model ?? "");
    });
  }, [rows, q, onlyMissing]);

  const staged = useMemo(
    () => visible.filter((p) => draft[p.id] && Object.keys(draft[p.id]).length && selected[p.id]),
    [visible, draft, selected]
  );

  const setCell = (id: string, key: keyof VariantAttrs, value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? {}), [key]: value } }));

  const apply = async () => {
    setSaving(true);
    let ok = 0, fail = 0;
    for (const p of staged) {
      const patch = Object.fromEntries(
        Object.entries(draft[p.id]).map(([k, v]) => [k, String(v ?? "").trim() || null])
      );
      const { error } = await (supabase.rpc as any)("update_product_details", { p_id: p.id, p_patch: patch });
      if (error) fail++; else ok++;
    }
    setSaving(false);
    setConfirmOpen(false);
    setDraft({}); setSelected({});
    toast[fail ? "warning" : "success"](fail ? `تم تحديث ${ok} منتج وفشل ${fail}` : `تم تحديث ${ok} منتج بنجاح`);
    load();
  };

  const filled = rows.filter(hasVariantInfo).length;

  return (
    <ConditionalLayout
      embedded={embedded}
      variant="admin"
      title="استخراج خصائص المنتجات"
      subtitle="استخرج الماركة والموديل واللون والنوع والسعة تلقائياً من أسماء المنتجات القديمة، وراجعها قبل الحفظ"
    >

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <StatCard label="إجمالي المنتجات" value={String(rows.length)} icon={<Package className="w-5 h-5" />} />
        <StatCard label="مكتملة الخصائص" value={String(filled)} icon={<CheckCircle2 className="w-5 h-5" />} />
        <StatCard label="ناقصة الخصائص" value={String(rows.length - filled)} icon={<Wand2 className="w-5 h-5" />} />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px] space-y-1">
            <Label className="text-xs font-semibold text-muted-foreground">بحث</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم المنتج أو الكود..." />
          </div>
          <label className="flex items-center gap-2 text-sm h-10">
            <Checkbox checked={onlyMissing} onCheckedChange={(v) => setOnlyMissing(!!v)} />
            الناقصة فقط
          </label>
          <label className="flex items-center gap-2 text-sm h-10">
            <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(!!v)} />
            استبدال القيم الموجودة
          </label>
          <Button onClick={runExtraction} className="gap-2">
            <Wand2 className="w-4 h-4" /> استخراج تلقائي
          </Button>
          <Button
            variant="default"
            disabled={!staged.length || saving}
            onClick={() => setConfirmOpen(true)}
            className="gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ ({staged.length})
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> جاري التحميل...
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((p) => {
            const patch = draft[p.id];
            return (
              <Card key={p.id} className={patch ? "border-primary/40" : undefined}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      className="mt-1"
                      disabled={!patch}
                      checked={!!selected[p.id] && !!patch}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [p.id]: !!v }))}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm break-words">{p.name}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <Badge variant="outline" className="font-mono text-[10px]">{p.sku ?? "—"}</Badge>
                        {p.branches?.name && <Badge variant="secondary" className="text-[10px]">{p.branches.name}</Badge>}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    {FIELDS.map((f) => {
                      const suggested = patch?.[f];
                      const current = p[f] ?? "";
                      return (
                        <div key={f} className="space-y-1">
                          <Label className="text-[10px] font-semibold text-muted-foreground">{VARIANT_LABELS[f]}</Label>
                          <Input
                            className={`h-9 text-xs ${suggested ? "border-primary/60 bg-primary/5" : ""}`}
                            value={String(suggested ?? current ?? "")}
                            placeholder="—"
                            onChange={(e) => setCell(p.id, f, e.target.value)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {!visible.length && (
            <div className="text-center text-muted-foreground py-12 text-sm">لا توجد منتجات مطابقة</div>
          )}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حفظ الخصائص</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم تحديث {staged.length} منتج بالخصائص المعروضة. الخصائص الجديدة هتظهر في كل الفواتير وفواتير الشراء القادمة،
              والمستندات القديمة هتفضل زي ما هي.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={apply}>تأكيد الحفظ</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConditionalLayout>
  );
}
