import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime, formatEGP } from "@/lib/format";
import { FileSpreadsheet, TrendingDown, TrendingUp, Sparkles, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const PRICE_TYPE_LABEL: Record<string, string> = {
  selling_price: "سعر البيع",
  cost_price: "سعر التكلفة",
  market_price: "سعر السوق",
  min_price: "الحد الأدنى",
  discount_limit: "حد الخصم",
  shipping_cost: "تكلفة الشحن",
  true_unit_cost: "التكلفة الحقيقية",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "يدوي",
  shipment: "شحنة",
  price_list_import: "استيراد قائمة",
  system: "النظام",
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "سوبر آدمن",
  admin: "مدير عام",
  branch_manager: "مدير فرع",
  accountant: "محاسب",
  cashier: "كاشير",
  system: "النظام",
};

export default function PriceAuditLog({ embedded }: { embedded?: boolean } = {}) {
  const { tenant, profile, isAdmin } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // filters
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [productId, setProductId] = useState("all");
  const [priceType, setPriceType] = useState("all");
  const [user, setUser] = useState("");
  const [branchId, setBranchId] = useState("all");
  const [source, setSource] = useState("all");
  const [todayCount, setTodayCount] = useState(0);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("price_audit_log")
      .select("*, branches(name)")
      .order("created_at", { ascending: false })
      .limit(1000);
    setRows(data ?? []);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    setTodayCount((data ?? []).filter((r: any) => new Date(r.created_at) >= today).length);
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.from("branches").select("id,name").then(({ data }) => setBranches(data ?? []));
    supabase.from("products").select("id,name").limit(1000).then(({ data }) => setProducts(data ?? []));

    const ch = supabase
      .channel("price-audit-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "price_audit_log" }, (payload: any) => {
        setRows((prev) => [payload.new, ...prev]);
        const created = new Date(payload.new.created_at);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (created >= today) setTodayCount((c) => c + 1);
        toast.info(`تعديل سعر جديد: ${payload.new.entity_name ?? ""}`);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (from && new Date(r.created_at) < new Date(from)) return false;
      if (to && new Date(r.created_at) > new Date(to + "T23:59:59")) return false;
      if (productId !== "all" && r.entity_id !== productId) return false;
      if (priceType !== "all" && r.price_type !== priceType) return false;
      if (user && !(r.changed_by_name ?? "").toLowerCase().includes(user.toLowerCase())) return false;
      if (branchId !== "all" && r.branch_id !== branchId) return false;
      if (source !== "all" && r.source !== source) return false;
      return true;
    });
  }, [rows, from, to, productId, priceType, user, branchId, source]);

  const exportExcel = () => {
    const data = rows.map((r) => ({
      "التاريخ": formatDateTime(r.created_at),
      "النوع": PRICE_TYPE_LABEL[r.price_type] ?? r.price_type,
      "المنتج/الكيان": r.entity_name ?? "",
      "السعر القديم": r.old_value ?? "",
      "السعر الجديد": r.new_value ?? "",
      "الفرق": r.old_value != null ? Number(r.new_value) - Number(r.old_value) : "",
      "بواسطة": r.changed_by_name ?? "",
      "الدور": ROLE_LABEL[r.changed_by_role] ?? r.changed_by_role,
      "الفرع": r.branches?.name ?? "",
      "السبب": r.change_reason ?? "",
      "المصدر": SOURCE_LABEL[r.source] ?? r.source,
    }));
    const meta = [
      ["الشركة", tenant?.name ?? ""],
      ["تاريخ التصدير", new Date().toLocaleString("ar-EG")],
      ["صدّره", profile?.name ?? ""],
      ["إجمالي السجلات", String(data.length)],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.sheet_add_json(ws, data, { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل الأسعار");
    XLSX.writeFile(wb, `price-audit-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`تم تصدير ${data.length} سجل`);
  };

  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);

  const deleteRow = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا السجل نهائياً؟")) return;
    const { error } = await supabase.from("price_audit_log").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success("تم الحذف");
  };

  const deleteAll = async () => {
    if (confirmWord.trim() !== "تأكيد") return toast.error("اكتب كلمة (تأكيد) للمتابعة");
    setBusy(true);
    const { error } = await supabase.rpc("admin_reset_price_audit", { p_branch_id: null } as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم مسح كل سجل تعديلات الأسعار");
    setConfirmAll(false); setConfirmWord("");
    load();
  };

  const rowClass = (r: any) => {
    if (r.old_value == null) return "bg-primary/5";
    if (Number(r.new_value) > Number(r.old_value)) return "bg-success/5";
    if (Number(r.new_value) < Number(r.old_value)) return "bg-destructive/5";
    return "";
  };

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="سجل تعديلات الأسعار"
        subtitle={`${filtered.length} سجل معروض — ${todayCount} تعديل اليوم`}
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

      <div className="card-elevated p-4 mb-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="من" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder="إلى" />
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger><SelectValue placeholder="المنتج" /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">كل المنتجات</SelectItem>
            {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priceType} onValueChange={setPriceType}>
          <SelectTrigger><SelectValue placeholder="نوع السعر" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            {Object.entries(PRICE_TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="المستخدم" />
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger><SelectValue placeholder="المصدر" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المصادر</SelectItem>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        columns={[
          { key: "created_at", header: "التاريخ", render: (r: any) => <span className={`px-2 py-1 rounded ${rowClass(r)}`}>{formatDateTime(r.created_at)}</span> },
          { key: "entity_name", header: "المنتج", render: (r: any) => <span className="font-semibold">{r.entity_name ?? "—"}</span> },
          { key: "price_type", header: "نوع السعر", render: (r: any) => PRICE_TYPE_LABEL[r.price_type] ?? r.price_type },
          { key: "old_value", header: "القديم", render: (r: any) => r.old_value == null ? <span className="text-primary">—</span> : formatEGP(r.old_value) },
          { key: "new_value", header: "الجديد", render: (r: any) => <span className="font-bold">{formatEGP(r.new_value)}</span> },
          {
            key: "diff", header: "التغيير", render: (r: any) => {
              if (r.old_value == null) return <span className="inline-flex items-center gap-1 text-primary"><Sparkles className="w-3 h-3" /> أول تسجيل</span>;
              const diff = Number(r.new_value) - Number(r.old_value);
              const pct = Number(r.old_value) === 0 ? 0 : (diff / Number(r.old_value)) * 100;
              const up = diff > 0;
              return (
                <span className={`inline-flex items-center gap-1 font-bold ${up ? "text-success" : "text-destructive"}`}>
                  {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {up ? "+" : ""}{formatEGP(diff)} ({pct.toFixed(1)}%)
                </span>
              );
            }
          },
          {
            key: "changed_by_name", header: "بواسطة", render: (r: any) => (
              <div className="flex flex-col">
                <span className="font-semibold">{r.changed_by_name ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[r.changed_by_role] ?? r.changed_by_role}</span>
              </div>
            )
          },
          { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
          { key: "change_reason", header: "السبب", render: (r: any) => <span className="text-xs">{r.change_reason ?? "—"}</span> },
          { key: "source", header: "المصدر", render: (r: any) => <span className="px-2 py-0.5 rounded text-xs bg-muted">{SOURCE_LABEL[r.source] ?? r.source}</span> },
          ...(isAdmin ? [{
            key: "del", header: "حذف", render: (r: any) => (
              <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => deleteRow(r.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )
          }] : []),
        ]}
      />

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> حذف كل سجل تعديلات الأسعار
            </AlertDialogTitle>
            <AlertDialogDescription>
              هتمسح <b>كل</b> سجلات تعديلات الأسعار للشركة. الإجراء نهائي ولا يمكن التراجع عنه.
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
