import { supabase } from "@/integrations/supabase/client";

/**
 * يضغط الصورة قبل الرفع للحفاظ على الجودة وتقليل الحجم.
 * - أقصى عرض/ارتفاع: 1200px
 * - جودة JPEG: 0.85
 */
async function compressImage(file: File, maxDim = 1200, quality = 0.85): Promise<Blob> {
  // SVG/GIF: ارفعهم زي ما هم
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;

  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });

  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    if (width >= height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);

  // PNG لو فيه شفافية (تقريبي)، JPEG غير كده
  const useJpeg = file.type !== "image/png";
  const mime = useJpeg ? "image/jpeg" : "image/png";
  return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), mime, quality));
}

/**
 * يرفع صورة منتج لـ bucket: product-images ويعيد الـ public URL.
 * @param file ملف الصورة
 * @param folder مجلد فرعي داخل البـ bucket (مثلاً branchId أو "price-list")
 */
export async function uploadProductImage(file: File, folder: string): Promise<string> {
  const blob = await compressImage(file);
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, blob, { upsert: false, contentType: blob.type });
  if (error) throw error;
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}
