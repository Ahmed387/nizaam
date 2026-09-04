import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Printer, FileText, Receipt, Pencil, Trash2 } from "lucide-react";
import { formatEGP, formatNumber } from "@/lib/format";
import { printHtml } from "@/lib/export";
import { searchMatch } from "@/lib/search";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { printArchiveInvoice } from "@/components/ArchivePrintTemplate";

/* ================= types (mirror archive tables, read-only) ================= */
export type ArchiveInvoice = {
  id: string; branch_name: string; doc_type: string; invoice_no: string | null;
  date: string; year: number; month: number; party_name: string | null;
  payment_method: string | null; total_qty: number; discount: number;
  total_amount: number; profit: number; paid_cash: number; credit: number; due: number;
};
export type ArchiveItem = {
  id: string; invoice_id: string | null; branch_name: string; year: number;
  item_code: string | null; item_name: string; qty: number; price: number; profit: number; total: number;
};
export type ArchiveVoucher = {
  id: string; branch_name: string; voucher_type: string; voucher_no: string | null;
  date: string; year: number; month: number; amount: number; category: string | null;
  party_name: string | null; movement_name: string | null; treasury_name: string | null;
};

export const ARCHIVE_DOC_LABEL: Record<string, string> = {
  sales: "فاتورة بيع", purchases: "فاتورة شراء",
  sales_returns: "مرتجع بيع", purchase_returns: "مرتجع شراء",
};

