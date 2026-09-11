import { edgeErrorMessage } from "@/lib/edgeError";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Download, Loader2, DatabaseBackup, PlayCircle, CheckCircle2, XCircle,
  Trash2, CloudUpload, RotateCcw, ShieldAlert, FileSearch,
} from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const CONFIRM_PHRASE = "أوافق على استبدال كافة البيانات الحالية بالنسخة الاحتياطية";

export function BackupTab() {
  const { isOwner, isSuperAdmin } = useAuth();
  const allowed = isOwner || isSuperAdmin;

  const [runningServer, setRunningServer] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Google Drive settings
  const [settings, setSettings] = useState<any>(null);
  const [savingDrive, setSavingDrive] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Restore
  const [restoreRow, setRestoreRow] = useState<any>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<any>(null);

  const loadHistory = async () => {
    const { data } = await supabase
      .from("system_backups" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory(data ?? []);
  };

  const loadSettings = async () => {
    const { data } = await supabase.from("backup_settings" as any).select("*").maybeSingle();
    setSettings(data ?? null);
  };

  useEffect(() => {
    if (!allowed) return;
    loadHistory();
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);
  useRealtimeRefresh(["system_backups"], loadHistory);

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground flex flex-col items-center gap-2">
          <ShieldAlert className="h-8 w-8" />
          <p>النسخ الاحتياطي والاستعادة مقصوران على المالك فقط.</p>
        </CardContent>
      </Card>
    );
  }

  const runBackupNow = async () => {
    setRunningServer(true);
    try {
      const { data, error } = await supabase.functions.invoke("scheduled-backup", { body: {} });
      const bErr = await edgeErrorMessage(error);
      if (bErr) throw new Error(bErr);
      const first = (data as any)?.results?.[0];
      toast.success(
        first
          ? `تمت النسخة: ${first.tables} جدول • ${Number(first.rows ?? 0).toLocaleString("en-US")} سجل${first.drive?.synced ? " • تمت مزامنة Google Drive" : ""}`
          : "تم تشغيل النسخ الاحتياطي",
      );
      if (first?.drive?.error) toast.warning(first.drive.error);
      loadHistory();
      loadSettings();
    } catch (e: any) {
      toast.error(e.message ?? "فشل التشغيل");
    } finally {
      setRunningServer(false);
    }
  };

  const downloadBackup = async (row: any) => {
    if (!row.storage_path) return toast.error("لا يوجد ملف");
    const { data, error } = await supabase.storage.from("system-backups").createSignedUrl(row.storage_path, 300);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const deleteBackup = async (row: any) => {
    setDeletingId(row.id);
    try {
      if (row.storage_path) {
        const { error: sErr } = await supabase.storage.from("system-backups").remove([row.storage_path]);
        if (sErr) console.warn("storage delete:", sErr.message);
      }
      const { error } = await supabase.from("system_backups" as any).delete().eq("id", row.id);
      if (error) throw error;
      toast.success("تم حذف النسخة");
      setHistory((h) => h.filter((x) => x.id !== row.id));
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحذف");
    } finally {
      setDeletingId(null);
    }
  };

  const saveDrive = async (connected: boolean) => {
    setSavingDrive(true);
    try {
      const { data: prof } = await supabase.auth.getUser();
      const uid = prof.user?.id;
      if (!uid) throw new Error("يجب تسجيل الدخول");
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", uid).maybeSingle();
      const tenantId = (profile as any)?.tenant_id;
      if (!tenantId) throw new Error("تعذر تحديد الشركة");

      const { error } = await supabase.from("backup_settings" as any).upsert(
        {
          tenant_id: tenantId,
          drive_connected: connected,
          last_error: null,
        } as any,
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
      toast.success(connected ? "تم تفعيل المزامنة مع Google Drive" : "تم إيقاف المزامنة");
      loadSettings();
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحفظ");
    } finally {
      setSavingDrive(false);
    }
  };

  const ensureDriveFolder = async () => {
    setCreatingFolder(true);
    try {
      const { data, error } = await supabase.functions.invoke("scheduled-backup", {
        body: { ensure_folder_only: true },
      });
      const bErr = await edgeErrorMessage(error);
      if (bErr) throw new Error(bErr);
      const first = (data as any)?.folders?.[0];
      if (!first || first.error) throw new Error(first?.error || "فشل إنشاء المجلد");
      toast.success(`تم إنشاء مجلد Google Drive: ${first.folder_name}`);
      loadSettings();
    } catch (e: any) {
      toast.error(e.message ?? "فشل إنشاء المجلد");
    } finally {
      setCreatingFolder(false);
    }
  };

  const inspectBackup = async (row: any) => {
    setInspecting(row.id);
    setInspectResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("restore-system-backup", {
        body: { backup_id: row.id, dry_run: true },
      });
      const bErr = await edgeErrorMessage(error);
      if (bErr) throw new Error(bErr);
      setInspectResult(data);
      toast.success("تم فحص محتوى الأرشيف");
    } catch (e: any) {
      toast.error(e.message ?? "فشل الفحص");
    } finally {
      setInspecting(null);
    }
  };

  const runRestore = async () => {
    if (confirmText.trim() !== CONFIRM_PHRASE) return toast.error("نص التأكيد غير مطابق");
    setRestoring(true);
    try {
      const { data, error } = await supabase.functions.invoke("restore-system-backup", {
        body: { backup_id: restoreRow.id, confirm: CONFIRM_PHRASE },
      });
      const bErr = await edgeErrorMessage(error);
      if (bErr) throw new Error(bErr);
      toast.success("تمت استعادة النسخة بالكامل");
      setInspectResult(data);
      setRestoreRow(null);
      setConfirmText("");
    } catch (e: any) {
      toast.error(e.message ?? "فشلت الاستعادة — لم يتم تغيير أي بيانات");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* ---------------- تشغيل النسخ ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="h-5 w-5 text-primary" />
            النسخة الاحتياطية الشاملة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            تُبنى النسخة بالكامل على السيرفر وتشمل كل جداول الشركة (بما فيها الأرشيف التاريخي وسجلات المالك)
            بالإضافة إلى ملفات الصور والمرفقات، داخل أرشيف مضغوط واحد. لا يتم تحميل أي بيانات على جهازك أثناء التجهيز.
          </p>
          <Button onClick={runBackupNow} disabled={runningServer} className="gap-2">
            {runningServer ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            تشغيل نسخة احتياطية الآن
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- Google Drive ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudUpload className="h-5 w-5 text-primary" />
            المزامنة مع Google Drive
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            يتم رفع نفس الملف <span className="font-mono">A&N.tar</span> داخل مجلد منفصل
            لكل شركة على Drive، وتحديثه في مكانه في كل مرة، بدل إنشاء ملفات مكرّرة تستهلك مساحة الحساب.
          </p>

          {settings?.drive_folder_id ? (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <div className="font-medium">المجلد المرتبط بالشركة:</div>
              <div>{settings.drive_folder_name || "Nizam_Backup_..."}</div>
              <div className="text-xs text-muted-foreground font-mono break-all">ID: {settings.drive_folder_id}</div>
            </div>
          ) : (
            <Button onClick={ensureDriveFolder} disabled={creatingFolder} className="gap-2">
              {creatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
              إنشاء وتنشيط مجلد Google Drive تلقائياً للشركة
            </Button>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={!!settings?.drive_connected}
                disabled={savingDrive || creatingFolder}
                onCheckedChange={(v) => saveDrive(v)}
              />
              <span className="text-sm">تفعيل المزامنة التلقائية</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => saveDrive(!!settings?.drive_connected)} disabled={savingDrive || creatingFolder}>
              {savingDrive ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ الإعدادات"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            {settings?.last_synced_at && <div>آخر مزامنة: {formatDateTime(settings.last_synced_at)}</div>}
            {settings?.drive_file_id && <div>معرّف الملف على Drive: <span className="font-mono">{settings.drive_file_id}</span></div>}
            {settings?.last_error && <div className="text-destructive">آخر خطأ: {settings.last_error}</div>}
          </div>
        </CardContent>
      </Card>

      {/* ---------------- السجل ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">سجل النسخ الاحتياطية</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 && <p className="text-sm text-muted-foreground">لا توجد نسخ بعد.</p>}
          {history.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2 min-w-0">
                {row.status === "success"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{row.filename}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(row.created_at)}
                    {row.size_bytes ? ` • ${(row.size_bytes / (1024 * 1024)).toFixed(1)} MB` : ""}
                    {row.table_counts ? ` • ${Object.keys(row.table_counts).length} جدول` : ""}
                  </div>
                  {row.error && <div className="text-xs text-destructive">{row.error}</div>}
                </div>
              </div>
              <TooltipProvider delayDuration={200}>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => inspectBackup(row)} disabled={inspecting === row.id || row.status !== "success"}>
                        {inspecting === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">فحص محتوى الأرشيف وعدد السجلات بدون تغيير أي بيانات</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => downloadBackup(row)} disabled={!row.storage_path}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">تنزيل ملف النسخة الاحتياطية المضغوط</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost" size="sm"
                        className="text-amber-600"
                        onClick={() => { setRestoreRow(row); setConfirmText(""); }}
                        disabled={row.status !== "success"}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">استعادة كامل البيانات من هذه النسخة (يتطلب تأكيد نصي)</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-destructive" disabled={deletingId === row.id}>
                            {deletingId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent dir="rtl">
                          <AlertDialogHeader>
                            <AlertDialogTitle>حذف النسخة الاحتياطية؟</AlertDialogTitle>
                            <AlertDialogDescription>سيتم حذف الملف نهائياً ولا يمكن التراجع.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>إلغاء</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteBackup(row)}>حذف</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TooltipTrigger>
                    <TooltipContent side="top">حذف النسخة الاحتياطية من التخزين والسجل نهائياً</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ---------------- نتيجة الفحص / الاستعادة ---------------- */}
      {inspectResult && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">نتيجة الفحص</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {"total_rows" in inspectResult && (
              <div>إجمالي السجلات داخل الأرشيف: {Number(inspectResult.total_rows).toLocaleString("en-US")}</div>
            )}
            {"tables" in inspectResult && <div>عدد الجداول: {inspectResult.tables}</div>}
            {"media_files" in inspectResult && <div>ملفات الوسائط: {inspectResult.media_files}</div>}
            {inspectResult.verification && (
              <div className="pt-2">
                {Object.entries(inspectResult.verification).map(([k, v]) => (
                  <div key={k}>{k}: {String(v)}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------- نافذة الاستعادة ---------------- */}
      <Dialog open={!!restoreRow} onOpenChange={(o) => { if (!o) { setRestoreRow(null); setConfirmText(""); } }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" /> استعادة النظام من نسخة احتياطية
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              سيتم استبدال كل بيانات الشركة الحالية بمحتوى الملف <span className="font-medium">{restoreRow?.filename}</span>.
              تتم العملية داخل معاملة واحدة: إما تنجح بالكامل أو يتم التراجع عنها بالكامل دون فقدان أي بيانات.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>اكتب النص التالي للتأكيد:</Label>
            <div className="rounded bg-muted p-2 text-sm">{CONFIRM_PHRASE}</div>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="اكتب نص التأكيد هنا" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRestoreRow(null)} disabled={restoring}>إلغاء</Button>
            <Button
              variant="destructive"
              onClick={runRestore}
              disabled={restoring || confirmText.trim() !== CONFIRM_PHRASE}
            >
              {restoring ? <Loader2 className="h-4 w-4 animate-spin ms-2" /> : null}
              تنفيذ الاستعادة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
