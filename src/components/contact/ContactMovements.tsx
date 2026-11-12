import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, ExternalLink, Pencil, Printer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatEGP } from "@/lib/format";
import { exportToExcel, printReport } from "@/lib/export";
import { openDocs } from "@/lib/openDocs";
import { fetchContactAccountMovements, type AccountMovement } from "@/lib/ledger";
import { PrintDocButton } from "@/components/documents/MoneyCells";
import { cancelDoc, type BulkKind } from "@/lib/bulkDocs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * The account's movements (owner 2026-11-11, migration 0199): the one table of the contact file —
 * # · التحديد · التاريخ · الوقت · رقم الحركة · الحركة · لنا · علينا · الرصيد الحالى · الملاحظات · الإجراءات.
 * لنا = مدين (adds to what he owes us), علينا = دائن; the running balance is the ledger's, computed before any filter.
 * Newest first; «رصيد أول المدة» of a chosen period stays last. Reads only.
 */
/** the ledger function returns + = مدين; the owner reads the opposite sign (دائن +، مدين −) */
const balText = (b: number) => (Math.abs(b) <= 0.005 ? "مسدد" : b > 0 ? "مدين" : "دائن");
// the amount only — مدين / دائن written next to it, no minus sign (owner 2026-11-12)
const signed = (b: number) => (Math.abs(b) <= 0.005 ? "0" : formatEGP(Math.abs(b)));
/** tag name of the printed sheet's table (a print window, not a screen table) */
const T = "table";
const timeText = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${String(((h + 11) % 12) + 1).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "ص" : "م"}`;
};
export const movementPath = (l: AccountMovement): string | null => {
  if (!l.branch_id || !l.src_id) return null;
  switch (l.src_table) {
    case "invoices": return `/branch/${l.branch_id}/sales/${l.src_id}`;
    case "shipments": return `/branch/${l.branch_id}/shipments/${l.src_id}`;
    case "vouchers": return `/branch/${l.branch_id}/vouchers/${l.src_id}`;
    case "returns": return `/branch/${l.branch_id}/sale-returns/${l.src_id}`;
    case "purchase_returns": return `/branch/${l.branch_id}/purchase-returns/${l.src_id}`;
    default: return null;
  }
};

/** Which print layout a line uses; a voucher is a receipt when it lowers the balance (علينا) and a payment when it raises it (لنا). */
const printKind = (l: AccountMovement): BulkKind | null =>
  l.src_table === "invoices" ? "sale" : l.src_table === "shipments" ? "purchase" : l.src_table === "returns" ? "sale_return"
  : l.src_table === "purchase_returns" ? "purchase_return" : l.src_table === "vouchers" ? (l.credit > 0 ? "income" : "expense") : null;

/** Cancelled straight from the table: vouchers and returns (their own cancel path, a reversal — never a delete). An invoice asks about its money, so it is cancelled from inside the invoice. */
const directCancel = (l: AccountMovement) => l.src_table === "vouchers" || l.src_table === "returns" || l.src_table === "purchase_returns";

export function ContactMovements({ contactId, contactName, branchId, scopeName, reloadKey }: {
  contactId: string; contactName: string; branchId: string | null; scopeName: string; reloadKey?: unknown;
}) {
  const nav = useNavigate();
  const [lines, setLines] = useState<AccountMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [view, setView] = useState<AccountMovement[] | null>(null);
  const [cancelRows, setCancelRows] = useState<AccountMovement[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setLines(await fetchContactAccountMovements(contactId, branchId, from || null, to || null)); setPicked(new Set()); }
    catch (e: any) { setLines([]); setError(e?.message ?? "تعذر تحميل الحركات"); }
    finally { setLoading(false); }
  }, [contactId, branchId, from, to]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const opening = lines.find((l) => l.line_no === 0) ?? null;
  const body = useMemo(() => lines.filter((l) => l.line_no !== 0).reverse(), [lines]);
  const rows = useMemo(() => (opening ? [...body, opening] : body), [body, opening]);
  const shown = view ?? rows;
  const totals = useMemo(() => {
    const src = shown.filter((l) => l.line_no !== 0);
    return { debit: src.reduce((s, l) => s + l.debit, 0), credit: src.reduce((s, l) => s + l.credit, 0) };
  }, [shown]);
  const chosen = useMemo(() => shown.filter((l) => picked.has(l.line_no)), [shown, picked]);
  const allPicked = body.length > 0 && body.every((l) => picked.has(l.line_no));
  const toggle = (no: number) => setPicked((p) => { const n = new Set(p); if (n.has(no)) n.delete(no); else n.add(no); return n; });

  const asRows = (list: AccountMovement[]) => list.map((l) => ({
    "التاريخ": l.line_date ? formatDate(l.line_date) : "", "الوقت": l.line_time ? timeText(l.line_time) : "", "رقم الحركة": l.reference ?? "",
    "الحركة": l.line_type, "الفرع": l.branch_name ?? "", "لنا": l.debit || "", "علينا": l.credit || "",
    "الرصيد الحالى": Math.abs(l.balance), "طبيعة الرصيد": balText(l.balance), "الملاحظات": l.notes ?? "",
  }));
  const exportList = (list: AccountMovement[]) => exportToExcel(`حركات_${contactName}_${scopeName}`, [{ name: "الحركات", rows: asRows(list.slice().reverse()) }]);
  const printList = (list: AccountMovement[]) => {
    const tr = list.slice().reverse().map((l) => `<tr><td>${l.line_date ? formatDate(l.line_date) : ""}</td><td>${l.line_time ? timeText(l.line_time) : ""}</td><td>${l.reference ?? ""}</td><td>${l.line_type}</td>
      <td>${l.debit ? formatEGP(l.debit) : "—"}</td><td>${l.credit ? formatEGP(l.credit) : "—"}</td><td><b dir="ltr">${signed(l.balance)}</b> ${balText(l.balance)}</td><td>${l.notes ?? ""}</td></tr>`).join("");
    printReport(`حركات ${contactName}`, `<h1>${contactName}</h1><div class="meta">${scopeName}${from || to ? ` · ${from || "البداية"} → ${to || "النهارده"}` : ""}</div>
      <${T}><thead><tr><th>التاريخ</th><th>الوقت</th><th>رقم الحركة</th><th>الحركة</th><th>لنا</th><th>علينا</th><th>الرصيد الحالى</th><th>الملاحظات</th></tr></thead><tbody>${tr}</tbody></${T}>`, { landscape: true });
  };
  const runCancel = async () => {
    if (!cancelRows) return;
    setBusy(true);
    let ok = 0; const failed: string[] = [];
    for (const l of cancelRows) {
      const k = printKind(l);
      try { if (!k || !l.src_id) throw new Error("مالوش مستند"); await cancelDoc(k, { id: l.src_id }, reason.trim()); ok += 1; }
      catch (e: any) { failed.push(`${l.reference ?? l.line_type}: ${e?.message ?? "تعذر الإلغاء"}`); }
    }
    setBusy(false); setCancelRows(null); setReason("");
    if (ok) toast.success(`اتلغى ${ok} مستند — اتسجل عكسه والرصيد اتعدل`);
    if (failed.length) toast.error(failed.slice(0, 3).join(" · "));
    load();
  };
  const cancelChosen = () => {
    const can = chosen.filter(directCancel), rest = chosen.length - can.length;
    if (rest) toast.message(`${rest} فاتورة من المحدد بتتلغي من جواها (بتسأل عن فلوسها) — «فتح المحدد» بيفتحهم`);
    if (can.length) { setReason(""); setCancelRows(can); }
  };
  const openChosen = () => {
    const list = chosen.map((l) => ({ path: movementPath(l), label: l.reference ?? l.line_type })).filter((d): d is { path: string; label: string } => !!d.path);
    if (!list.length) return toast.error("الحركات المحددة ملهاش مستند يتفتح");
    openDocs(list);
    toast.success(`اتفتح ${list.length} مستند فوق`);
  };

  return (
    <div className="space-y-3" data-testid="account-movements">
      <div className="card-elevated p-3 flex flex-wrap items-end gap-3">
        <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        {(from || to) && <Button variant="outline" size="sm" onClick={() => { setFrom(""); setTo(""); }}><X className="w-4 h-4 ml-1" /> كل الفترة</Button>}
        <div className="mr-auto flex flex-wrap gap-4 text-sm">
          <span>لنا: <b className="tabular-nums">{formatEGP(totals.debit)}</b></span>
          <span>علينا: <b className="tabular-nums">{formatEGP(totals.credit)}</b></span>
          <span>عدد الحركات: <b>{shown.filter((l) => l.line_no !== 0).length}</b></span>
        </div>
        <Button variant="outline" size="sm" onClick={() => printList(shown)}><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
        <Button variant="outline" size="sm" onClick={() => exportList(shown)}><Download className="w-4 h-4 ml-1" /> Excel</Button>
      </div>

      {picked.size > 0 && (
        <div className="card-elevated p-2 flex flex-wrap items-center gap-2 border-primary/40 bg-primary/5 text-sm" data-testid="movements-selection">
          <b>{picked.size} محدد</b>
          <Button size="sm" variant="outline" onClick={openChosen} title="بيفتح كل مستند محدد كتاب فوق — التعديل والإلغاء من جوه كل مستند"><ExternalLink className="w-4 h-4 ml-1" /> فتح المحدد (تعديل / إلغاء)</Button>
          <Button size="sm" variant="outline" onClick={() => printList(chosen)}><Printer className="w-4 h-4 ml-1" /> طباعة المحدد</Button>
          <Button size="sm" variant="outline" onClick={() => exportList(chosen)}><Download className="w-4 h-4 ml-1" /> تصدير المحدد</Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={cancelChosen}><Trash2 className="w-4 h-4 ml-1" /> إلغاء المحدد</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>شيل التحديد</Button>
        </div>
      )}

      <Dialog open={!!cancelRows} onOpenChange={(o) => { if (!o && !busy) setCancelRows(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>إلغاء {cancelRows?.length === 1 ? (cancelRows[0].reference ?? cancelRows[0].line_type) : `${cancelRows?.length ?? 0} مستند`}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">مفيش حاجة بتتمسح: بيتسجل عكس الحركة في الخزنة والدفاتر، والرصيد بيتعدل، والمستند بيفضل ظاهر «ملغي».</p>
          <Textarea placeholder="سبب الإلغاء (5 حروف على الأقل)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setCancelRows(null)}>رجوع</Button>
            <Button variant="destructive" disabled={busy || reason.trim().length < 5} onClick={runCancel}>{busy ? "بلغي…" : "تأكيد الإلغاء"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && (
        <div className="card-elevated p-3 text-sm text-destructive flex items-center justify-between gap-2">
          <span>تعذر تحميل الحركات: {error}</span><Button size="sm" variant="outline" onClick={load}>إعادة المحاولة</Button>
        </div>
      )}

      <DataTable
        loading={loading}
        rows={rows}
        onView={setView as any}
        indexColumn
        pageSize={50}
        permTable="moves"
        getRowKey={(l: AccountMovement) => String(l.line_no)}
        empty="لا توجد حركات"
        onRowClick={(l: AccountMovement) => { const p = movementPath(l); if (p) nav(p); }}
        columns={[
          { key: "sel", header: "التحديد", filter: false, render: (l: AccountMovement) => (l.line_no === 0 ? null : (
            <input type="checkbox" aria-label="تحديد الحركة" className="h-4 w-4 cursor-pointer" checked={picked.has(l.line_no)}
              onClick={(e) => e.stopPropagation()} onChange={() => toggle(l.line_no)} />
          )) },
          { key: "date", header: "التاريخ", render: (l: AccountMovement) => (l.line_date ? formatDate(l.line_date) : "—") },
          { key: "time", header: "الوقت", render: (l: AccountMovement) => <span className="tabular-nums text-xs">{timeText(l.line_time)}</span> },
          { key: "ref", header: "رقم الحركة", render: (l: AccountMovement) => <span className="font-mono text-xs">{l.reference ?? "—"}</span> },
          { key: "type", header: "الحركة", render: (l: AccountMovement) => <span className={l.line_no === 0 ? "font-bold" : ""}>{l.line_type}{branchId ? "" : l.branch_name ? <span className="text-[10px] text-muted-foreground"> · {l.branch_name}</span> : null}</span> },
          { key: "debit", header: "لنا", render: (l: AccountMovement) => (l.debit ? <span className="font-semibold tabular-nums">{formatEGP(l.debit)}</span> : "—") },
          { key: "credit", header: "علينا", render: (l: AccountMovement) => (l.credit ? <span className="font-semibold tabular-nums">{formatEGP(l.credit)}</span> : "—") },
          { key: "balance", header: "الرصيد الحالى", render: (l: AccountMovement) => (
            <span className="font-bold tabular-nums"><span dir="ltr">{signed(l.balance)}</span> <span className={`text-[10px] ${l.balance > 0.005 ? "text-success" : l.balance < -0.005 ? "text-destructive" : "text-muted-foreground"}`}>{balText(l.balance)}</span></span>
          ) },
          { key: "notes", header: "الملاحظات", render: (l: AccountMovement) => <span className="text-xs text-muted-foreground" title={l.notes ?? ""}>{l.notes ? (l.notes.length > 60 ? l.notes.slice(0, 60) + "…" : l.notes) : "—"}</span> },
          { key: "act", header: "الإجراءات", filter: false, render: (l: AccountMovement) => {
            const p = movementPath(l), k = printKind(l);
            if (!p) return null;
            return (
              <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                {k && l.src_id && <PrintDocButton kind={k} id={l.src_id} />}
                <Button size="icon" variant="ghost" className="h-7 w-7" title="تعديل: بيفتح المستند — المالك بيعدّل مباشرة وغيره بيبعت طلب موافقة" aria-label="تعديل"
                  onClick={() => nav(p)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="إلغاء"
                  title={directCancel(l) ? "إلغاء (بيتسجل عكسه)" : "إلغاء الفاتورة من جواها — بتسأل عن فلوسها"}
                  onClick={() => { if (directCancel(l)) { setReason(""); setCancelRows([l]); } else nav(p); }}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            );
          } },
        ]}
        footer={body.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(body.map((l) => l.line_no)))} /> تحديد كل الحركات
          </label>
        ) : undefined}
      />
    </div>
  );
}
