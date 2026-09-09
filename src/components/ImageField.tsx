import { useRef, useState } from "react";
import { Loader2, Upload, Trash2, Maximize2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ProductImage } from "@/components/ProductImage";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { uploadImageToBucket, removeStorageFile } from "@/lib/storageImage";
import { PRODUCT_BUCKET } from "@/lib/productImage";

interface Props {
  /** القيمة المخزّنة (مسار داخل الحاوية أو لينك) */
  value: string | null | undefined;
  /** يُستدعى بعد الرفع أو الحذف بالقيمة الجديدة (null عند الحذف) */
  onChange: (value: string | null) => void;
  /** حاوية التخزين */
  bucket?: string;
  /** مجلد فرعي داخل مجلد الشركة (مثلاً branchId) */
  folder?: string;
  /** رفع مخصص (يُستخدم مع حاويات لها مسار خاص مثل بطاقات الموظفين) */
  uploader?: (file: File) => Promise<string>;
  /** حذف مخصص كامل (ملف + تصفير الحقل) — يُستخدم عند الضغط الصريح على أيقونة الحذف */
  remover?: (value: string) => Promise<void>;
  /** حذف الملف القديم فقط من التخزين أثناء الاستبدال (بدون تصفير أي حقل في قاعدة البيانات) */
  fileRemover?: (value: string) => Promise<void>;
  /** تأجيل الحذف الفعلي لحين حفظ النموذج الأب */
  deferDelete?: boolean;
  /** يُبلّغ الأب بالمسارات المرشحة للحذف بعد الحفظ (يعمل مع deferDelete) */
  onPendingDelete?: (paths: string[]) => void;
  label?: string;
  hint?: string;
  /** حجم إطار المعاينة */
  size?: "sm" | "md" | "lg";
  /** تعطيل التعديل يدوياً (بجانب فحص الصلاحيات) */
  disabled?: boolean;
  /** فرض وضع العرض فقط */
  readOnly?: boolean;
  className?: string;
}


const SIZES = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-32 h-32",
};

/**
 * مكوّن موحّد للصور: معاينة + تكبير (Lightbox) + استبدال + حذف مزدوج
 * (حذف الملف من التخزين وتصفير القيمة في النموذج/الجدول).
 */
export function ImageField({
  value, onChange, bucket = PRODUCT_BUCKET, folder = "shared", uploader, remover, fileRemover,
  deferDelete = false, onPendingDelete,
  label = "الصورة", hint, size = "md", disabled = false, readOnly = false, className = "",
}: Props) {
  const { isAdmin, hasRole } = useAuth() as any;
  const canManage =
    !readOnly && !disabled &&
    (isAdmin || hasRole?.("branch_manager") || hasRole?.("warehouse") || hasRole?.("owner"));

  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** حذف الملف القديم: مؤجل للأب، أو تنظيف فوري للملف فقط (بدون تصفير أي حقل). */
  const disposeOld = async (target: string) => {
    if (deferDelete) { onPendingDelete?.([target]); return; }
    if (fileRemover) { await fileRemover(target); return; }
    await removeStorageFile(bucket, target);
  };

  const doUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("اختر ملف صورة صالح");
    setBusy(true);
    const previous = value;
    try {
      const path = uploader ? await uploader(file) : await uploadImageToBucket(bucket, file, folder);
      onChange(path);
      toast.success(previous ? "تم استبدال الصورة" : "تم رفع الصورة");
      // تنظيف الملف القديم فقط — من غير أي مساس بقيمة الحقل الجديدة
      if (previous && previous !== path) {
        try { await disposeOld(previous); } catch { /* ignore */ }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "فشل رفع الصورة");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doDelete = async () => {
    setConfirmDel(false);
    if (!value) return;
    const target = value;
    setBusy(true);
    onChange(null); // اختفاء فوري من الواجهة
    try {
      if (deferDelete) {
        onPendingDelete?.([target]);
        toast.success("هيتم حذف الصورة عند حفظ التعديلات");
      } else {
        remover ? await remover(target) : await removeStorageFile(bucket, target);
        toast.success("تم حذف الصورة نهائياً");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر حذف الملف من التخزين");
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className={`space-y-1.5 ${className}`} dir="rtl">
      {label && <div className="text-xs font-semibold">{label}</div>}

      <input
        ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); }}
      />

      {value ? (
        <div className="flex items-start gap-3 flex-wrap">
          <div className={`relative group ${SIZES[size]} shrink-0`}>
            <button
              type="button"
              onClick={() => setZoom(true)}
              className={`${SIZES[size]} rounded-lg overflow-hidden border bg-muted/30 block`}
              title="تكبير الصورة"
            >
              <ProductImage
                src={value}
                bucket={bucket}
                alt={label}
                className="w-full h-full object-cover"
                fallback={
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <ImageOff className="w-4 h-4" />
                  </div>
                }
              />
            </button>
            <span className="absolute bottom-1 left-1 bg-background/80 rounded p-0.5 opacity-0 group-hover:opacity-100 transition">
              <Maximize2 className="w-3 h-3" />
            </span>
            {busy && (
              <span className="absolute inset-0 bg-background/60 flex items-center justify-center rounded-lg">
                <Loader2 className="w-4 h-4 animate-spin" />
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5"
              onClick={() => setZoom(true)}>
              <Maximize2 className="w-3.5 h-3.5" /> معاينة
            </Button>
            {canManage && (
              <>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5"
                  disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  استبدال الصورة
                </Button>
                <Button type="button" variant="ghost" size="sm"
                  className="h-8 gap-1.5 text-destructive hover:bg-destructive/10"
                  disabled={busy} onClick={() => setConfirmDel(true)}>
                  <Trash2 className="w-3.5 h-3.5" /> حذف الصورة
                </Button>
              </>
            )}
          </div>
        </div>
      ) : canManage ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) doUpload(f);
          }}
          disabled={busy}
          className={`w-full rounded-lg border border-dashed py-5 px-3 text-center text-xs transition
            ${dragOver ? "bg-primary/5 border-primary" : "bg-muted/30 hover:bg-muted/50"}`}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> جاري الرفع...
            </span>
          ) : (
            <span className="inline-flex flex-col items-center gap-1 text-muted-foreground">
              <Upload className="w-5 h-5" />
              اسحب الصورة هنا أو اضغط للرفع
            </span>
          )}
        </button>
      ) : (
        <div className={`${SIZES[size]} rounded-lg border border-dashed bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground`}>
          لا توجد صورة
        </div>
      )}

      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}

      <ImagePreviewModal open={zoom} onOpenChange={setZoom} src={value} bucket={bucket} title={label} alt={label} />

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الصورة</AlertDialogTitle>
            <AlertDialogDescription>هل تريد حذف الصورة نهائياً؟ سيتم مسح الملف من التخزين ولا يمكن التراجع.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      
      </AlertDialog>
    </div>
  );
}

export default ImageField;
