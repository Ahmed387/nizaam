import { useTableViews } from "@/hooks/useListFilter";
import { useEffect, useState } from "react";
import { PermCard } from "@/contexts/PermCustomize";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { fetchGlReconciliation, fetchDuplicateFees, repairDuplicateFees, type GlReconciliation, type DuplicateFeeRow } from "@/lib/ledger";
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
 *   - current account (0212 / 0213): per branch, customers − suppliers in the books (1200 − 2100) against the
 *     accounts' balances, and the old advance pools 2150 / 1460, which must stay 0.
 */
const ok = (v: number) => Math.abs(v) <= 0.05;

export function GlReconciliationPanel() {
  const nav = useNavigate();
  // what each table shows after its Excel filters: the Excel sheets export that
  const [views, onView] = useTableViews<"branches">();
  const [gl, setGl] = useState<GlReconciliation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fees, setFees] = useState<DuplicateFeeRow[]>([]);
  const [feeBusy, setFeeBusy] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      // each part on its own: a failure of one never hides the other
      const [g, f] = await Promise.allSettled([fetchGlReconciliation(), fetchDuplicateFees()]);
      if (g.status === "fulfilled") setGl(g.value);
      if (f.status === "fulfilled") setFees(f.value.filter((x) => !x.already_corrected));
      const err = [g].find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
      if (err) setError((err.reason as any)?.message ?? "تعذر تحميل جزء من المطابقة");
    } catch (e: any) {
      setError(e?.message ?? "تعذر تحميل المطابقة");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { run(); }, []);


  return (
    <div className="rounded-2xl border p-4 space-y-4" id="books">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-primary" />
          <div>
            <div className="font-bold">مطابقة القيود مع الخزن والدفتر الموحد</div>
            <div className="text-xs text-muted-foreground">من 1 يناير 2026 — قراءة بس. فلوس العملاء والموردين بتتقيد على حساباتهم مباشرة (حساب جاري)، والتحويلات بين الفروع على حساب جاري الفروع 1910.</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!gl} onClick={() => gl && exportToExcel("مطابقة_القيود", [
            { name: "الفروع", rows: (views.branches ?? gl.branches).map((b: any) => ({ الفرع: b.branch, الخزنة: b.till, "النقدية في القيود": b.gl_cash, الفرق: b.difference,
              "حسابات العملاء والموردين (القيود)": b.accounts_gl, "أرصدة الحسابات": b.accounts_ledger, "فرق الحسابات": b.accounts_difference, "حساب جاري الفروع 1910": b.inter_branch_1910 })) },
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
            <PermCard label="حساب جاري الفروع 1910 (الشركة)"><div className={`rounded-lg border p-3 ${ok(gl.inter_branch_1910_total) ? "" : "border-destructive/50 bg-destructive/5"}`}>
              <div className="text-xs text-muted-foreground">حساب جاري الفروع 1910 (الشركة)</div>
              <div className="text-lg font-bold">{formatEGP(gl.inter_branch_1910_total)}</div>
              <div className="text-[11px] text-muted-foreground">{ok(gl.inter_branch_1910_total) ? "✓ صفر زي ما لازم" : "لازم يكون صفر"}</div>
            </div></PermCard>
            <PermCard label="حسابات العملاء والموردين"><div className={`rounded-lg border p-3 ${ok(gl.accounts.gl - gl.accounts.ledger) ? "" : "border-destructive/50 bg-destructive/5"}`}>
              <div className="text-xs text-muted-foreground">حسابات العملاء والموردين (الصافي)</div>
              <div className="text-lg font-bold">{formatEGP(Math.abs(gl.accounts.ledger))} {gl.accounts.ledger >= 0 ? "مدين" : "دائن"}</div>
              <div className="text-[11px] text-muted-foreground">{ok(gl.accounts.gl - gl.accounts.ledger) ? "✓ القيود = أرصدة الحسابات" : `القيود: ${formatEGP(Math.abs(gl.accounts.gl))}`}</div>
            </div></PermCard>
            <PermCard label="حسابات المقدمات القديمة"><div className={`rounded-lg border p-3 ${ok(gl.pools["2150"]) && ok(gl.pools["1460"]) ? "" : "border-destructive/50 bg-destructive/5"}`}>
              <div className="text-xs text-muted-foreground">حسابات المقدمات القديمة</div>
              <div className="text-lg font-bold">{formatEGP(Math.abs(gl.pools["2150"]) + Math.abs(gl.pools["1460"]))}</div>
              <div className="text-[11px] text-muted-foreground">{ok(gl.pools["2150"]) && ok(gl.pools["1460"]) ? "✓ صفر — الفلوس على الحسابات مباشرة" : "لازم تكون صفر"}</div>
            </div></PermCard>
            <PermCard label="حركات من غير قيد / قيود قديمة قايمة"><div className={`rounded-lg border p-3 ${gl.not_posted.movements + gl.old_entries_still_standing === 0 ? "" : "border-destructive/50 bg-destructive/5"}`}>
              <div className="text-xs text-muted-foreground">حركات من غير قيد / قيود قديمة قايمة</div>
              <div className="text-lg font-bold">{gl.not_posted.movements} / {gl.old_entries_still_standing}</div>
              <div className="text-[11px] text-muted-foreground">قيود قديمة اتعكست: {gl.retired_old_entries}{gl.not_posted.closed_period_skipped ? ` · في فترات مقفولة: ${gl.not_posted.closed_period_skipped}` : ""}</div>
            </div></PermCard>
          </div>

          <DataTable
            onView={onView("branches")}
            rows={gl.branches}
            empty="مفيش حركة"
            onRowClick={(r: any) => nav(`/admin/branches/${r.branch_id}`)}
            columns={[
              { key: "b", header: "الفرع", render: (r: any) => <b>{r.branch}</b> },
              { key: "t", header: "رصيد الخزنة", render: (r: any) => formatEGP(r.till) },
              { key: "g", header: "النقدية في القيود (11xx)", render: (r: any) => formatEGP(r.gl_cash) },
              { key: "d", header: "الفرق", render: (r: any) => <span className={ok(r.difference) ? "text-success" : "text-destructive font-bold"}>{ok(r.difference) ? "✓ متطابق" : formatEGP(r.difference)}</span> },
              { key: "acc", header: "حسابات العملاء والموردين", render: (r: any) => (
                <span className={ok(r.accounts_difference) ? "" : "text-destructive font-bold"} title={`القيود ${formatEGP(r.accounts_gl)} / أرصدة الحسابات ${formatEGP(r.accounts_ledger)}`}>
                  {ok(r.accounts_difference) ? `✓ ${formatEGP(Math.abs(r.accounts_ledger))} ${r.accounts_ledger >= 0 ? "مدين" : "دائن"}` : `فرق ${formatEGP(r.accounts_difference)}`}
                </span>) },
              { key: "x", header: "حساب جاري الفروع 1910", render: (r: any) => (
                <span title="موجب = ليه عند فروع تانية (اتحصل له في فرع تاني) · سالب = عليه لفروع تانية (حصّل فلوس لفرع تاني)">
                  {Math.abs(r.inter_branch_1910) < 0.005 ? "—" : `${formatEGP(Math.abs(r.inter_branch_1910))} ${r.inter_branch_1910 > 0 ? "ليه" : "عليه"}`}
                </span>) },
            ]}
          />

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