const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/* ================= invoice details + print ================= */
export function HistoricalInvoiceDialog({
  invoice, items, open, onOpenChange,
}: {
  invoice: ArchiveInvoice | null;
  items: ArchiveItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!invoice) return null;
  const label = ARCHIVE_DOC_LABEL[invoice.doc_type] ?? invoice.doc_type;
  const title = `${label} ${invoice.invoice_no ?? ""}`.trim();

  // قالب طباعة الأرشيف مستقل تمامًا عن مكوّن طباعة الفواتير الحية
  const handlePrint = () => {
    void printArchiveInvoice(
      {
        title: label,
        invoice_no: invoice.invoice_no,
        date: invoice.date,
        branch_name: invoice.branch_name,
        party_name: invoice.party_name,
        party_label: invoice.doc_type.startsWith("purchase") ? "المورد" : "العميل",
        payment_method: invoice.payment_method,
        total_qty: Number(invoice.total_qty ?? 0),
        discount: Number(invoice.discount ?? 0),
        total_amount: Number(invoice.total_amount ?? 0),
        paid_cash: Number(invoice.paid_cash ?? 0),
        due: Number(invoice.due ?? 0),
      },
      items.map((it) => ({
        item_code: it.item_code,
        item_name: it.item_name,
        qty: Number(it.qty ?? 0),
        price: Number(it.price ?? 0),
        total: Number(it.total ?? 0),
      })),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4" />
            {title}
            <Badge variant="secondary" className="text-[10px]">أرشيف</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border p-3 space-y-1">
            <div className="font-semibold mb-1">الطرف</div>
            <div className="flex justify-between"><span className="text-muted-foreground">الاسم</span><b>{invoice.party_name ?? "—"}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">السداد</span><b>{invoice.payment_method ?? "—"}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الفرع</span><b>{invoice.branch_name}</b></div>
          </div>
          <div className="rounded-xl border p-3 space-y-1">
            <div className="font-semibold mb-1">المستند</div>
            <div className="flex justify-between"><span className="text-muted-foreground">النوع</span><b>{label}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الرقم</span><b>{invoice.invoice_no ?? "—"}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">التاريخ</span><b>{invoice.date}</b></div>
          </div>
          <div className="rounded-xl border p-3 space-y-1">
            <div className="font-semibold mb-1">المالية</div>
            <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي</span><b className="tabular-nums">{formatEGP(invoice.total_amount)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">المسدد</span><b className="tabular-nums text-emerald-600 dark:text-emerald-400">{formatEGP(invoice.paid_cash)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">المستحق</span><b className="tabular-nums text-amber-600 dark:text-amber-400">{formatEGP(invoice.due)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الربح</span><b className="tabular-nums">{formatEGP(invoice.profit)}</b></div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr>{["الكود", "الصنف", "الكمية", "السعر", "الربح", "الإجمالي"].map((h) => <th key={h} className="px-2 py-2 text-right">{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-2 py-1.5 tabular-nums">{it.item_code ?? "—"}</td>
                  <td className="px-2 py-1.5">{it.item_name}</td>
                  <td className="px-2 py-1.5 tabular-nums">{formatNumber(it.qty)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{formatEGP(it.price)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{formatEGP(it.profit)}</td>
                  <td className="px-2 py-1.5 tabular-nums font-semibold">{formatEGP(it.total)}</td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">لا توجد أصناف مسجلة لهذا المستند</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handlePrint}><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================= voucher details ================= */
export function HistoricalVoucherDialog({
  voucher, open, onOpenChange,
}: { voucher: ArchiveVoucher | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  if (!voucher) return null;
  const label = voucher.voucher_type === "expense" ? "سند صرف" : "سند قبض";
  const title = `${label} ${voucher.voucher_no ?? ""}`.trim();

  const handlePrint = () => {
    const body = `
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">التاريخ: ${escapeHtml(voucher.date)} · الفرع: ${escapeHtml(voucher.branch_name)} · <span class="badge">أرشيف تاريخي</span></div>
      <div class="card">
        <div class="row"><span>الطرف</span><b>${escapeHtml(voucher.party_name ?? "—")}</b></div>
        <div class="row"><span>التصنيف</span><b>${escapeHtml(voucher.category ?? "—")}</b></div>
        <div class="row"><span>البيان</span><b>${escapeHtml(voucher.movement_name ?? "—")}</b></div>
        <div class="row"><span>الخزينة</span><b>${escapeHtml(voucher.treasury_name ?? "—")}</b></div>
        <div class="row" style="border-top:1px solid #ddd;padding-top:6px;margin-top:6px"><span><b>القيمة</b></span><b style="color:#3b82f6;font-size:15px">${formatEGP(Number(voucher.amount ?? 0))}</b></div>
      </div>`;
    printHtml(title || "سند تاريخي", body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Receipt className="w-4 h-4" /> {title}
            <Badge variant="secondary" className="text-[10px]">أرشيف</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 text-xs">
          {[
            ["الطرف", voucher.party_name ?? "—"],
            ["التصنيف", voucher.category ?? "—"],
            ["البيان", voucher.movement_name ?? "—"],
            ["الخزينة", voucher.treasury_name ?? "—"],
            ["الفرع", voucher.branch_name],
            ["التاريخ", voucher.date],
          ].map(([kk, v]) => (
            <div key={kk} className="flex justify-between border-b border-border/50 py-1">
              <span className="text-muted-foreground">{kk}</span><b>{v}</b>
            </div>
          ))}
          <div className="flex justify-between pt-2">
            <span className="font-semibold">القيمة</span>
            <b className="tabular-nums text-primary">{formatEGP(voucher.amount)}</b>
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={handlePrint}><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================= party ledger statement ================= */
export function HistoricalPartyLedgerDialog({
  party, invoices, vouchers, items, open, onOpenChange,
}: {
  party: string | null;
  invoices: ArchiveInvoice[];
  vouchers: ArchiveVoucher[];
  items: ArchiveItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [inv, setInv] = useState<ArchiveInvoice | null>(null);
  const [vch, setVch] = useState<ArchiveVoucher | null>(null);

  // فلاتر السجل الكامل — معزولة تمامًا عن فلاتر صفحة الأرشيف الرئيسية
  const [fType, setFType] = useState("all");
  const [fNo, setFNo] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fBranch, setFBranch] = useState("all");
  const resetFilters = () => { setFType("all"); setFNo(""); setFFrom(""); setFTo(""); setFBranch("all"); };
  useEffect(() => { if (!open) resetFilters(); }, [open]);

  const allRows = useMemo(() => {
    if (!party) return [] as { kind: "invoice" | "voucher"; id: string; date: string; label: string; no: string | null; branch: string; amount: number; extra: string; raw: any }[];
    const invRows = invoices
      .filter((i) => (i.party_name ?? "غير محدد") === party)
      .map((i) => ({
        kind: "invoice" as const, id: i.id, date: i.date,
        label: ARCHIVE_DOC_LABEL[i.doc_type] ?? i.doc_type, no: i.invoice_no,
        branch: i.branch_name, amount: Number(i.total_amount ?? 0),
        extra: i.payment_method ?? "—", raw: i,
      }));
    const vchRows = vouchers
      .filter((v) => (v.party_name ?? "غير محدد") === party)
      .map((v) => ({
        kind: "voucher" as const, id: v.id, date: v.date,
        label: v.voucher_type === "expense" ? "سند صرف" : "سند قبض", no: v.voucher_no,
        branch: v.branch_name, amount: Number(v.amount ?? 0),
        extra: v.category ?? "—", raw: v,
      }));
    return [...invRows, ...vchRows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [party, invoices, vouchers]);

  const ledgerBranches = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.branch).filter(Boolean))).sort(),
    [allRows],
  );

  const rows = useMemo(() => allRows.filter((r) => {
    if (fType !== "all") {
      if (fType === "receipt" || fType === "expense") {
        if (r.kind !== "voucher" || r.raw.voucher_type !== fType) return false;
      } else if (r.kind !== "invoice" || r.raw.doc_type !== fType) return false;
    }
    if (fNo.trim() && !searchMatch(fNo, r.no)) return false;
    if (fBranch !== "all" && r.branch !== fBranch) return false;
    if (fFrom && String(r.date) < fFrom) return false;
    if (fTo && String(r.date) > fTo) return false;
    return true;
  }), [allRows, fType, fNo, fBranch, fFrom, fTo]);

  const totals = useMemo(() => {
    const pick = (t: string) => invoices.filter((i) => (i.party_name ?? "غير محدد") === party && i.doc_type === t);
    const s = (arr: ArchiveInvoice[], kk: keyof ArchiveInvoice) => arr.reduce((a, r) => a + Number(r[kk] ?? 0), 0);
    const sales = pick("sales"), sRet = pick("sales_returns"), purch = pick("purchases"), pRet = pick("purchase_returns");
    const vch = vouchers.filter((v) => (v.party_name ?? "غير محدد") === party);
    return {
      sales: s(sales, "total_amount") - Math.abs(s(sRet, "total_amount")),
      purchases: s(purch, "total_amount") - Math.abs(s(pRet, "total_amount")),
      paid: s(sales, "paid_cash") - Math.abs(s(sRet, "paid_cash")) + s(purch, "paid_cash") - Math.abs(s(pRet, "paid_cash")),
      due: s(sales, "due") - Math.abs(s(sRet, "due")) + s(purch, "due") - Math.abs(s(pRet, "due")),
      receipts: vch.filter((v) => v.voucher_type === "receipt").reduce((a, v) => a + Number(v.amount ?? 0), 0),
      payments: vch.filter((v) => v.voucher_type === "expense").reduce((a, v) => a + Number(v.amount ?? 0), 0),
      count: allRows.length,
    };
  }, [party, invoices, vouchers, allRows]);

  const itemsFor = (invoiceId: string) => items.filter((it) => it.invoice_id === invoiceId);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">السجل الكامل للحساب — {party ?? "—"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 text-xs">
            {[
              ["صافي المبيعات", formatEGP(totals.sales)],
              ["صافي المشتريات", formatEGP(totals.purchases)],
              ["المسدد", formatEGP(totals.paid)],
              ["المستحق", formatEGP(totals.due)],
              ["سندات قبض", formatEGP(totals.receipts)],
              ["سندات صرف", formatEGP(totals.payments)],
            ].map(([t, v]) => (
              <div key={t} className="rounded-xl border p-2.5">
                <div className="text-[11px] text-muted-foreground">{t}</div>
                <div className="font-bold tabular-nums">{v}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-2 grid-cols-2 lg:grid-cols-5 text-xs">
            <div className="space-y-1">
              <Label className="text-[11px]">نوع المستند</Label>
              <Select value={fType} onValueChange={setFType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="sales">فاتورة بيع</SelectItem>
                  <SelectItem value="purchases">فاتورة شراء</SelectItem>
                  <SelectItem value="sales_returns">مرتجع بيع</SelectItem>
                  <SelectItem value="purchase_returns">مرتجع شراء</SelectItem>
                  <SelectItem value="receipt">سند قبض</SelectItem>
                  <SelectItem value="expense">سند صرف</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">رقم المستند</Label>
              <Input className="h-9" value={fNo} onChange={(e) => setFNo(e.target.value)} placeholder="بحث بالرقم" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">من تاريخ</Label>
              <Input type="date" className="h-9" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">إلى تاريخ</Label>
              <Input type="date" className="h-9" value={fTo} onChange={(e) => setFTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">الفرع</Label>
              <Select value={fBranch} onValueChange={setFBranch}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفروع</SelectItem>
                  {ledgerBranches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr>{["التاريخ", "النوع", "رقم", "الفرع", "بيان", "القيمة"].map((h) => <th key={h} className="px-2 py-2 text-right">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.kind}-${r.id}`}
                    className="border-t hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => (r.kind === "invoice" ? setInv(r.raw) : setVch(r.raw))}
                  >
                    <td className="px-2 py-1.5 tabular-nums">{r.date}</td>
                    <td className="px-2 py-1.5"><Badge variant="secondary" className="text-[10px]">{r.label}</Badge></td>
                    <td className="px-2 py-1.5 tabular-nums">{r.no ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.branch}</td>
                    <td className="px-2 py-1.5">{r.extra}</td>
                    <td className="px-2 py-1.5 tabular-nums font-semibold">{formatEGP(r.amount)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">لا توجد معاملات</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-muted-foreground">المعروض: {formatNumber(rows.length)} من {formatNumber(allRows.length)} — اضغط على أي معاملة لعرض تفاصيلها.</div>
        </DialogContent>
      </Dialog>

      <HistoricalInvoiceDialog
        invoice={inv}
        items={inv ? itemsFor(inv.id) : []}
        open={!!inv}
        onOpenChange={(v) => !v && setInv(null)}
      />
      <HistoricalVoucherDialog voucher={vch} open={!!vch} onOpenChange={(v) => !v && setVch(null)} />
    </>
  );
}
