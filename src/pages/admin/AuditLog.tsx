import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { FileSpreadsheet, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { confirmAlert } from "@/components/ConfirmDialog";
import { cairoTodayDay } from "@/lib/cairoDate";

export default function AuditLog({ embedded }: { embedded?: boolean } = {}) {
  const { tenant, profile, isAdmin } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);

  const PAGE = 50;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const load = () => {
    setLoading(true);
    const start = (page - 1) * PAGE;
    supabase.from("audit_log").select("*, branches(name)", { count: "exact" }).order("created_at", { ascending: false }).order("id").range(start, start + PAGE - 1).then(({ data, count }) => {
      setRows(data ?? []); setTotal(count ?? 0); setLoading(false);
    });
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page]);
  useRealtimeRefresh(["audit_log"], () => load());

  const exportExcel = async () => {
    const t = toast.loading("جاري تجهيز السجل كامل...");
    let all: any[];
    try {
      all = await fetchAllRows<any>(() =>
        supabase.from("audit_log").select("created_at, user_name, action, entity, entity_id, details, branches(name)")
          .order("created_at", { ascending: false }).order("id"));
    } catch (e: any) { toast.dismiss(t); return toast.error(e.message); }
    toast.dismiss(t);
    const data = all.map((r) => ({
      "التاريخ": formatDateTime(r.created_at),
      "المستخدم": r.user_name,
      "الفرع": r.branches?.name ?? "—",
      "العملية": r.action,
      "النوع": r.entity,
      "المعرف": r.entity_id ?? "",
      "التفاصيل": r.details ? JSON.stringify(r.details) : "",
    }));
    const meta = [
      ["الشركة", tenant?.name ?? ""], ["تاريخ التصدير", new Date().toLocaleString("ar-EG")],
      ["صدّره", profile?.name ?? ""], ["عدد العمليات", String(data.length)], [],
    ];
    const ws = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.sheet_add_json(ws, data, { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل العمليات");
    XLSX.writeFile(wb, `audit-log-${cairoTodayDay()}.xlsx`);
    toast.success(`تم تصدير ${data.length} عملية`);
  };

  const deleteRow = async (id: string) => {
    if (!(await confirmAlert({ title: "هل أنت متأكد من حذف هذه الحركة نهائياً؟", description: "الخطوة دي مش هتترجع تاني — متأكد؟", confirmLabel: "أيوه، امسح", cancelLabel: "لأ، سيبها", tone: "danger" }))) return;
    const { error } = await supabase.from("audit_log").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success("تم الحذف");
  };

  const deleteAll = async () => {
    if (confirmWord.trim() !== "تأكيد") return toast.error("اكتب كلمة (تأكيد) للمتابعة");
    setBusy(true);
    const { error } = await supabase.from("audit_log").delete().not("id", "is", null);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم مسح كل سجل العمليات");
    setConfirmAll(false); setConfirmWord("");
    load();
  };

  const actionColor: Record<string, string> = {
    CREATE: "bg-success/15 text-success",
    UPDATE: "bg-primary/15 text-primary",
    DELETE: "bg-destructive/15 text-destructive",
    CANCEL: "bg-warning/15 text-warning",
  };

  const columns: any[] = [
    { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
    { key: "user_name", header: "المستخدم", render: (r: any) => <span className="font-semibold">{r.user_name}</span> },
    { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
    { key: "action", header: "العملية", render: (r: any) => (
      <span className={`px-2 py-1 rounded text-xs font-bold ${actionColor[r.action] ?? "bg-muted"}`}>{r.action}</span>
    )},
    { key: "entity", header: "النوع" },
    { key: "entity_id", header: "المعرف", render: (r: any) => <span className="font-mono text-xs text-muted-foreground">{String(r.entity_id ?? "").slice(0, 8)}</span> },
  ];
  if (isAdmin) {
    columns.push({
      key: "del", header: "حذف", render: (r: any) => (
        <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => deleteRow(r.id)}>
          <Trash2 className="w-4 h-4" />
        </Button>
      )
    });
  }

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="سجل العمليات"
        subtitle={`${total} عملية مسجلة`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
            {isAdmin && (
              <Button variant="destructive" onClick={() => { setConfirmWord(""); setConfirmAll(true); }}>
                <Trash2 className="w-4 h-4 ml-1" /> حذف الكل
              </Button>
            )}
          </div>
        }
      />
      <DataTable loading={loading} rows={rows} columns={columns} />
      <div className="flex items-center justify-center gap-2 mt-3 text-sm">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>السابق</Button>
        <span className="text-muted-foreground">صفحة {page} من {Math.max(1, Math.ceil(total / PAGE))}</span>
        <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / PAGE) || loading} onClick={() => setPage((p) => p + 1)}>التالي</Button>
      </div>

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> حذف كل سجل العمليات
            </AlertDialogTitle>
            <AlertDialogDescription>
              هتمسح <b>كل</b> سجلات العمليات للشركة. الإجراء نهائي ولا يمكن التراجع عنه.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>اكتب كلمة <b>تأكيد</b> للمتابعة</Label>
            <Input value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} placeholder="تأكيد" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={busy || confirmWord.trim() !== "تأكيد"}
              onClick={(e) => { e.preventDefault(); deleteAll(); }}
            >
              نفّذ المسح
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConditionalLayout>
  );
}
