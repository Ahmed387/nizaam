import { supabase } from "@/integrations/supabase/client";
import { tenantStoragePath } from "@/lib/attachmentPath";
import { compressImage } from "@/lib/compressImage";
import type { RecordType } from "@/hooks/useAttachmentCounts";

export const ATTACHMENT_BUCKET = "record-attachments";
export const ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024; // 5MB hard cap AFTER compression

export function isSupportedAttachment(file: File) {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

/**
 * Compresses (images) and uploads one file to the tenant's folder, then records it in `attachments`.
 * Shared by RecordAttachments (document / voucher screens) and the payment-proof uploads of the payment forms.
 */
export async function uploadRecordAttachment(
  recordType: RecordType, recordId: string, file: File, userId: string | null | undefined,
  onPhase?: (p: "compress" | "upload") => void,
) {
  if (!isSupportedAttachment(file)) throw new Error("نوع الملف غير مدعوم — اختر صورة أو PDF");
  const originalSize = file.size;
  let working = file;
  if (file.type.startsWith("image/")) {
    onPhase?.("compress");
    working = await compressImage(file, { maxDim: 1920, quality: 0.8 });
  }
  if (working.size > ATTACHMENT_MAX_SIZE) throw new Error("حجم الملف كبير جداً حتى بعد الضغط — جرب صورة أصغر");
  onPhase?.("upload");
  const safe = working.name.replace(/[^\w.\-]/g, "_");
  const path = await tenantStoragePath(`${recordType}/${recordId}/${Date.now()}_${safe}`);
  const { error: upErr } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, working, { contentType: working.type });
  if (upErr) throw upErr;
  const { error: insErr } = await supabase.from("attachments" as any).insert({
    record_type: recordType,
    record_id: recordId,
    file_path: path,
    file_name: file.name,
    file_type: working.type,
    file_size: working.size,
    original_size: originalSize,
    uploaded_by: userId ?? null,
  });
  if (insErr) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
    throw insErr;
  }
}
