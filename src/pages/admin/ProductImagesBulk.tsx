import { useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Upload, CheckCircle2, XCircle, FileArchive, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { fetchAllRows } from "@/lib/fetchAll";
import { readZip } from "@/lib/zipRead";
import { PRODUCT_IMAGE, shrinkProductImage } from "@/lib/imagePolicy";
import { uploadProductImageAt } from "@/lib/storageImage";
import { rpcErrorText } from "@/lib/rpcError";
import { PermTable } from "@/components/PermTable";

/**
 * «رفع صور المنتجات بالجملة» (owner 2026-10-25): pick a zip or many photos → each photo is shrunk ON THIS DEVICE
 * (imagePolicy: 800 px, WebP, ≤ 200 KB) before anything is sent → matched to its products → uploaded → report.
 * Matching: 1) the file name = the name of the photo a product already points to (the photos of the move) — the
 * small copy goes to that exact place, the products are not changed; 2) else the file name = a product code (SKU)
 * — the photo is uploaded once and set on every product with that code (update_product_details).
 */
type Prod = { id: string; name: string; sku: string | null; image: string | null; branch_id: string | null };
type Item = {
  name: string; size: number; read: () => Promise<Blob>;
  target: { kind: "path"; path: string; products: Prod[] } | { kind: "sku"; products: Prod[] } | null;
  status: "wait" | "done" | "fail" | "skip"; after?: number; error?: string;
};

const IMG = /\.(jpe?g|png|webp|gif|bmp|avif|heic|svg)$/i;
const MAX_INPUT = 25 * 1024 * 1024;
const base = (n: string) => n.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} ميجا` : `${Math.round(n / 1024)} KB`);
const mime = (n: string) => (/\.png$/i.test(n) ? "image/png" : /\.webp$/i.test(n) ? "image/webp" : /\.svg$/i.test(n) ? "image/svg+xml" : "image/jpeg");

export default function ProductImagesBulk() {
  const { tenantId } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const pick = async (files: FileList | null) => {
    if (!files?.length || !tenantId) return;
    setReading(true);
    try {
      const prods = await fetchAllRows<Prod>(() => supabase.from("products").select("id, name, sku, image, branch_id").order("id"));
      const byPhoto = new Map<string, { path: string; products: Prod[] }>();
      const bySku = new Map<string, Prod[]>();
      prods.forEach((p) => {
        if (p.image && !/^https?:/i.test(p.image)) {
          const k = base(p.image).toLowerCase();
          const e = byPhoto.get(k) ?? { path: p.image, products: [] };
          e.products.push(p); byPhoto.set(k, e);
        }
        if (p.sku) { const k = p.sku.trim().toLowerCase(); bySku.set(k, [...(bySku.get(k) ?? []), p]); }
      });
      const raw: { name: string; size: number; read: () => Promise<Blob> }[] = [];
      for (const f of Array.from(files)) {
        if (/\.zip$/i.test(f.name)) {
          for (const e of await readZip(f)) {
            if (IMG.test(e.name)) raw.push({ name: e.name.replace(/^.*\//, ""), size: e.size, read: async () => new Blob([await e.read()], { type: mime(e.name) }) });
          }
        } else if (IMG.test(f.name) || f.type.startsWith("image/")) raw.push({ name: f.name, size: f.size, read: async () => f });
      }
      const seen = new Set<string>();
      const list: Item[] = raw.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true))).map((r) => {
        const k = base(r.name).toLowerCase();
        const photo = byPhoto.get(k);
        const sku = bySku.get(k);
        const target: Item["target"] = photo ? { kind: "path", ...photo } : sku ? { kind: "sku", products: sku } : null;
        const tooBig = r.size > MAX_INPUT;
        return { ...r, target, status: !target || tooBig ? "skip" : "wait", error: tooBig ? "أكبر من 25 ميجا" : undefined };
      });
      setItems(list); setDoneCount(0);
      if (!list.length) toast.error("مفيش صور في اللي اخترته");
    } catch (e: any) {
      toast.error(e?.message ?? "مقدرتش أقرا الملفات");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };

  const run = async () => {
    if (!tenantId) return;
    setRunning(true);
    let i = 0;
    const todo = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.status === "wait");
    const put = (idx: number, patch: Partial<Item>) => setItems((l) => l.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
    const worker = async () => {
      while (i < todo.length) {
        const { it, idx } = todo[i++];
        try {
          const small = await shrinkProductImage(await it.read(), it.name);
          if (it.target!.kind === "path") {
            // the photo the products already point to: same place, products untouched
            await uploadProductImageAt(it.target.path, small);
          } else {
            const ext = small.type === "image/webp" ? "webp" : "jpg";
            const folder = it.target!.products[0]?.branch_id ?? "shared";
            const path = `${tenantId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            await uploadProductImageAt(path, small);
            for (const p of it.target!.products) {
              const { error } = await (supabase.rpc as any)("update_product_details", { p_id: p.id, p_patch: { image: path } });
              if (error) throw new Error(rpcErrorText(error, "ربط الصورة بالمنتج"));
            }
          }
          put(idx, { status: "done", after: small.size });
        } catch (e: any) {
          put(idx, { status: "fail", error: e?.message ?? "فشل" });
        } finally {
          setDoneCount((n) => n + 1);
        }
      }
    };
    // three at a time: fast enough, never a flood on the server
    await Promise.all([worker(), worker(), worker()]);
    setRunning(false);
    toast.success("خلص الرفع — شوف التقرير تحت");
  };

  const stats = useMemo(() => {
    const s = { all: items.length, byPhoto: 0, bySku: 0, none: 0, products: 0, before: 0, after: 0, done: 0, fail: 0, wait: 0 };
    items.forEach((it) => {
      if (!it.target) s.none++;
      else if (it.target.kind === "path") s.byPhoto++;
      else s.bySku++;
      if (it.target && it.status !== "skip") s.products += it.target.products.length;
      if (it.status === "done") { s.done++; s.before += it.size; s.after += it.after ?? 0; }
      if (it.status === "fail") s.fail++;
      if (it.status === "wait") s.wait++;
    });
    return s;
  }, [items]);
  const total = items.filter((x) => x.target && x.error !== "أكبر من 25 ميجا").length;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="card-elevated p-4 space-y-2">
        <div className="flex items-center gap-2 font-extrabold"><ImagePlus className="w-5 h-5 text-primary" /> رفع صور المنتجات بالجملة</div>
        <p className="text-sm text-muted-foreground leading-7">
          اختار ملف zip أو صور كتير مرة واحدة. كل صورة بتتصغّر <b>على جهازك قبل ما تترفع</b>: أكبر طول {PRODUCT_IMAGE.maxDim} بيكسل، صيغة WebP،
          ومفيش صورة أكبر من {Math.round(PRODUCT_IMAGE.maxBytes / 1024)} KB — فالسيرفر مبيشوفش الحجم الكبير خالص.
          الصورة بتتربط بمنتجها من <b>اسم الملف</b>: لو اسمها نفس اسم الصورة اللي المنتج مستنيها، أو نفس <b>كود المنتج</b>.
        </p>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" multiple accept=".zip,image/*" className="hidden" onChange={(e) => pick(e.target.files)} aria-label="اختار الصور أو ملف zip" />
          <Button variant="outline" onClick={() => input.current?.click()} disabled={reading || running}>
            {reading ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <FileArchive className="w-4 h-4 ml-1" />} اختار zip أو صور
          </Button>
          <Button onClick={run} disabled={running || !stats.wait}>
            {running ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Upload className="w-4 h-4 ml-1" />} صغّر وارفع {stats.wait ? `(${stats.wait})` : ""}
          </Button>
        </div>
      </div>

      {items.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label="ملخص الرفع">
            <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">صور اتقرت</div><div className="text-2xl font-extrabold">{stats.all}</div></div>
            <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">ليها منتج</div><div className="text-2xl font-extrabold text-success">{stats.byPhoto + stats.bySku}</div><div className="text-[11px] text-muted-foreground">بالاسم {stats.byPhoto} · بالكود {stats.bySku} · {stats.products} منتج</div></div>
            <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">ملهاش منتج (مش هتترفع)</div><div className="text-2xl font-extrabold text-warning">{stats.none}</div></div>
            <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">الحجم بعد التصغير</div><div className="text-2xl font-extrabold">{stats.done ? kb(stats.after) : "—"}</div><div className="text-[11px] text-muted-foreground">{stats.done ? `كان ${kb(stats.before)}` : "بيظهر بعد الرفع"}</div></div>
          </div>
          {(running || stats.done + stats.fail > 0) && (
            <div className="space-y-1">
              <Progress value={total ? (doneCount / total) * 100 : 0} />
              <div className="text-xs text-muted-foreground">اترفع {stats.done} · فشل {stats.fail} · فاضل {stats.wait}</div>
            </div>
          )}
          <div className="card-elevated overflow-x-auto">
            <PermTable className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr className="text-xs"><th className="px-3 py-2 text-right">الصورة</th><th className="px-3 py-2">الحجم</th><th className="px-3 py-2 text-right">المنتج</th><th className="px-3 py-2">الحالة</th></tr>
              </thead>
              <tbody>
                {items.slice(0, 1000).map((it) => (
                  <tr key={it.name} className="border-t border-border/60">
                    <td className="px-3 py-1.5 font-mono text-xs" dir="ltr">{it.name}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-xs">{kb(it.size)}{it.after ? ` ← ${kb(it.after)}` : ""}</td>
                    <td className="px-3 py-1.5 text-xs">{it.target ? `${it.target.products[0]?.name ?? ""}${it.target.products.length > 1 ? ` (+${it.target.products.length - 1} فرع)` : ""}${it.target.kind === "sku" ? " — بالكود" : ""}` : <span className="text-muted-foreground">ملهاش منتج</span>}</td>
                    <td className="px-3 py-1.5 text-center text-xs">
                      {it.status === "done" ? <CheckCircle2 className="w-4 h-4 text-success inline" aria-label="اترفعت" />
                        : it.status === "fail" ? <span className="text-destructive"><XCircle className="w-4 h-4 inline ml-1" />{it.error}</span>
                        : it.status === "skip" ? <span className="text-muted-foreground">{it.error ?? "مش هتترفع"}</span>
                        : "مستنية"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </PermTable>
          </div>
          <p className="text-xs text-muted-foreground flex gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> الصور الأصلية على جهازك مش بتتغير. رفع نفس الصورة تاني بيستبدل القديمة في نفس مكانها.</p>
        </>
      )}
    </div>
  );
}
