import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "./DataTable";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { VoucherDialog } from "./VoucherDialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchVoucherCategories, PARTY_TYPE_LABEL, Voucher, VoucherCategory, VoucherType, VOUCHER_TYPE_LABEL } from "@/lib/vouchers";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { formatEGP, formatDate } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, XCircle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { exportToExcel, printReport } from "@/lib/export";

interface Props {
  branchId?: string;
  type?: VoucherType; // undefined => show all
  adminAllBranches?: boolean;
  tenantId?: string;
}

export function VouchersTable({ branchId, type, adminAllBranches, tenantId }: Props) {
  const { isAdmin, hasRole } = useAuth();
  const [rows, setRows] = useState<Voucher[]>([]);
  const [cats, setCats] = useState<VoucherCategory[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Voucher | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Voucher | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    category_id: "",
    payment_method: "",
    source: "",
    branch_id: "",
    type: "" as "" | VoucherType,
  });

  const canAdd = !!branchId && (isAdmin || hasRole("branch_manager"));

  const load = async () => {
    setLoading(true);
    let q = supabase.from("vouchers" as any).select("*").order("created_at", { ascending: false }).limit(500);
    if (branchId) q = q.eq("branch_id", branchId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (type) q = q.eq("type", type);
    if (filters.type) q = q.eq("type", filters.type);
    if (filters.from) q = q.gte("voucher_date", filters.from);
    if (filters.to) q = q.lte("voucher_date", filters.to);
    if (filters.category_id) q = q.eq("category_id", filters.category_id);
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
      supabase.from("branches").select("id,name").order("name").then(({ data }) => setBranches(data ?? []));
    }
  }, [type, adminAllBranches]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId, type, tenantId, filters]);

  const catMap = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.name])), [cats]);
  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);

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

      <div className="card-elevated p-3 flex flex-wrap gap-2 items-end">
        <div>
          <Label className="text-xs">من تاريخ</Label>
          <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="h-9 mt-1" />
        </div>
        <div>
          <Label className="text-xs">إلى تاريخ</Label>
          <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="h-9 mt-1" />
        </div>
        {!type && (
          <div>
            <Label className="text-xs">النوع</Label>
            <Select value={filters.type || "all"} onValueChange={(v) => setFilters({ ...filters, type: v === "all" ? "" : v as any })}>
              <SelectTrigger className="h-9 mt-1 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="receipt">قبض</SelectItem>
                <SelectItem value="payment">صرف</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label className="text-xs">التصنيف</Label>
          <Select value={filters.category_id || "all"} onValueChange={(v) => setFilters({ ...filters, category_id: v === "all" ? "" : v })}>
            <SelectTrigger className="h-9 mt-1 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل التصنيفات</SelectItem>
              {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">طريقة الدفع</Label>
          <Select value={filters.payment_method || "all"} onValueChange={(v) => setFilters({ ...filters, payment_method: v === "all" ? "" : v })}>
            <SelectTrigger className="h-9 mt-1 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">المصدر</Label>
          <Select value={filters.source || "all"} onValueChange={(v) => setFilters({ ...filters, source: v === "all" ? "" : v })}>
            <SelectTrigger className="h-9 mt-1 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="manual">يدوي</SelectItem>
              <SelectItem value="system">تلقائي</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {adminAllBranches && (
          <div>
            <Label className="text-xs">الفرع</Label>
            <Select value={filters.branch_id || "all"} onValueChange={(v) => setFilters({ ...filters, branch_id: v === "all" ? "" : v })}>
              <SelectTrigger className="h-9 mt-1 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفروع</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2 ms-auto">
          <Button size="sm" variant="outline" onClick={() => exportToExcel("vouchers", [{ name: "السندات", rows: exportRows }])}>Excel</Button>
          <Button size="sm" variant="outline" onClick={() => {
            const html = `<table><thead><tr>${Object.keys(exportRows[0] ?? {}).map(k => `<th>${k}</th>`).join("")}</tr></thead><tbody>${exportRows.map(r => `<tr>${Object.values(r).map(v => `<td>${v ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
            printReport("السندات", html);
          }}>PDF</Button>
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
        columns={[
          { key: "voucher_number", header: "رقم السند", render: (r: Voucher) => <span className="font-mono">{r.voucher_number}</span> },
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
          { key: "actions", header: "", render: (r: Voucher) => {
            const canCancel = r.status === "active" && (isAdmin || (hasRole("branch_manager") && r.source === "manual"));
            return (
              <div className="flex items-center gap-1 justify-end">
                {canCancel && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelTarget(r)} className="text-destructive" title="إلغاء السند">
                    <XCircle className="w-4 h-4" />
                  </Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)} className="text-destructive" title="حذف السند نهائياً">
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

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>إلغاء السند {cancelTarget?.voucher_number}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
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
            <p>
              هتمسح السند نهائياً من النظام. لو السند نشط، أثره على الخزينة هيترجع أوتوماتيك قبل الحذف.
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
    </div>
  );
}
