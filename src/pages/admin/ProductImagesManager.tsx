import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, ImagePlus, Link2, Trash2, Images, HardDrive, Maximize2, ImageOff, AlertTriangle, Wrench } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatCard } from "@/components/StatCard";
import { PermTable } from "@/components/PermTable";
import { PermCard } from "@/contexts/PermCustomize";
import ProductImage from "@/components/ProductImage";
import { fetchAllRows } from "@/lib/fetchAll";
import { shrinkProductImage } from "@/lib/imagePolicy";
import { invalidateSigned, uploadProductImageAt } from "@/lib/storageImage";
import { rpcErrorText } from "@/lib/rpcError";

/**
 * Product photos page (owner 2026-10-25): summary of the bucket, link a photo to a product, the biggest photos
 * with multi-select delete, and a check for products pointing to a missing file.
 * - A product = every branch row with the same code (SKU): a photo is set on all of them at once.
 * - A product with no photo asks storage for nothing; deleting a photo clears the products FIRST, then the
 *   file, so no product is ever left pointing to a missing file (that costs a request on every screen).
 */
export type Prod = { id: string; name: string; sku: string | null; image: string | null; branch_id: string | null };
export type Group = { key: string; name: string; sku: string; products: Prod[]; image: string | null };
type FileRow = { path: string; size: number };

