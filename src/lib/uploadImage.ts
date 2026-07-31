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

/** يجيب tenant_id للمستخدم الحالي (مطلوب لمسار الرفع الآمن). */
export async function currentTenantId(): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("غير مسجّل الدخول");
  const { data, error } = await supabase.from("profiles").select("tenant_id").eq("id", auth.user.id).maybeSingle();
  if (error) throw error;
  if (!data?.tenant_id) throw new Error("مفيش شركة مرتبطة بالمستخدم");
  return data.tenant_id as string;
}

/**
 * يرفع صورة منتج لـ bucket خاص: product-images ويعيد المسار المخزّن.
 * العرض بيتم عن طريق Signed URL مؤقت (شوف src/lib/productImage.ts).
 * @param file ملف الصورة
 * @param folder مجلد فرعي داخل مجلد الشركة (مثلاً branchId أو "price-list")
 */
export async function uploadProductImage(file: File, folder: string): Promise<string> {
  const blob = await compressImage(file);
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const tenantId = await currentTenantId();
  const sub = (folder || "shared").replace(/^\/+|\/+$/g, "") || "shared";
  const path = `${tenantId}/${sub}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, blob, { upsert: false, contentType: blob.type });
  if (error) throw error;
  return path;
}

