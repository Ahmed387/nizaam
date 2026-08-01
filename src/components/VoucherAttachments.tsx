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
import { tenantStoragePath } from "@/lib/attachmentPath";
import { Eye, Trash2, Paperclip, Loader2, FileText, Image as ImageIcon, Upload } from "lucide-react";

interface Attachment {
  id: string;
  voucher_id: string;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

const BUCKET = "voucher-attachments";
const MAX_SIZE = 5 * 1024 * 1024;

export function VoucherAttachments({ voucherId, canEdit = true }: { voucherId: string; canEdit?: boolean }) {
  const { user, isAdmin, hasRole } = useAuth();
  const [rows, setRows] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [delTarget, setDelTarget] = useState<Attachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canDelete = (a: Attachment) =>
    canEdit && (a.uploaded_by === user?.id || isAdmin || hasRole("branch_manager") || hasRole("accountant"));

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("voucher_attachments" as any)
      .select("*")
      .eq("voucher_id", voucherId)
      .order("uploaded_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!voucherId) return;
    load();
    const ch = supabase
      .channel(`voucher-att-${voucherId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voucher_attachments", filter: `voucher_id=eq.${voucherId}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherId]);

  const upload = async (file: File) => {
    if (file.size > MAX_SIZE) return toast.error("الحد الأقصى للملف 5 ميجابايت");
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const path = await tenantStoragePath(`vouchers/${voucherId}/${Date.now()}_${safeName}`);
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("voucher_attachments" as any).insert({
        voucher_id: voucherId,
        file_path: path,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        uploaded_by: user?.id,
      });
      if (insErr) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw insErr;
      }
      toast.success("تم رفع المرفق");
      load();
    } catch (e: any) {
      toast.error(e.message ?? "فشل الرفع");
    } finally {
      setUploading(false);
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
        .from("voucher_attachments" as any)
        .delete()
        .eq("id", a.id);
      if (error) throw error;
      toast.success("تم حذف المرفق");
      load();
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحذف");
    }
  };

  return (
    <div className="space-y-2" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Paperclip className="w-7 h-7" /> المرفقات{" "}
          {rows.length > 0 && <span className="text-muted-foreground">({rows.length})</span>}
        </div>
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="gap-1"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              إضافة مرفق
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground text-center py-3">جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-3 bg-surface-2 rounded border border-dashed border-border">
          لا توجد مرفقات
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((a) => {
            const isImg = (a.file_type ?? "").startsWith("image/");
            return (
              <div key={a.id} className="flex items-center gap-2 p-2 rounded border border-border bg-surface-2 text-sm">
                <div className="shrink-0 w-8 h-8 rounded bg-background flex items-center justify-center">
                  {isImg ? (
                    <ImageIcon className="w-4 h-4 text-primary" />
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{a.file_name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {a.file_size ? `${Math.round(a.file_size / 1024)} KB` : ""} ·{" "}
                    {new Date(a.uploaded_at).toLocaleString("ar-EG")}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => view(a)} title="عرض">
                  <Eye className="w-4 h-4" />
                </Button>
                {canDelete(a) && (
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
