import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { NumberedPagination } from "@/components/NumberedPagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatDate, formatDateTime, formatEGP } from "@/lib/format";
import { fetchDocumentAsOf, methodLabel, type DocumentAsOf } from "@/lib/ledger";
import { exportToExcel } from "@/lib/export";
import { rpcErrorText } from "@/lib/rpcError";
import { Search, FileSpreadsheet, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";

/**
 * «سجل المستندات» (owner request 2026-10-16, migration 0098): every step on a sale / purchase invoice, sale /
 * purchase return, receipt / payment voucher — when it really happened, who, what, the document's own date, and
 * the document's columns AFTER the step (same order as the sale table). Paid / remaining / payment columns of an
 * invoice are read as of the step's day (the ledger replayed to that day). Click a row for before → after.
 */

type DocType = "sale" | "purchase" | "sale_return" | "purchase_return" | "receipt" | "payment";
type Ev = {
  id: string; tenant_id: string; branch_id: string | null; branch_name: string | null; doc_type: DocType; doc_id: string;
  action: string; changes: Record<string, { old: any; new: any }>; snapshot: Record<string, any>;
  user_id: string | null; user_name: string | null; at: string; source: string;
};

const DOC_LABEL: Record<DocType, string> = {
  sale: "فاتورة بيع", purchase: "فاتورة شراء", sale_return: "مرتجع بيع", purchase_return: "مرتجع شراء",
  receipt: "سند قبض", payment: "سند صرف",
};
const ACTION_LABEL: Record<string, string> = {
  create: "إنشاء", cancel: "إلغاء", date: "تعديل التاريخ", amount: "تعديل المبلغ / الأصناف", party: "تغيير العميل / المورد",
  annotations: "تعديل المستلم / الملاحظات", method: "تغيير طريقة الدفع",
  payment_add: "إضافة دفعة", payment_void: "إلغاء دفعة", payment_move: "نقل دفعة لتاريخ تاني",
};
const ACTION_TONE: Record<string, string> = {
  create: "bg-success/15 text-success", cancel: "bg-destructive/15 text-destructive", payment_void: "bg-destructive/15 text-destructive",
  payment_add: "bg-primary/15 text-primary", date: "bg-warning/15 text-warning", payment_move: "bg-warning/15 text-warning",
};
const FIELD_LABEL: Record<string, string> = {
  invoice_date: "تاريخ المستند", voucher_date: "تاريخ السند", total: "الإجمالي", subtotal: "قبل الخصم", discount_amount: "الخصم",
  vat_amount: "الضريبة", total_cost: "الإجمالي", total_extra_costs: "مصاريف إضافية", total_refund: "قيمة المرتجع",
  total_amount: "الإجمالي", amount: "المبلغ", fee_amount: "العمولة", refund_cash_amount: "رد كاش", refund_transfer_amount: "رد تحويل",
  refund_balance_amount: "على الحساب", contact_id: "العميل / المورد", invoice_id: "الفاتورة", party_id: "الجهة", party_name: "اسم الجهة",
  recipient_name: "المستلم", received_by: "المستلم", notes: "الملاحظات", description: "البيان", reason: "السبب",
  payment_method: "طريقة الدفع", status: "الحالة", payment: "الدفعة", payment_date: "تاريخ الدفعة",
};
const DOC_PATH: Record<DocType, string> = {
  sale: "sales", purchase: "shipments", sale_return: "sale-returns", purchase_return: "purchase-returns", receipt: "vouchers", payment: "vouchers",
};
const BUCKET: Record<string, "cash" | "instapay" | "wallet" | "bank" | "account"> = {
  cash: "cash", instapay: "instapay", vodafone: "wallet", vodafone_cash: "wallet", wallet: "wallet",
  bank: "bank", bank_transfer: "bank", transfer: "bank", card: "bank", credit_balance: "account", credit_applied: "account",
};
const ALL = "__all";
const PAGE = 50;
const n = (v: any) => Number(v) || 0;

function fmtVal(field: string, v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "payment" && typeof v === "object") return `${formatEGP(n(v.amount))} ${methodLabel(v.method)}${v.at ? ` • ${formatDate(v.at)}` : ""}`;
  if (field === "status") return v === "cancelled" ? "ملغي" : v === "active" ? "نشط" : String(v);
  if (field === "payment_method") return methodLabel(v);
  if (/date$/.test(field)) return formatDate(v);
  if (["total", "subtotal", "discount_amount", "vat_amount", "total_cost", "total_extra_costs", "total_refund", "total_amount", "amount",
       "fee_amount", "refund_cash_amount", "refund_transfer_amount", "refund_balance_amount"].includes(field)) return formatEGP(n(v));
  return String(v);
}

