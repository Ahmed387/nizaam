// Lightweight client-side image compression via canvas.
// Resizes images so the longest side is <= maxDim, re-encodes as JPEG at given quality.
// Returns a new File (or the original if no compression is needed / unsupported type).
export async function compressImage(
  file: File,
  opts: { maxDim?: number; quality?: number; sizeThreshold?: number; mimeType?: string } = {}
): Promise<File> {
  const { maxDim = 1920, quality = 0.8, sizeThreshold = 1024 * 1024, mimeType = "image/jpeg" } = opts;

  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  // Read into image
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("image_load_failed"));
    i.src = dataUrl;
  });

  const longest = Math.max(img.width, img.height);
  // If already in the target format, small and within bounds, skip
  if (file.type === mimeType && file.size <= sizeThreshold && longest <= maxDim) return file;

  const scale = Math.min(1, maxDim / longest);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);

  let blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), mimeType, quality)
  );
  // بعض المتصفحات القديمة لا تدعم WebP -> رجوع تلقائي لـ JPEG
  let outType = mimeType;
  if (!blob || (mimeType !== "image/jpeg" && blob.type !== mimeType)) {
    blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
    outType = "image/jpeg";
  }
  if (!blob) return file;

  const ext = outType === "image/webp" ? "webp" : outType === "image/png" ? "png" : "jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${baseName}.${ext}`, { type: outType, lastModified: Date.now() });
}
