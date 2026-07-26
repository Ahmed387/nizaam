import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Eye, Trash2, Paperclip, Loader2, FileText, Image as ImageIcon, Upload } from "lucide-react";
import { compressImage } from "@/lib/compressImage";
import type { RecordType } from "@/hooks/useAttachmentCounts";

interface Attachment {
  id: string;
  record_type: string;
  record_id: string;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  original_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

const BUCKET = "record-attachments";
const MAX_SIZE = 5 * 1024 * 1024; // 5MB hard cap AFTER compression
const ACCEPT =
  "image/jpeg,image/png,image/webp,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.xls,.xlsx,.csv";

interface Props {
  recordType: RecordType;
  recordId: string;
  canEdit?: boolean;
}

export function RecordAttachments({ recordType, recordId, canEdit = true }: Props) {
  const { user, isAdmin, hasRole, can } = useAuth() as any;
  const [rows, setRows] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<null | "compress" | "upload">(null);
  const [delTarget, setDelTarget] = useState<Attachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canView = isAdmin || can?.("attachments.view");
  const canCreate = canEdit && (isAdmin || can?.("attachments.create"));
  const canDelete = isAdmin || can?.("attachments.delete");
  const canDeleteRow = (a: Attachment) =>
    canEdit &&
    canDelete &&
    (a.uploaded_by === user?.id || isAdmin || hasRole("branch_manager") || hasRole("accountant"));

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("attachments" as any)
      .select("*")
      .eq("record_type", recordType)
      .eq("record_id", recordId)
      .order("uploaded_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!recordId) return;
    load();
    const ch = supabase
      .channel(`att-${recordType}-${recordId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attachments", filter: `record_id=eq.${recordId}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordType, recordId]);

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      return toast.error("نوع الملف غير مدعوم — اختر صورة أو PDF");
    }
    const originalSize = file.size;
    let working = file;
    try {
      if (file.type.startsWith("image/")) {
        setPhase("compress");
        toast.message("جاري ضغط الصورة...");
        working = await compressImage(file, { maxDim: 1920, quality: 0.8 });
      }
      if (working.size > MAX_SIZE) {
        toast.error("حجم الملف كبير جداً حتى بعد الضغط — جرب صورة أصغر");
        return;
      }
      setPhase("upload");
      const safe = working.name.replace(/[^\w.\-]/g, "_");
      const path = `${recordType}/${recordId}/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, working, { contentType: working.type });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("attachments" as any).insert({
        record_type: recordType,
        record_id: recordId,
        file_path: path,
        file_name: file.name,
        file_type: working.type,
        file_size: working.size,
        original_size: originalSize,
        uploaded_by: user?.id,
      });
      if (insErr) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw insErr;
      }
      toast.success("تم رفع المرفق");
    } catch (e: any) {
      toast.error(e.message ?? "فشل الرفع");
    } finally {
      setPhase(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const view = async (a: Attachment) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.file_path, 60 * 10);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    const a = delTarget;
    setDelTarget(null);
    try {
      await supabase.storage.from(BUCKET).remove([a.file_path]);
      const { error } = await supabase
        .from("attachments" as any)
        .delete()
        .eq("id", a.id);
      if (error) throw error;
      toast.success("تم حذف المرفق");
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحذف");
    }
  };

  return (
    <div className="space-y-2" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Paperclip className="w-8 h-8" /> المرفقات
          {rows.length > 0 && <span className="text-muted-foreground">({rows.length})</span>}
        </div>
        {canCreate && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={phase !== null}
              onClick={() => fileRef.current?.click()}
              className="gap-1"
            >
              {phase ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {phase === "compress" ? "جاري الضغط..." : phase === "upload" ? "جاري الرفع..." : "إضافة مرفق"}
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground text-center py-3">جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <button
          type="button"
          onClick={() => canCreate && fileRef.current?.click()}
          className="w-full text-xs text-muted-foreground text-center py-3 bg-surface-2 rounded border border-dashed border-border hover:bg-surface-3"
        >
          {canCreate ? "لا توجد مرفقات — اضغط لإضافة مرفق" : "لا توجد مرفقات"}
        </button>
      ) : (
        <div className="space-y-1.5">
          {rows.map((a) => {
            const isImg = (a.file_type ?? "").startsWith("image/");
            return (
              <div key={a.id} className="flex items-center gap-2 p-2 rounded border border-border bg-surface-2 text-sm overflow-hidden">
                <div className="shrink-0 w-8 h-8 rounded bg-background flex items-center justify-center">
                  {isImg ? (
                    <ImageIcon className="w-4 h-4 text-primary" />
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="truncate font-medium text-xs" title={a.file_name}>{a.file_name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {a.file_size ? `${Math.round(a.file_size / 1024)} KB` : ""} ·{" "}
                    {new Date(a.uploaded_at).toLocaleString("ar-EG")}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => view(a)} title="عرض">
                  <Eye className="w-4 h-4" />
                </Button>
                {canDeleteRow(a) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => setDelTarget(a)}
                    title="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المرفق</AlertDialogTitle>
            <AlertDialogDescription>هل تريد حذف هذا المرفق؟ لا يمكن التراجع.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
