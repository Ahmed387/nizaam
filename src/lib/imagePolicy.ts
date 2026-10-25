/**
 * One image policy for product photos (owner 2026-10-25: «صغيرة جداً عشان ما نهلكش السيرفر»):
 * longest side 800 px, WebP quality 0.75 (JPEG when the browser can't write WebP), and never above 200 KB —
 * the quality steps down, then the size, until it fits. Every product photo goes through here before any upload,
 * whatever its size or format; the bucket itself refuses anything else (migration 0117).
 */
export const PRODUCT_IMAGE = { maxDim: 800, quality: 0.75, maxBytes: 200 * 1024, minQuality: 0.45 } as const;

async function decode(blob: Blob): Promise<{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; w: number; h: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return { w: bmp.width, h: bmp.height, draw: (c, w, h) => c.drawImage(bmp, 0, 0, w, h) };
    } catch { /* fall back to <img> (e.g. SVG) */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img: HTMLImageElement = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("الصورة دي مش بتتفتح")); i.src = url; });
    return { w: img.naturalWidth, h: img.naturalHeight, draw: (c, w, h) => c.drawImage(img, 0, 0, w, h) };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

const encode = (canvas: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), type, q));

/** Shrink a photo to the product policy. Returns a .webp (or .jpg) File named after the original. */
export async function shrinkProductImage(input: Blob, name = "image"): Promise<File> {
  const src = await decode(input);
  if (!src.w || !src.h) throw new Error("الصورة فاضية");
  let dim: number = PRODUCT_IMAGE.maxDim;
  let best: Blob | null = null;
  let type = "image/webp";
  for (let round = 0; round < 3 && !best; round++) {
    const scale = Math.min(1, dim / Math.max(src.w, src.h));
    const w = Math.max(1, Math.round(src.w * scale)), h = Math.max(1, Math.round(src.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("المتصفح مش قادر يصغّر الصورة");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); // transparent PNG → white, not black (JPEG fallback)
    src.draw(ctx, w, h);
    for (let q: number = PRODUCT_IMAGE.quality; q >= PRODUCT_IMAGE.minQuality - 1e-9; q -= 0.1) {
      let b = await encode(canvas, "image/webp", q);
      if (!b || b.type !== "image/webp") { b = await encode(canvas, "image/jpeg", q); type = "image/jpeg"; } else type = "image/webp";
      if (b && b.size <= PRODUCT_IMAGE.maxBytes) { best = b; break; }
    }
    dim = Math.round(dim * 0.75);
  }
  if (!best) throw new Error("الصورة لسه كبيرة بعد التصغير");
  const base = name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "image";
  return new File([best], `${base}.${type === "image/webp" ? "webp" : "jpg"}`, { type: best.type, lastModified: Date.now() });
}
