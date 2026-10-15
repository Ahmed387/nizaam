import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Eye, Paperclip, Trash2, FileText, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { isSupportedAttachment } from "@/lib/attachmentUpload";

/**
 * «إيصال التحويل» — optional transfer receipt(s) for a non-cash payment. Files stay in the form until the payment
 * is saved, then attachPaymentProofs() stores them on that payment's voucher.
 */
export function PaymentProofInput({ files, onChange, disabled, compact }: {
  files?: File[] | null;
  onChange: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const list = useMemo(() => (Array.isArray(files) ? files.filter((f) => f instanceof File) : []), [files]);
  const urls = useMemo(() => list.map((f) => URL.createObjectURL(f)), [list]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const add = (picked: FileList | null) => {
    if (!picked) return;
    const ok: File[] = [];
    Array.from(picked).forEach((f) => {
      if (!isSupportedAttachment(f)) toast.error(`${f.name}: اختر صورة أو PDF`);
      else ok.push(f);
    });
    if (ok.length) onChange([...list, ...ok]);
    if (ref.current) ref.current.value = "";
  };

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium flex items-center gap-1">
          <Paperclip className="w-3.5 h-3.5" /> إيصال التحويل <span className="text-muted-foreground">(اختياري)</span>
        </span>
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden"
               onChange={(e) => add(e.target.files)} />
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={disabled}
                onClick={() => ref.current?.click()}>
          <Paperclip className="w-3.5 h-3.5" /> {list.length ? "إضافة ملف" : "ارفع صورة / PDF"}
        </Button>
      </div>
      {list.length > 0 && (
        <div className="space-y-1">
          {list.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs">
              {f.type.startsWith("image/") ? <ImageIcon className="w-3.5 h-3.5 text-primary shrink-0" /> : <FileText className="w-3.5 h-3.5 shrink-0" />}
              <span className="flex-1 truncate" title={f.name}>{f.name}</span>
              <span className="text-muted-foreground">{Math.round(f.size / 1024)} KB</span>
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6" title="عرض"
                      onClick={() => window.open(urls[i], "_blank")}>
                <Eye className="w-3.5 h-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive" title="حذف" disabled={disabled}
                      onClick={() => onChange(list.filter((_, j) => j !== i))}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
