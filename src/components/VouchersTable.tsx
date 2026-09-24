import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "./DataTable";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { VoucherDialog } from "./VoucherDialog";
import { VoucherViewDialog } from "./VoucherViewDialog";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { fetchVoucherCategories, PARTY_TYPE_LABEL, Voucher, VoucherCategory, VoucherType, VOUCHER_TYPE_LABEL } from "@/lib/vouchers";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { formatEGP, formatDate } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, XCircle, Loader2, Trash2, Eye, FileDown, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import { exportToExcel, printReport } from "@/lib/export";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { generateVouchersReport } from "@/utils/generatePDFReport";
import { useBranchScope } from "@/lib/branchScope";

interface Props {
  branchId?: string;
  type?: VoucherType; // undefined => show all
  adminAllBranches?: boolean;
  tenantId?: string;
}

export function VouchersTable({ branchId, type, adminAllBranches, tenantId }: Props) {
  const { isAdmin, hasRole, user, profile } = useAuth();
  const [rows, setRows] = useState<Voucher[]>([]);
  const [cats, setCats] = useState<VoucherCategory[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const { filterBranches } = useBranchScope();
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Voucher | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Voucher | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewTarget, setViewTarget] = useState<Voucher | null>(null);
  const [editTarget, setEditTarget] = useState<Voucher | null>(null);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    category_ids: [] as string[],
    payment_method: "",
    source: "",
    branch_id: "",
    type: "" as "" | VoucherType,
  });

  const canAdd = !!branchId && (isAdmin || hasRole("branch_manager"));

  const load = async () => {
    setLoading(true);
    let q = supabase.from("vouchers" as any).select("*").order("voucher_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
    if (branchId) q = q.eq("branch_id", branchId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (type) q = q.eq("type", type);
    if (filters.type) q = q.eq("type", filters.type);
    if (filters.from) q = q.gte("voucher_date", filters.from);
    if (filters.to) q = q.lte("voucher_date", filters.to);
    if (filters.category_ids.length) q = q.in("category_id", filters.category_ids);
    if (filters.payment_method) q = q.eq("payment_method", filters.payment_method);
    if (filters.source) q = q.eq("source", filters.source);
    if (filters.branch_id) q = q.eq("branch_id", filters.branch_id);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as Voucher[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchVoucherCategories(type).then(setCats).catch(() => {});
    if (adminAllBranches) {
      supabase.from("branches").select("id,name").neq("code", "PARTNER-CASH").order("name").then(({ data }) => setBranches(filterBranches((data ?? [])) as any) as any);
    }
  }, [type, adminAllBranches]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId, type, tenantId, filters]);

  useRealtimeRefresh(["vouchers", "voucher_categories"], () => { load(); });

  const catMap = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.name])), [cats]);
  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const attCounts = useAttachmentCounts("voucher", useMemo(() => rows.map((r) => r.id), [rows]));

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.status === "active");
    const totalIn = active.filter((r) => r.type === "receipt").reduce((s, r) => s + Number(r.amount), 0);
    const totalOut = active.filter((r) => r.type === "payment").reduce((s, r) => s + Number(r.amount), 0);
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [rows]);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) return toast.error("اكتب سبب الإلغاء");
    const { error } = await supabase.rpc("cancel_voucher" as any, {
      p_voucher_id: cancelTarget.id,
      p_reason: cancelReason.trim(),
    });
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء السند");
    setCancelTarget(null);
    setCancelReason("");
    load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.rpc("delete_voucher_admin" as any, {
      p_voucher_id: deleteTarget.id,
      p_reason: "حذف بواسطة المدير",
    });
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("تم حذف السند نهائياً");
    setDeleteTarget(null);
    load();
  };

  const exportRows = rows.map((r) => ({
    "رقم السند": r.voucher_number,
    "النوع": VOUCHER_TYPE_LABEL[r.type],
    "التاريخ": formatDate(r.voucher_date),
    "التصنيف": catMap[r.category_id] ?? "",
    "المبلغ": Number(r.amount),
    "طريقة الدفع": PAYMENT_METHOD_LABELS[r.payment_method],
    "الجهة": r.party_name ?? "",
    "المصدر": r.source === "manual" ? "يدوي" : "تلقائي",
    "الحالة": r.status === "active" ? "نشط" : "ملغي",
    "الوصف": r.description ?? "",
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">إجمالي القبض</div>
          <div className="text-xl font-bold text-success">{formatEGP(summary.totalIn)}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">إجمالي الصرف</div>
          <div className="text-xl font-bold text-destructive">{formatEGP(summary.totalOut)}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">الصافي</div>
          <div className={`text-xl font-bold ${summary.net >= 0 ? "text-success" : "text-destructive"}`}>
            {formatEGP(summary.net)}
          </div>
        </div>
      </div>

      <div className="card-elevated p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">من تاريخ</Label>
            <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="h-9" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
            <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="h-9" />
          </div>
          {!type && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">النوع</Label>
              <Select value={filters.type || "all"} onValueChange={(v) => setFilters({ ...filters, type: v === "all" ? "" : v as any })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="receipt">قبض</SelectItem>
                  <SelectItem value="payment">صرف</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">التصنيف</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-full justify-between font-normal">
                  <span className="truncate">
                    {filters.category_ids.length === 0
                      ? "كل التصنيفات"
                      : filters.category_ids.length === 1
                        ? (catMap[filters.category_ids[0]] ?? "تصنيف")
                        : `${filters.category_ids.length} تصنيفات مختارة`}
                  </span>
                  <ChevronDown className="w-4 h-4 opacity-60 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" side="bottom" sideOffset={6} avoidCollisions={false} className="w-64 p-2">
                <div className="flex items-center justify-between px-2 py-1 mb-1 border-b">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setFilters({ ...filters, category_ids: [] })}
                  >مسح الاختيار</button>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setFilters({ ...filters, category_ids: cats.map(c => c.id) })}
                  >تحديد الكل</button>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-0.5">
                  {cats.map((c) => {
                    const checked = filters.category_ids.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setFilters({
                              ...filters,
                              category_ids: v
                                ? [...filters.category_ids, c.id]
                                : filters.category_ids.filter((id) => id !== c.id),
                            });
                          }}
                        />
                        <span className="flex-1">{c.name}</span>
                        {checked && <Check className="w-3 h-3 text-primary" />}
                      </label>
                    );
                  })}
                  {cats.length === 0 && <div className="text-xs text-muted-foreground p-2">لا يوجد تصنيفات</div>}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">طريقة الدفع</Label>
            <Select value={filters.payment_method || "all"} onValueChange={(v) => setFilters({ ...filters, payment_method: v === "all" ? "" : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">المصدر</Label>
            <Select value={filters.source || "all"} onValueChange={(v) => setFilters({ ...filters, source: v === "all" ? "" : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="manual">يدوي</SelectItem>
                <SelectItem value="system">تلقائي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {adminAllBranches && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">الفرع</Label>
              <Select value={filters.branch_id || "all"} onValueChange={(v) => setFilters({ ...filters, branch_id: v === "all" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفروع</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center justify-end pt-2 border-t">
          <Button size="sm" variant="outline" onClick={() => exportToExcel("vouchers", [{ name: "السندات", rows: exportRows }])}>
            <FileDown className="w-4 h-4 ms-1" /> Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => {
            const branchName = branchId ? (branchMap[branchId] ?? "الفرع") : "كل الفروع";
            generateVouchersReport({
              branchName,
              vouchers: rows,
              categoriesMap: catMap,
              branchesMap: branchMap,
              showBranch: !!adminAllBranches,
              filters: { from: filters.from, to: filters.to, type: (filters.type || type || "") as any },
              userName: profile?.name || user?.email || "مستخدم",
            });
          }}>
            <FileDown className="w-4 h-4 ms-1" /> PDF تفصيلي
          </Button>
          {canAdd && (
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> {type === "receipt" ? "سند قبض جديد" : "سند صرف جديد"}
            </Button>
          )}
        </div>
      </div>


      <DataTable
        loading={loading}
        rows={rows}
        onRowClick={(r: Voucher) => setViewTarget(r)}
        columns={[
          { key: "voucher_number", header: "رقم السند", render: (r: Voucher) => (
            <span className="font-mono">{r.voucher_number}</span>
          ) },
          { key: "voucher_date", header: "التاريخ", render: (r: Voucher) => formatDate(r.voucher_date) },
          ...(!type ? [{ key: "type", header: "النوع", render: (r: Voucher) => (
            <Badge variant={r.type === "receipt" ? "default" : "destructive"}>{VOUCHER_TYPE_LABEL[r.type]}</Badge>
          ) }] : []),
          { key: "category", header: "التصنيف", render: (r: Voucher) => catMap[r.category_id] ?? "—" },
          { key: "amount", header: "المبلغ", render: (r: Voucher) => (
            <span className={`font-bold ${r.type === "receipt" ? "text-success" : "text-destructive"}`}>
              {formatEGP(Number(r.amount))}
            </span>
          ) },
          { key: "payment_method", header: "طريقة الدفع", render: (r: Voucher) => PAYMENT_METHOD_LABELS[r.payment_method] },
          { key: "party", header: "الجهة", render: (r: Voucher) => r.party_name ?? "—" },
          ...(adminAllBranches ? [{ key: "branch", header: "الفرع", render: (r: Voucher) => branchMap[r.branch_id] ?? "—" }] : []),
          { key: "source", header: "المصدر", render: (r: Voucher) => (
            <Badge variant={r.source === "manual" ? "secondary" : "outline"}>
              {r.source === "manual" ? "يدوي" : "تلقائي"}
            </Badge>
          ) },
          { key: "status", header: "الحالة", render: (r: Voucher) => (
            r.status === "active"
              ? <Badge variant="default">نشط</Badge>
              : <Badge variant="destructive">ملغي</Badge>
          ) },
          { key: "actions", header: "الإجراءات", render: (r: Voucher) => {
            const canCancel = r.status === "active" && (isAdmin || (hasRole("branch_manager") && r.source === "manual"));
            return (
              <div className="flex items-center gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" onClick={() => setViewTarget(r)} title="عرض السند والمرفقات">
                  <Eye className="w-4 h-4" />
                </Button>
                <AttachmentsDialogButton recordType="voucher" recordId={r.id} count={attCounts[r.id] ?? 0} />
                {canCancel && (
                  <Button
                    size="sm" variant="ghost" onClick={() => setCancelTarget(r)} className="text-warning"
                    title="إلغاء السند — يفضل ظاهر في السجلات كـ (ملغي) ويعكس أثره المحاسبي. يُستخدم لو السند اتنفذ بالغلط بعد ما أثّر على الرصيد."
                  >
                    <XCircle className="w-4 h-4" />
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    size="sm" variant="ghost" onClick={() => setDeleteTarget(r)} className="text-destructive"
                    title="حذف نهائي — يمسح السند ومرفقاته من قاعدة البيانات بدون رجوع. يُستخدم لو السند مكرر أو اتعمل بالغلط أصلاً."
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            );
          } },
        ]}
      />


      {canAdd && type && (
        <VoucherDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          branchId={branchId!}
          type={type}
          onSuccess={load}
        />
      )}

      {/* Edit dialog - works for any voucher type */}
      {editTarget && (
        <VoucherDialog
          open={!!editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
          branchId={editTarget.branch_id}
          type={editTarget.type}
          editingVoucher={editTarget}
          onSuccess={load}
        />
      )}

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>إلغاء السند {cancelTarget?.voucher_number}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed">
              <b>إلغاء السند ≠ حذف السند.</b><br />
              السند هيفضل ظاهر في الجدول بحالة <b>«ملغي»</b> مع سبب الإلغاء واسم اللي ألغاه — للتدقيق والمراجعة.<br />
              <b>أثره المحاسبي على الخزينة هيترجع تلقائياً.</b>
            </div>
            <Label>سبب الإلغاء *</Label>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
            {cancelTarget?.source === "system" && cancelTarget.source_type !== "treasury" && (
              <p className="text-sm text-warning">
                السند مرتبط بـ {cancelTarget.source_type}. لإلغائه يجب إلغاء المصدر أولاً.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>تراجع</Button>
            <Button variant="destructive" onClick={confirmCancel}>تأكيد الإلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>حذف السند {deleteTarget?.voucher_number} نهائياً</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs leading-relaxed">
              <b>الفرق بين الإلغاء والحذف النهائي:</b><br />
              • <b>إلغاء</b> = السند يفضل في السجلات بحالة «ملغي» مع تتبع السبب.<br />
              • <b>حذف نهائي</b> = السند ومرفقاته يتمسحوا خالص من قاعدة البيانات.<br />
              يُستخدم بس لو السند مكرر أو اتعمل بالغلط ومش عايز يفضل له أثر.
            </div>
            <p>
              لو السند نشط، أثره على الخزينة هيترجع أوتوماتيك قبل الحذف.
            </p>
            <p className="text-destructive font-semibold">
              العملية دي مالهاش رجوع.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>تراجع</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد الحذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VoucherViewDialog
        voucher={viewTarget}
        open={!!viewTarget}
        onOpenChange={(o) => !o && setViewTarget(null)}
        categoryName={viewTarget ? catMap[viewTarget.category_id] : undefined}
        onEdit={(v) => { setViewTarget(null); setEditTarget(v); }}
      />
    </div>
  );
}
