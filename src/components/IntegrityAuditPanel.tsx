import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/DataTable";
import { fetchIntegrityAudit, type IntegrityFinding } from "@/lib/ledger";
import { exportToExcel } from "@/lib/export";
import { formatEGP } from "@/lib/format";
import { Loader2, RefreshCcw, ShieldCheck, Download } from "lucide-react";

/**
 * Automatic data-integrity checks (Step 6C, read-only — nothing is changed by running them):
 *   opening / ledger: opening balance vs on-account money and payments across branches, duplicates,
 *                     advances left next to open debt, money that crossed branches (1910), sync errors;
 *   documents:        totals vs lines, returns vs sold / bought quantities, returns on cancelled documents,
 *                     cancelled invoices that kept money;
 *   treasury / stock / journal: vouchers vs till rows, till vs cash accounts, open inter-branch transfers,
 *                     stock vs batches and movement log, cancelled documents still in the journal.
 */
const AREA_LABEL: Record<string, string> = {
  opening: "أرصدة افتتاحية", ledger: "الدفتر الموحد", documents: "المستندات", treasury: "الخزنة", stock: "المخزون", journal: "القيود",
};
const SEV: Record<string, { t: string; c: string }> = {
  error: { t: "خطأ", c: "bg-destructive/15 text-destructive" },
  warning: { t: "تنبيه", c: "bg-warning/15 text-warning" },
  info: { t: "معلومة", c: "bg-muted text-muted-foreground" },
};

export function IntegrityAuditPanel() {
  const nav = useNavigate();
  const [rows, setRows] = useState<IntegrityFinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState<string>("all");
  const [sev, setSev] = useState<string>("all");
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchIntegrityAudit());
      setRanAt(new Date());
    } catch (e: any) {
      setError(e?.message ?? "تعذر تشغيل الفحص");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { run(); }, []);

  const counts = useMemo(() => ({
    error: rows.filter((r) => r.severity === "error").length,
    warning: rows.filter((r) => r.severity === "warning").length,
    info: rows.filter((r) => r.severity === "info").length,
  }), [rows]);
  const shown = useMemo(() => rows
    .filter((r) => (area === "all" || r.area === area) && (sev === "all" || r.severity === sev))
    .sort((a, b) => ["error", "warning", "info"].indexOf(a.severity) - ["error", "warning", "info"].indexOf(b.severity) || a.check_code.localeCompare(b.check_code)),
  [rows, area, sev]);

  const open = (r: IntegrityFinding) => {
    // opening balances not in the books → the opening balances screen, contacts tab
    if (r.check_code === "G7") return nav("/admin/accounting/opening-balances?section=contacts");
    // books vs ledger, duplicated fees → the reconciliation panel on this page
    if (r.check_code.startsWith("G") || r.check_code === "F1" || r.check_code.startsWith("T3")) {
      document.getElementById("books")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (r.doc_type === "invoice" && r.doc_id && r.branch_id) return nav(`/branch/${r.branch_id}/sales/${r.doc_id}`);
    if (r.doc_type === "shipment" && r.doc_id && r.branch_id) return nav(`/branch/${r.branch_id}/shipments/${r.doc_id}`);
    if (r.contact_id) return nav(`/admin/contacts/${r.contact_id}`);
  };

  const [view, setView] = useState<any[] | null>(null); // what the column filters leave (Excel filters), for the exports
  return (
    <div className="rounded-2xl border p-4 space-y-3" id="integrity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <div>
            <div className="font-bold">فحص سلامة البيانات (الأرصدة والمستندات والخزنة والمخزون)</div>
            <div className="text-xs text-muted-foreground">قراءة بس — الفحص ما بيعدلش أي حاجة. {ranAt ? `آخر تشغيل: ${ranAt.toLocaleTimeString("ar-EG")}` : ""}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportToExcel("فحص_سلامة_البيانات", [{ name: "النتائج", rows: (view ?? shown).map((r: any) => ({
            الكود: r.check_code, الدرجة: SEV[r.severity]?.t ?? r.severity, المجال: AREA_LABEL[r.area] ?? r.area, البند: r.title, التفاصيل: r.details ?? "",
            الجهة: r.contact_name ?? "", الفرع: r.branch_name ?? "", المستند: r.doc_number ?? "", المبلغ: r.amount ?? "",
          })) }])} disabled={!rows.length}><Download className="w-4 h-4 ml-1" /> Excel</Button>
          <Button size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCcw className="w-4 h-4 ml-1" />} افحص دلوقتي
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {(["all", "error", "warning", "info"] as const).map((k) => (
          <Button key={k} size="sm" variant={sev === k ? "default" : "outline"} onClick={() => setSev(k)}>
            {k === "all" ? `الكل (${rows.length})` : `${SEV[k].t} (${counts[k]})`}
          </Button>
        ))}
        <span className="mx-2 border-r" />
        {(["all", "opening", "ledger", "documents", "treasury", "stock", "journal"] as const).map((k) => (
          <Button key={k} size="sm" variant={area === k ? "default" : "ghost"} onClick={() => setArea(k)}>
            {k === "all" ? "كل المجالات" : AREA_LABEL[k]}
          </Button>
        ))}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}
      {!error && !loading && rows.length === 0 && (
        <div className="text-sm text-success font-semibold">✓ مفيش أي ملاحظات — الأرصدة والمستندات متطابقة.</div>
      )}

      {rows.length > 0 && (
        <DataTable
          loading={loading}
          rows={shown}
          onView={setView}
          onRowClick={open}
          empty="مفيش ملاحظات في الفلتر ده"
          columns={[
            { key: "sev", header: "الدرجة", render: (r: IntegrityFinding) => <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEV[r.severity]?.c ?? ""}`}>{SEV[r.severity]?.t ?? r.severity}</span> },
            { key: "code", header: "الكود", render: (r: IntegrityFinding) => <Badge variant="outline" className="font-mono">{r.check_code}</Badge> },
            { key: "area", header: "المجال", render: (r: IntegrityFinding) => AREA_LABEL[r.area] ?? r.area },
            { key: "title", header: "البند", render: (r: IntegrityFinding) => <div><div className="font-semibold">{r.title}</div><div className="text-xs text-muted-foreground">{r.details}</div></div> },
            { key: "who", header: "الجهة / الفرع", render: (r: IntegrityFinding) => <div className="text-xs">{r.contact_name ?? "—"}<div className="text-muted-foreground">{r.branch_name ?? ""}</div></div> },
            { key: "doc", header: "المستند", render: (r: IntegrityFinding) => <span className="font-mono text-xs">{r.doc_number ?? "—"}</span> },
            { key: "amt", header: "المبلغ", render: (r: IntegrityFinding) => (r.amount == null ? "—" : formatEGP(r.amount)) },
          ]}
        />
      )}
    </div>
  );
}
