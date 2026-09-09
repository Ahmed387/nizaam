import { supabase } from "@/integrations/supabase/client";
import { uploadImageToBucket } from "@/lib/storageImage";

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
  // منطق الضغط والرفع مركزي في storageImage.ts (WebP 800px / 0.8)
  return uploadImageToBucket("product-images", file, folder);
}