const BUCKET = "product-images";
export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} ميجا` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** Arabic-friendly search text: أ/إ/آ → ا, ة → ه, ى → ي, no tashkeel, lower case. */
export const norm = (s: string) => s.toLowerCase().replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();

/** Branch rows of one product (same SKU, else same name) → one group. */
export function groupProducts(prods: Prod[]): Group[] {
  const m = new Map<string, Group>();
  prods.forEach((p) => {
    const key = p.sku?.trim() ? `s:${p.sku.trim().toLowerCase()}` : `n:${norm(p.name)}`;
    const g = m.get(key) ?? { key, name: p.name, sku: p.sku?.trim() ?? "", products: [], image: null };
    g.products.push(p);
    if (!g.image && p.image) g.image = p.image;
    m.set(key, g);
  });
  return [...m.values()];
}

async function listBucket(tenantId: string): Promise<FileRow[]> {
  const out: FileRow[] = [];
  const walk = async (prefix: string, depth: number) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      const rows = data ?? [];
      for (const r of rows) {
        const path = `${prefix}/${r.name}`;
        if (r.id == null) { if (depth < 3) await walk(path, depth + 1); }
        else out.push({ path, size: Number((r.metadata as any)?.size ?? 0) });
      }
      if (rows.length < 1000) break;
    }
  };
  await walk(tenantId, 0);
  return out;
}

async function setImage(products: Prod[], image: string | null) {
  for (const p of products) {
    const { error } = await (supabase.rpc as any)("update_product_details", { p_id: p.id, p_patch: { image: image ?? "" } });
    if (error) throw new Error(rpcErrorText(error, "تعديل صورة المنتج"));
  }
}

/** canEdit = may link / delete / fix (owner, admin, or «تعديل المخزون»); otherwise the page only shows the photos. */
export default function ProductImagesManager({ reloadKey = 0, canEdit = true }: { reloadKey?: number; canEdit?: boolean }) {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [prods, setProds] = useState<Prod[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [p, f] = await Promise.all([
        fetchAllRows<Prod>(() => supabase.from("products").select("id, name, sku, image, branch_id").is("archived_at", null).order("id")),
        listBucket(tenantId),
      ]);
      setProds(p); setFiles(f);
    } catch (e: any) {
      toast.error(e?.message ?? "مقدرتش أقرا الصور");
    } finally { setLoading(false); }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const groups = useMemo(() => groupProducts(prods), [prods]);
  const fileSet = useMemo(() => new Set(files.map((f) => f.path)), [files]);
  const usedBy = useMemo(() => {
    const m = new Map<string, Prod[]>();
    prods.forEach((p) => { if (p.image) m.set(p.image, [...(m.get(p.image) ?? []), p]); });
    return m;
  }, [prods]);
  const missing = useMemo(() => prods.filter((p) => p.image && !/^https?:/i.test(p.image) && !fileSet.has(p.image)), [prods, fileSet]);
  const stats = useMemo(() => {
    const total = files.reduce((s, f) => s + f.size, 0);
    const max = files.reduce((a, f) => (f.size > a.size ? f : a), { path: "", size: 0 });
    const noImg = groups.filter((g) => g.products.every((p) => !p.image));
    return { count: files.length, total, max, noImgGroups: noImg.length, noImgProducts: noImg.reduce((s, g) => s + g.products.length, 0) };
  }, [files, groups]);
  const nameOf = (path: string) => usedBy.get(path)?.[0]?.name ?? "مش مربوطة بمنتج";

  // ---------- link ----------
  const [q, setQ] = useState("");
  const [onlyNoImg, setOnlyNoImg] = useState(true);
  const [picked, setPicked] = useState<Group | null>(null);
  const [preview, setPreview] = useState<{ blob: File; url: string; before: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const t = norm(q);
    return groups
      .filter((g) => (!onlyNoImg || g.products.every((p) => !p.image)))
      .filter((g) => !t || norm(g.name).includes(t) || g.sku.toLowerCase().includes(t))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [groups, q, onlyNoImg]);

  const choosePhoto = async (f: File | undefined) => {
    if (!f) return;
    if (fileInput.current) fileInput.current.value = "";
    try {
      const small = await shrinkProductImage(f, f.name);
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ blob: small, url: URL.createObjectURL(small), before: f.size });
    } catch { toast.error("الملف ده مش صورة أقدر أقراها"); }
  };

  const link = async () => {
    if (!picked || !preview || !tenantId) return;
    setBusy(true);
    try {
      const ext = preview.blob.type === "image/webp" ? "webp" : "jpg";
      const folder = picked.products[0]?.branch_id ?? "shared";
      const path = `${tenantId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await uploadProductImageAt(path, preview.blob);
      const old = picked.image;
      await setImage(picked.products, path); // only after the upload worked
      // the old photo of this product, if nothing else uses it, is removed (no orphan files)
      if (old && old !== path && !prods.some((p) => p.image === old && !picked.products.includes(p))) {
        await supabase.storage.from(BUCKET).remove([old]); invalidateSigned(BUCKET, old);
      }
      toast.success(`اتربطت الصورة بـ «${picked.name}» في ${picked.products.length} فرع`);
      URL.revokeObjectURL(preview.url); setPreview(null); setPicked(null); setQ("");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "مقدرتش أربط الصورة");
    } finally { setBusy(false); }
  };

  // ---------- biggest + delete ----------
  const [limit, setLimit] = useState<number>(20);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const biggest = useMemo(() => [...files].sort((a, b) => b.size - a.size), [files]);
  const visible = limit ? biggest.slice(0, limit) : biggest;
  const selFiles = files.filter((f) => sel.has(f.path));
  const selProducts = selFiles.flatMap((f) => usedBy.get(f.path) ?? []);
  const allOn = visible.length > 0 && visible.every((f) => sel.has(f.path));
  const toggle = (p: string) => setSel((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const removeSelected = async () => {
    setConfirm(false); setBusy(true);
    let ok = 0; const failed: string[] = [];
    for (const f of selFiles) {
      try {
        await setImage(usedBy.get(f.path) ?? [], null); // products first: never point to a missing file
        const { error } = await supabase.storage.from(BUCKET).remove([f.path]);
        if (error) throw error;
        invalidateSigned(BUCKET, f.path); ok++;
      } catch { failed.push(nameOf(f.path)); }
    }
    setSel(new Set());
    if (ok) toast.success(`اتمسح ${ok} صورة`);
    if (failed.length) toast.error(`مقدرتش أمسح: ${failed.join("، ")}`);
    await load(); setBusy(false);
  };

  const fixMissing = async () => {
    setBusy(true);
    try { await setImage(missing, null); toast.success(`اتصلّح ${missing.length} منتج`); await load(); }
    catch (e: any) { toast.error(e?.message ?? "مقدرتش أصلّحهم"); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="card-elevated p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> بقرا الصور…</div>;

  return (
    <div className="space-y-4" dir="rtl">
      {/* summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="ملخص الصور">
        <StatCard label="صور مرفوعة" value={stats.count} icon={<Images className="w-5 h-5" />} accent="primary"
          metricHint={{ meaning: "عدد ملفات صور المنتجات على السيرفر", source: "مخزن الصور product-images لشركتك", formula: "عدد الملفات" }} />
        <StatCard label="حجم الصور كلها" value={kb(stats.total)} icon={<HardDrive className="w-5 h-5" />} accent="secondary"
          metricHint={{ meaning: "المساحة اللي الصور واخداها", source: "مخزن الصور product-images", formula: "مجموع أحجام الملفات" }} />
        <StatCard label="أكبر صورة" value={stats.max.size ? kb(stats.max.size) : "—"} hint={stats.max.path ? nameOf(stats.max.path) : undefined} icon={<Maximize2 className="w-5 h-5" />} accent="secondary"
          metricHint={{ meaning: "أكبر ملف صورة واسم منتجه", source: "مخزن الصور product-images", formula: "أكبر حجم ملف" }} />
        <StatCard label="منتجات من غير صورة" value={stats.noImgGroups} hint={`${stats.noImgProducts} في كل الفروع`} icon={<ImageOff className="w-5 h-5" />} accent={stats.noImgGroups ? "warning" : "success"}
          metricHint={{ meaning: "منتجات مالهاش صورة في أي فرع — مش بتبعت أي طلب للسيرفر", source: "المنتجات (غير المؤرشفة)", formula: "منتج = كل صفوف الفروع بنفس الكود؛ يتعد لو مفيش ولا فرع ليه صورة" }} />
        <StatCard label="منتجات صورتها مفقودة" value={missing.length} icon={<AlertTriangle className="w-5 h-5" />} accent={missing.length ? "destructive" : "success"}
          metricHint={{ meaning: "منتج متسجل عليه صورة والملف مش موجود — بيبعت طلب ضايع في كل شاشة. لازم يفضل 0", source: "المنتجات + مخزن الصور", formula: "منتجات خانة صورتها مليانة والملف مش في المخزن" }} />
      </div>
      {canEdit && missing.length > 0 && (
        <div className="card-elevated p-3 flex flex-wrap items-center gap-2 border-destructive/40">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <span className="text-sm">{missing.length} منتج متسجل عليهم صورة مش موجودة. «صلّحهم» يفضّي خانة الصورة فيهم بس.</span>
          <Button size="sm" variant="outline" onClick={fixMissing} disabled={busy}><Wrench className="w-4 h-4 ml-1" /> صلّحهم</Button>
        </div>
      )}

      {/* link a photo — each box has its own show / hide switch («افتح الصفحة وظبطها») */}
      {canEdit && <PermCard label="اربط صورة بمنتج"><div className="card-elevated p-4 space-y-3">
        <div className="flex items-center gap-2 font-extrabold"><Link2 className="w-5 h-5 text-primary" /> اربط صورة بمنتج</div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب اسم المنتج أو الكود…" className="pr-9" aria-label="ابحث عن منتج" />
          </div>
          <div className="flex rounded-lg border overflow-hidden text-sm" role="group" aria-label="فلتر المنتجات">
            <button type="button" className={`px-3 py-1.5 ${onlyNoImg ? "bg-primary text-primary-foreground" : ""}`} aria-pressed={onlyNoImg} onClick={() => setOnlyNoImg(true)}>من غير صورة ({stats.noImgGroups})</button>
            <button type="button" className={`px-3 py-1.5 ${!onlyNoImg ? "bg-primary text-primary-foreground" : ""}`} aria-pressed={!onlyNoImg} onClick={() => setOnlyNoImg(false)}>كل المنتجات ({groups.length})</button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border divide-y" role="listbox" aria-label="المنتجات">
          {shown.slice(0, 100).map((g) => (
            <button key={g.key} type="button" role="option" aria-selected={picked?.key === g.key}
              onClick={() => setPicked(g)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-right text-sm hover:bg-muted/50 ${picked?.key === g.key ? "bg-primary/10" : ""}`}>
              {g.image ? <ProductImage src={g.image} className="w-9 h-9 rounded object-cover shrink-0" /> : <div className="w-9 h-9 rounded bg-muted/50 flex items-center justify-center shrink-0"><ImageOff className="w-4 h-4 text-muted-foreground" /></div>}
              <span className="flex-1 truncate">{g.name}</span>
              <span className="text-xs text-muted-foreground font-mono" dir="ltr">{g.sku}</span>
              <span className="text-xs text-muted-foreground">{g.products.length} فرع</span>
            </button>
          ))}
          {!shown.length && <div className="p-4 text-sm text-muted-foreground text-center">مفيش منتج بالاسم ده</div>}
          {shown.length > 100 && <div className="p-2 text-xs text-muted-foreground text-center">ظاهر أول 100 من {shown.length} — اكتب أكتر عشان تضيّق</div>}
        </div>
        {picked && (
          <div className="rounded-lg border p-3 flex flex-wrap items-center gap-3 bg-muted/20">
            <div className="text-sm flex-1 min-w-[200px]">المنتج: <b>{picked.name}</b> — هتتحط في <b>{picked.products.length} فرع</b>{picked.image ? " (هتستبدل الصورة الحالية)" : ""}</div>
            {preview && (
              <div className="flex items-center gap-2">
                <img src={preview.url} alt="معاينة" className="w-16 h-16 rounded object-cover border" />
                <div className="text-xs text-muted-foreground">كانت {kb(preview.before)}<br />بقت <b className="text-success">{kb(preview.blob.size)}</b></div>
              </div>
            )}
            <input ref={fileInput} type="file" accept="image/*" className="hidden" aria-label="اختار صورة المنتج" onChange={(e) => choosePhoto(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}><ImagePlus className="w-4 h-4 ml-1" /> {preview ? "غيّر الصورة" : "اختار صورة"}</Button>
            <Button onClick={link} disabled={busy || !preview}>{busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Link2 className="w-4 h-4 ml-1" />} اربط</Button>
          </div>
        )}
      </div></PermCard>}

      {/* biggest photos */}
      <PermCard label="أكبر الصور"><div className="card-elevated p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 font-extrabold flex-1"><Maximize2 className="w-5 h-5 text-primary" /> أكبر الصور</div>
          <span className="text-xs text-muted-foreground">عرض:</span>
          {[20, 50, 0].map((n) => (
            <Button key={n} size="sm" variant={limit === n ? "default" : "outline"} onClick={() => setLimit(n)}>{n ? `أكبر ${n}` : `الكل (${files.length})`}</Button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <PermTable className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr className="text-xs">
                {canEdit && <th className="px-3 py-2 w-10"><Checkbox checked={allOn} onCheckedChange={(v) => setSel((s) => { const n = new Set(s); visible.forEach((f) => (v ? n.add(f.path) : n.delete(f.path))); return n; })} aria-label="اختار الكل" /></th>}
                <th className="px-3 py-2 text-right">الصورة</th>
                <th className="px-3 py-2 text-right">المنتج</th>
                <th className="px-3 py-2">الحجم</th>
                <th className="px-3 py-2">الفروع</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => {
                const used = usedBy.get(f.path) ?? [];
                return (
                  <tr key={f.path} className={`border-t border-border/60 ${sel.has(f.path) ? "bg-destructive/5" : ""}`}>
                    {canEdit && <td className="px-3 py-1.5 text-center"><Checkbox checked={sel.has(f.path)} onCheckedChange={() => toggle(f.path)} aria-label={`اختار صورة ${nameOf(f.path)}`} /></td>}
                    <td className="px-3 py-1.5"><ProductImage src={f.path} className="w-10 h-10 rounded object-cover" /></td>
                    <td className="px-3 py-1.5 text-xs">{used.length ? used[0].name : <span className="text-muted-foreground">مش مربوطة بمنتج</span>}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-xs font-bold">{kb(f.size)}</td>
                    <td className="px-3 py-1.5 text-center text-xs">{used.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </PermTable>
        </div>
        {canEdit && sel.size > 0 && (
          <div className="sticky bottom-2 rounded-lg border bg-background shadow-lg p-3 flex flex-wrap items-center gap-3">
            <span className="text-sm flex-1">مختار <b>{selFiles.length}</b> صورة • <b>{kb(selFiles.reduce((s, f) => s + f.size, 0))}</b> • على <b>{selProducts.length}</b> منتج</span>
            <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>إلغاء الاختيار</Button>
            <Button variant="destructive" onClick={() => setConfirm(true)} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Trash2 className="w-4 h-4 ml-1" />} امسح المختار</Button>
          </div>
        )}
      </div></PermCard>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تمسح {selFiles.length} صورة؟</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>هتتمسح {selFiles.length} صورة ({kb(selFiles.reduce((s, f) => s + f.size, 0))}) من {selProducts.length} منتج، <b>ومش هترجع</b>. المنتجات هتفضل من غير صورة لحد ما تربطلها صورة جديدة.</p>
                <ul className="max-h-40 overflow-y-auto list-disc pr-5 text-xs">
                  {selFiles.map((f) => <li key={f.path}>{nameOf(f.path)} — {kb(f.size)}</li>)}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>لا</AlertDialogCancel>
            <AlertDialogAction onClick={removeSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">أيوه امسح</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