export default function DocumentLog({ embedded }: { embedded?: boolean } = {}) {
  const { branches, isAdmin } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState(""); const [dq, setDq] = useState("");
  const [branch, setBranch] = useState(ALL);
  const [docType, setDocType] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [userId, setUserId] = useState(ALL);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Ev[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [pay, setPay] = useState<Map<string, DocumentAsOf>>(new Map());
  const [cls, setCls] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<Ev | null>(null);
  const req = useRef(0);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [dq, branch, docType, action, userId, from, to]);

  const args = (limit: number, offset: number) => ({
    p_branch: branch === ALL ? null : branch, p_from: from || null, p_to: to || null,
    p_doc_types: docType === ALL ? null : [docType], p_actions: action === ALL ? null : [action],
    p_user: userId === ALL ? null : userId, p_q: dq || null, p_limit: limit, p_offset: offset,
  });

  const load = async () => {
    const id = ++req.current;
    setLoading(true);
    const { data, error } = await supabase.rpc("document_log_page" as any, args(PAGE, (page - 1) * PAGE) as any);
    if (id !== req.current) return;
    if (error) { toast.error(rpcErrorText(error)); setLoading(false); return; }
    const res = (data ?? {}) as any;
    const evs = (res.rows ?? []) as Ev[];
    setRows(evs); setTotal(Number(res.total) || 0);
    setUsers(((res.users ?? []) as any[]).filter((u) => u.id).sort((a, b) => String(a.name).localeCompare(String(b.name), "ar")));
    setLoading(false);
    // invoices: paid / remaining / how it was paid as of the step's day; «التصنيف» from the settlement row
    const groups = new Map<string, { t: "invoice" | "shipment"; day: string; ids: string[] }>();
    for (const e of evs) {
      if (e.doc_type !== "sale" && e.doc_type !== "purchase") continue;
      const t = e.doc_type === "sale" ? "invoice" : "shipment";
      const day = new Date(e.at).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
      const k = `${t}|${day}`;
      const g = groups.get(k) ?? { t, day, ids: [] }; g.ids.push(e.doc_id); groups.set(k, g);
    }
    const p = new Map<string, DocumentAsOf>();
    await Promise.all(Array.from(groups.values()).map(async (g) => {
      const m = await fetchDocumentAsOf(g.t, g.ids, g.day).catch(() => new Map<string, DocumentAsOf>());
      m.forEach((v, docId) => p.set(`${docId}|${g.day}`, v));
    }));
    const saleIds = evs.filter((e) => e.doc_type === "sale").map((e) => e.doc_id);
    const shipIds = evs.filter((e) => e.doc_type === "purchase").map((e) => e.doc_id);
    const c = new Map<string, string>();
    const [a, b] = await Promise.all([
      saleIds.length ? supabase.from("invoice_settlement" as any).select("invoice_id, class").in("invoice_id", Array.from(new Set(saleIds))) : Promise.resolve({ data: [] as any[] }),
      shipIds.length ? supabase.from("shipment_settlement" as any).select("shipment_id, class").in("shipment_id", Array.from(new Set(shipIds))) : Promise.resolve({ data: [] as any[] }),
    ]);
    for (const r of ((a as any).data ?? []) as any[]) c.set(r.invoice_id, r.class);
    for (const r of ((b as any).data ?? []) as any[]) c.set(r.shipment_id, r.class);
    if (id !== req.current) return;
    setPay(p); setCls(c);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [page, dq, branch, docType, action, userId, from, to]);
  useRealtimeRefresh(["invoices", "shipments", "returns", "purchase_returns", "vouchers", "invoice_payments", "payment_transactions"], load);

  const dayOf = (e: Ev) => new Date(e.at).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  /** The money columns of a row: invoices from the ledger as of the step's day, returns / vouchers from their own fields. */
  const money = (e: Ev) => {
    const s = e.snapshot ?? {};
    const out = { paid: null as number | null, remaining: null as number | null, cash: 0, instapay: 0, wallet: 0, bank: 0, account: 0, other: 0 };
    if (e.doc_type === "sale" || e.doc_type === "purchase") {
      const a = pay.get(`${e.doc_id}|${dayOf(e)}`);
      if (a) {
        out.paid = a.status.paid; out.remaining = a.status.remaining;
        out.cash = a.byBucket.cash; out.instapay = a.byBucket.instapay; out.wallet = a.byBucket.wallet;
        out.bank = a.byBucket.bank; out.account = a.byBucket.account; out.other = a.byBucket.other;
      }
    } else if (e.doc_type === "sale_return" || e.doc_type === "purchase_return") {
      const k = BUCKET[s.method] ?? "cash";
      if (n(s.refund_cash)) out.cash += n(s.refund_cash);
      if (n(s.refund_transfer)) out[k === "cash" ? "bank" : k] += n(s.refund_transfer);
      out.account = n(s.refund_balance);
    } else {
      const k = BUCKET[s.method] ?? "cash";
      out[k] += n(s.amount);
    }
    return out;
  };
  const cell = (v: number) => v > 0.005 ? <span className="tabular-nums">{formatEGP(v)}</span> : <span className="text-muted-foreground">—</span>;
  const text = (v: any) => v ? <span className="block max-w-[12rem] truncate mx-auto" title={String(v)}>{v}</span> : <span className="text-muted-foreground">—</span>;

  const columns = useMemo(() => [
    { key: "at", header: "وقت العملية الفعلي", align: "center", className: "min-w-[140px]", render: (e: Ev) => <span className="tabular-nums text-xs">{formatDateTime(e.at)}</span> },
    { key: "user", header: "المستخدم", align: "center", className: "min-w-[110px]", render: (e: Ev) => <span className="font-semibold">{e.user_name ?? "—"}</span> },
    { key: "action", header: "العملية", align: "center", className: "min-w-[130px]", render: (e: Ev) => (
      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ACTION_TONE[e.action] ?? "bg-muted text-foreground"}`}>{ACTION_LABEL[e.action] ?? e.action}</span>
    ) },
    { key: "type", header: "النوع", align: "center", className: "min-w-[90px]", render: (e: Ev) => DOC_LABEL[e.doc_type] },
    { key: "number", header: "الرقم", align: "center", className: "min-w-[90px]", render: (e: Ev) => <span className="font-mono font-semibold text-primary">{e.snapshot?.number ?? "—"}</span> },
    { key: "doc_date", header: "تاريخ المستند", align: "center", className: "min-w-[100px]", render: (e: Ev) => e.snapshot?.date ? formatDate(e.snapshot.date) : "—" },
    { key: "party", header: "العميل / المورد", align: "right", className: "min-w-[170px] text-right", render: (e: Ev) => (
      <span className="block max-w-[170px] truncate font-semibold" title={e.snapshot?.party_name ?? ""}>
        {e.snapshot?.party_name ?? (e.doc_type === "sale" || e.doc_type === "sale_return" ? "نقدي" : "—")}
      </span>
    ) },
    { key: "amount", header: "المبلغ", align: "center", className: "min-w-[100px]", numeric: true, render: (e: Ev) => formatEGP(n(e.snapshot?.amount)) },
    { key: "class", header: "التصنيف", align: "center", className: "min-w-[80px]", render: (e: Ev) => {
      if (e.doc_type !== "sale" && e.doc_type !== "purchase") return <span className="text-muted-foreground">—</span>;
      const c = cls.get(e.doc_id);
      if (!c) return <span className="text-muted-foreground">—</span>;
      return c === "cash"
        ? <span className="inline-flex rounded-full border border-success/40 bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">نقدي</span>
        : <span className="inline-flex rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">آجل</span>;
    } },
    { key: "paid_rem", header: "المدفوع / المتبقي", align: "center", className: "min-w-[130px]", render: (e: Ev) => {
      const m = money(e);
      if (m.paid === null) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="flex flex-col items-center gap-0.5 text-xs tabular-nums">
          <span className="font-bold text-success">مدفوع {formatEGP(m.paid)}</span>
          <span className={`font-bold ${n(m.remaining) > 0.005 ? "text-warning" : "text-muted-foreground"}`}>متبقي {formatEGP(n(m.remaining))}</span>
        </span>
      );
    } },
    { key: "cash", header: "كاش", align: "center", className: "min-w-[90px]", numeric: true, render: (e: Ev) => cell(money(e).cash) },
    { key: "instapay", header: "انستاباي", align: "center", className: "min-w-[90px]", numeric: true, render: (e: Ev) => cell(money(e).instapay) },
    { key: "wallet", header: "محفظة", align: "center", className: "min-w-[90px]", numeric: true, render: (e: Ev) => cell(money(e).wallet) },
    { key: "bank", header: "بنكي", align: "center", className: "min-w-[90px]", numeric: true, render: (e: Ev) => cell(money(e).bank) },
    { key: "account", header: "من / على الحساب", align: "center", className: "min-w-[100px]", numeric: true, render: (e: Ev) => cell(money(e).account) },
    { key: "other", header: "من مرتجع", align: "center", className: "min-w-[90px]", numeric: true, render: (e: Ev) => cell(money(e).other) },
    { key: "status", header: "الحالة", align: "center", className: "min-w-[70px]", render: (e: Ev) => e.snapshot?.status === "cancelled" ? <span className="font-semibold text-destructive">ملغي</span> : "نشط" },
    { key: "recipient", header: "المستلم", align: "center", className: "min-w-[110px]", render: (e: Ev) => text(e.snapshot?.recipient) },
    { key: "notes", header: "الملاحظات", align: "center", className: "min-w-[140px]", render: (e: Ev) => text(e.snapshot?.notes) },
    { key: "branch", header: "الفرع", align: "center", className: "min-w-[110px]", render: (e: Ev) => e.branch_name ?? "—" },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [pay, cls]);

  const exportAll = async () => {
    const t = toast.loading("جاري تجهيز السجل...");
    try {
      const all: Ev[] = [];
      for (let off = 0; off < 200_000; off += 1000) {
        const { data, error } = await supabase.rpc("document_log_page" as any, args(1000, off) as any);
        if (error) throw error;
        const part = ((data as any)?.rows ?? []) as Ev[];
        all.push(...part);
        if (part.length < 1000) break;
      }
      exportToExcel("سجل-المستندات", [{
        name: "سجل المستندات",
        rows: all.map((e) => ({
          "وقت العملية": formatDateTime(e.at), "المستخدم": e.user_name ?? "", "العملية": ACTION_LABEL[e.action] ?? e.action,
          "النوع": DOC_LABEL[e.doc_type], "الرقم": e.snapshot?.number ?? "", "تاريخ المستند": e.snapshot?.date ? formatDate(e.snapshot.date) : "",
          "العميل / المورد": e.snapshot?.party_name ?? "", "المبلغ": n(e.snapshot?.amount), "الحالة": e.snapshot?.status === "cancelled" ? "ملغي" : "نشط",
          "المستلم": e.snapshot?.recipient ?? "", "الملاحظات": e.snapshot?.notes ?? "", "الفرع": e.branch_name ?? "",
          "التفاصيل": Object.entries(e.changes ?? {}).map(([f, c]) => `${FIELD_LABEL[f] ?? f}: ${fmtVal(f, c?.old)} ← ${fmtVal(f, c?.new)}`).join(" | "),
        })),
      }]);
      toast.dismiss(t); toast.success(`تم تصدير ${all.length} عملية`);
    } catch (e: any) { toast.dismiss(t); toast.error(rpcErrorText(e)); }
  };

  const hasFilters = !!(q || from || to) || [branch, docType, action, userId].some((v) => v !== ALL);
  const clear = () => { setQ(""); setFrom(""); setTo(""); setBranch(ALL); setDocType(ALL); setAction(ALL); setUserId(ALL); };

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="سجل المستندات"
        subtitle={`${total.toLocaleString("en-US")} عملية — كل خطوة على فواتير البيع والشراء والمرتجعات وسندات القبض والصرف، باللي عملها ووقتها الفعلي. اضغط على أي صف تشوف قبل وبعد.`}
        actions={<Button variant="outline" onClick={exportAll}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>}
      />

      <div className="card-elevated mb-4 space-y-3 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-10 pr-9 bg-background"
                 placeholder="رقم المستند، اسم العميل / المورد، تليفون، اسم المستخدم..." />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          {isAdmin && (
            <div><Label className="text-xs">الفرع</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>كل الفروع</SelectItem>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div><Label className="text-xs">نوع المستند</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>الكل</SelectItem>{(Object.keys(DOC_LABEL) as DocType[]).map((k) => <SelectItem key={k} value={k}>{DOC_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">العملية</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>الكل</SelectItem>{Object.entries(ACTION_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">المستخدم</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>الكل</SelectItem>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">من يوم</Label><Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">لحد يوم</Label><Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {hasFilters && <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={clear}><X className="h-3.5 w-3.5" />مسح الفلاتر</Button>}
        <p className="text-[11px] text-muted-foreground">
          الفترة على وقت العملية الفعلي (مش تاريخ المستند). المدفوع والمتبقي وطريقة الدفع للفواتير محسوبين لحد آخر يوم العملية؛ «التصنيف» هو تصنيف الفاتورة النهارده.
          العمليات قبل تشغيل السجل اتجمعت من السجل القديم والمستندات نفسها، فممكن يكون ناقصها اسم المستخدم.
        </p>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        columns={columns as any}
        indexColumn={{ offset: (page - 1) * PAGE }}
        getRowKey={(e: Ev) => e.id}
        onRowClick={(e: Ev) => setOpen(e)}
        minTableWidth="2300px"
        empty="مفيش عمليات بالفلاتر دي"
      />
      <NumberedPagination page={page} pageCount={Math.max(1, Math.ceil(total / PAGE))} disabled={loading} onChange={setPage} />

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{ACTION_LABEL[open.action] ?? open.action} — {DOC_LABEL[open.doc_type]} {open.snapshot?.number ?? ""}</DialogTitle>
                <DialogDescription>
                  {open.user_name ?? "—"} • {formatDateTime(open.at)}{open.branch_name ? ` • ${open.branch_name}` : ""}
                  {open.snapshot?.date ? ` • تاريخ المستند ${formatDate(open.snapshot.date)}` : ""}
                </DialogDescription>
              </DialogHeader>
              {Object.keys(open.changes ?? {}).length > 0 ? (
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-muted-foreground"><th className="py-1.5 text-right">البيان</th><th className="py-1.5 text-center">قبل</th><th className="py-1.5 text-center">بعد</th></tr></thead>
                  <tbody>
                    {Object.entries(open.changes).map(([f, c]) => (
                      <tr key={f} className="border-b last:border-0">
                        <td className="py-1.5 font-semibold">{FIELD_LABEL[f] ?? f}</td>
                        <td className="py-1.5 text-center text-destructive">{f === "contact_id" || f === "invoice_id" || f === "party_id" ? (c?.old ? "جهة تانية" : "—") : fmtVal(f, c?.old)}</td>
                        <td className="py-1.5 text-center text-success">{f === "contact_id" || f === "invoice_id" || f === "party_id" ? (open.snapshot?.party_name ?? "—") : fmtVal(f, c?.new)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="space-y-1 text-sm">
                  <div>العميل / المورد: <b>{open.snapshot?.party_name ?? "—"}</b></div>
                  <div>المبلغ: <b>{formatEGP(n(open.snapshot?.amount))}</b>{open.snapshot?.method ? ` • ${methodLabel(open.snapshot.method)}` : ""}</div>
                  {open.snapshot?.ref_number && <div>على: <b>{open.snapshot.ref_number}</b></div>}
                  {open.snapshot?.category && <div>التصنيف: <b>{open.snapshot.category}</b></div>}
                  {open.snapshot?.reason && <div>السبب: {open.snapshot.reason}</div>}
                  {open.snapshot?.notes && <div>الملاحظات: {open.snapshot.notes}</div>}
                </div>
              )}
              <DialogFooter>
                {open.branch_id && (
                  <Button onClick={() => { const e = open; setOpen(null); nav(`/branch/${e.branch_id}/${DOC_PATH[e.doc_type]}/${e.doc_id}`); }} className="gap-1">
                    <ExternalLink className="h-4 w-4" /> فتح المستند
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ConditionalLayout>
  );
}
