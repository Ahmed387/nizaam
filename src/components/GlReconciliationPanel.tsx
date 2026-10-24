import { useEffect, useState } from "react";
import { PermTable } from "@/components/PermTable";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { fetchGlReconciliation, fetchOpeningReconciliation, fetchDuplicateFees, repairDuplicateFees, type GlReconciliation, type OpeningReconRow, type DuplicateFeeRow } from "@/lib/ledger";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { exportToExcel } from "@/lib/export";
import { Loader2, RefreshCcw, Scale, Download } from "lucide-react";

/**
 * Books vs ledger (Step 6D, read-only). From 1 Jan 2026:
 *   - every branch's till against its cash accounts in the journal (they match when every customer /
 *     supplier payment is booked in the branch that received or paid it);
 *   - the inter-branch current account 1910 (money received in one branch for another branch's invoice)
 *     per branch, and its company total, which must be zero;
 *   - customer advances (2150) and our advances with suppliers (1460) against the ledger;
 *   - opening balances: the ledger's opening amounts against the opening entries, and per contact.
 */
const ok = (v: number) => Math.abs(v) <= 0.05;

export function GlReconciliationPanel() {
  const nav = useNavigate();
  const [gl, setGl] = useState<GlReconciliation | null>(null);
  const [opening, setOpening] = useState<OpeningReconRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOpening, setShowOpening] = useState(false);
  const [fees, setFees] = useState<DuplicateFeeRow[]>([]);
  const [feeBusy, setFeeBusy] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      // each part on its own: a failure of one never hides the other
      const [g, o, f] = await Promise.allSettled([fetchGlReconciliation(), fetchOpeningReconciliation(), fetchDuplicateFees()]);
      if (g.status === "fulfilled") setGl(g.value);
      if (o.status === "fulfilled") setOpening(o.value);
      if (f.status === "fulfilled") setFees(f.value.filter((x) => !x.already_corrected));
      const err = [g, o].find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
      if (err) setError((err.reason as any)?.message ?? "تعذر تحميل جزء من المطابقة");
    } catch (e: any) {
      setError(e?.message ?? "تعذر تحميل المطابقة");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { run(); }, []);

  const openingAccounts: { code: string; label: string }[] = [
    { code: "1200", label: "مديونية عملاء (1200)" },
    { code: "2150", label: "مقدمات عملاء (2150)" },
    { code: "2100", label: "مستحقات موردين (2100)" },
    { code: "1460", label: "مقدماتنا عند الموردين (1460)" },
  ];
  const openingIssues = opening.filter((r) => r.status !== "ok");

  return (
    <div className="rounded-2xl border p-4 space-y-4" id="books">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-primary" />
          <div>
            <div className="font-bold">مطابقة القيود مع الخزن والدفتر الموحد</div>
            <div className="text-xs text-muted-foreground">من 1 يناير 2026 — قراءة بس. فلوس العملاء والموردين بتتقيد من الدفتر الموحد، والفلوس اللي بتعدّي بين الفروع بتتقيد على الحساب الجاري 1910.</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!gl} onClick={() => gl && exportToExcel("مطابقة_القيود", [
            { name: "الفروع", rows: gl.branches.map((b) => ({ الفرع: b.branch, الخزنة: b.till, "النقدية في القيود": b.gl_cash, الفرق: b.difference, "حساب جاري الفروع 1910": b.inter_branch_1910 })) },
            { name: "الأرصدة الافتتاحية", rows: opening.map((r) => ({ الجهة: r.contact_name, الحساب: r.side === "customer" ? "عميل" : "مورد",
              "الرصيد الافتتاحي": r.opening_in_contact, "في الدفتر": r.opening_in_ledger, "الرصيد المسبق القديم": r.old_prepaid_credit ?? "",
              "المقدم الحالي": r.ledger_advance_now, الحالة: r.status })) },
          ])}><Download className="w-4 h-4 ml-1" /> Excel</Button>
          <Button size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCcw className="w-4 h-4 ml-1" />} تحديث
          </Button>
        </div>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {gl && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div className={`rounded-lg border p-3 ${ok(gl.inter_branch_1910_total) ? "" : "border-destructive/50 bg-destructive/5"}`}>
              <div className="text-xs text-muted-foreground">حساب جاري الفروع 1910 (الشركة)</div>
              <div className="text-lg font-bold">{formatEGP(gl.inter_branch_1910_total)}</div>
              <div className="text-[11px] text-muted-foreground">{ok(gl.inter_branch_1910_total) ? "✓ صفر زي ما لازم" : "لازم يكون صفر"}</div>
            </div>
            <div className={`rounded-lg border p-3 ${ok(gl.customer_advances.ledger - gl.customer_advances.gl_2150) ? "" : "border-warning/50 bg-warning/5"}`}>
              <div className="text-xs text-muted-foreground">مقدمات العملاء</div>
              <div className="text-lg font-bold">{formatEGP(gl.customer_advances.ledger)}</div>
              <div className="text-[11px] text-muted-foreground">القيود (2150): {formatEGP(gl.customer_advances.gl_2150)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${ok(gl.supplier_advances.ledger - gl.supplier_advances.gl_1460) ? "" : "border-warning/50 bg-warning/5"}`}>
              <div className="text-xs text-muted-foreground">مقدماتنا عند الموردين</div>
              <div className="text-lg font-bold">{formatEGP(gl.supplier_advances.ledger)}</div>
              <div className="text-[11px] text-muted-foreground">القيود (1460): {formatEGP(gl.supplier_advances.gl_1460)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${gl.not_posted.movements + gl.not_posted.allocations + gl.old_entries_still_standing === 0 ? "" : "border-destructive/50 bg-destructive/5"}`}>
              <div className="text-xs text-muted-foreground">حركات من غير قيد / قيود قديمة قايمة</div>
              <div className="text-lg font-bold">{gl.not_posted.movements + gl.not_posted.allocations} / {gl.old_entries_still_standing}</div>
              <div className="text-[11px] text-muted-foreground">قيود قديمة اتعكست: {gl.retired_old_entries}{gl.not_posted.closed_period_skipped ? ` · في فترات مقفولة: ${gl.not_posted.closed_period_skipped}` : ""}</div>
            </div>
          </div>

          <DataTable
            rows={gl.branches}
            empty="مفيش حركة"
            onRowClick={(r: any) => nav(`/admin/branches/${r.branch_id}`)}
            columns={[
              { key: "b", header: "الفرع", render: (r: any) => <b>{r.branch}</b> },
              { key: "t", header: "رصيد الخزنة", render: (r: any) => formatEGP(r.till) },
              { key: "g", header: "النقدية في القيود (11xx)", render: (r: any) => formatEGP(r.gl_cash) },
              { key: "d", header: "الفرق", render: (r: any) => <span className={ok(r.difference) ? "text-success" : "text-destructive font-bold"}>{ok(r.difference) ? "✓ متطابق" : formatEGP(r.difference)}</span> },
              { key: "x", header: "حساب جاري الفروع 1910", render: (r: any) => (
                <span title="موجب = ليه عند فروع تانية (اتحصل له في فرع تاني) · سالب = عليه لفروع تانية (حصّل فلوس لفرع تاني)">
                  {Math.abs(r.inter_branch_1910) < 0.005 ? "—" : `${formatEGP(Math.abs(r.inter_branch_1910))} ${r.inter_branch_1910 > 0 ? "ليه" : "عليه"}`}
                </span>) },
            ]}
          />

          <div className="rounded-lg border">
            <div className="px-3 py-2 border-b bg-muted/40 text-sm font-bold flex items-center justify-between">
              <span>الأرصدة الافتتاحية: الدفتر مقابل القيود</span>
              <Button size="sm" variant="ghost" onClick={() => setShowOpening((x) => !x)}>
                {showOpening ? "إخفاء التفاصيل" : `تفاصيل الجهات (${opening.length})${openingIssues.length ? ` — ${openingIssues.length} محتاجين مراجعة` : ""}`}
              </Button>
            </div>
            <PermTable className="w-full text-sm">
              <thead><tr className="bg-muted/20"><th className="p-2 text-right">الحساب</th><th className="p-2 text-right">الدفتر الموحد</th><th className="p-2 text-right">قيد الرصيد الافتتاحي</th><th className="p-2 text-right">الحالة</th></tr></thead>
              <tbody>
                {openingAccounts.map((a) => {
                  const l = gl.opening?.ledger?.[a.code] ?? 0;
                  const j = gl.opening?.journal?.[a.code] ?? 0;
                  return (
                    <tr key={a.code} className="border-t">
                      <td className="p-2">{a.label}</td>
                      <td className="p-2 tabular-nums">{formatEGP(l)}</td>
                      <td className="p-2 tabular-nums">{formatEGP(j)}</td>
                      <td className="p-2">{ok(l - j) ? <span className="text-success">✓</span> : <span className="text-destructive font-semibold">فرق {formatEGP(l - j)} — <button className="underline" onClick={() => nav("/admin/accounting/opening-balances?section=contacts")}>طابقها من شاشة الأرصدة الافتتاحية</button></span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </PermTable>
            {showOpening && (
              <div className="p-2">
                <DataTable
                  rows={opening}
                  empty="مفيش أرصدة افتتاحية"
                  onRowClick={(r: OpeningReconRow) => nav(`/admin/contacts/${r.contact_id}`)}
                  columns={[
                    { key: "n", header: "الجهة", render: (r: OpeningReconRow) => <b>{r.contact_name}</b> },
                    { key: "s", header: "الحساب", render: (r: OpeningReconRow) => (r.side === "customer" ? "حساب العميل" : "حساب المورد") },
                    { key: "o", header: "الرصيد الافتتاحي", render: (r: OpeningReconRow) => formatEGP(r.opening_in_contact) },
                    { key: "l", header: "في الدفتر", render: (r: OpeningReconRow) => formatEGP(r.opening_in_ledger) },
                    { key: "c", header: "الرصيد المسبق القديم", render: (r: OpeningReconRow) => (r.old_prepaid_credit == null ? "—" : formatEGP(Math.abs(r.old_prepaid_credit))) },
                    { key: "a", header: "المقدم دلوقتي (الدفتر)", render: (r: OpeningReconRow) => formatEGP(r.ledger_advance_now) },
                    { key: "st", header: "الحالة", render: (r: OpeningReconRow) => (
                      r.status === "ok" ? <span className="text-success text-xs">✓</span>
                        : r.status === "ledger_differs" ? <span className="text-destructive text-xs font-bold">الدفتر مختلف عن الرصيد الافتتاحي</span>
                        : <span className="text-warning text-xs font-bold">الرصيد المسبق القديم كان مختلف — اتظبط على الدفتر</span>) },
                  ]}
                />
              </div>
            )}
          </div>
          {fees.length > 0 && (
            <div className="rounded-lg border border-warning/50 bg-warning/5 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <b>عمولات تحويل اتخصمت مرتين من الخزنة:</b> {fees.length} عمولة بإجمالي {formatEGP(fees.reduce((s, x) => s + x.amount, 0))}
                  <div className="text-xs text-muted-foreground">حصلت في دفعات خطط التقسيط وتعديلها قبل التحديث الأخير. التصحيح بيلغي السند المكرر بالطريقة العادية (حركة عكسية في الخزنة وقيد عكسي) ومفيش أي حذف؛ مصروف العمولة الحقيقي بيفضل.</div>
                </div>
                <Button size="sm" disabled={feeBusy} onClick={async () => {
                  const total = fees.reduce((s, x) => s + x.amount, 0);
                  if (!window.confirm(`هيتلغي ${fees.length} سند عمولة مكرر بإجمالي ${formatEGP(total)} (حركة عكسية في الخزنة وقيد عكسي، من غير حذف). متأكد؟`)) return;
                  setFeeBusy(true);
                  try {
                    const r = await repairDuplicateFees(true);
                    toast.success(`اتصححت ${r.count} عمولة بإجمالي ${formatEGP(r.amount)}`, (r.skipped || r.skippedClosed) ? { description: `${r.skippedClosed ? `${r.skippedClosed} في فترة مقفولة اتسابت زي ما هي` : ""}${r.skipped && r.skippedClosed ? " • " : ""}${r.skipped ? `${r.skipped} من غير سند أو اتصححت من مستخدم تاني` : ""}` } : undefined);
                    await run();
                  } catch (e: any) {
                    toast.error(e?.message ?? "تعذر التصحيح");
                  } finally {
                    setFeeBusy(false);
                  }
                }}>{feeBusy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : null} صحّح العمولات المكررة</Button>
              </div>
              <div className="text-xs text-muted-foreground">{fees.slice(0, 10).map((x) => `${x.voucher_number ?? "—"} (${x.branch_name}) ${formatEGP(x.amount)}`).join(" · ")}{fees.length > 10 ? " …" : ""}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
