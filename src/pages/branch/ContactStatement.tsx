import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BranchLayout, AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { exportToExcel, printReport } from "@/lib/export";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ArrowRight, Download, Printer } from "lucide-react";
import { fetchContactLedger, filterLedgerByBranches, withRunningBalance, ledgerSum, type LedgerRow } from "@/lib/contactLedger";

type Row = LedgerRow;

export default function ContactStatement() {
  const params = useParams<{ id: string; contactId: string }>();
  const branchId = params.id;
  const contactId = params.contactId!;
  const nav = useNavigate();
  const isAdminView = !branchId;
  const Layout = isAdminView ? AdminLayout : BranchLayout;
  const [sp] = useSearchParams();
  const branchesParam = sp.get("branches") ?? "";
  const selBranches = useMemo(() => branchesParam.split(",").filter(Boolean), [branchesParam]);
  const [branchNames, setBranchNames] = useState<string>("");
  useEffect(() => {
    if (!selBranches.length) { setBranchNames(""); return; }
    supabase.from("branches").select("name").in("id", selBranches).then(({ data }) =>
      setBranchNames((data ?? []).map((b: any) => b.name).join("، ")));
  }, [selBranches]);

  const [contact, setContact] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const load = async () => {
    setLoading(true);
    const l = await fetchContactLedger(contactId);
    const scoped = filterLedgerByBranches(l.rows, selBranches);
    const bal = selBranches.length ? ledgerSum(scoped) : l.totalBalance;
    setContact(l.contact ? { ...l.contact, balance: bal } : l.contact);
    setRows(withRunningBalance(scoped).reverse() as Row[]);
    setLoading(false);
  };


  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId, branchesParam]);
  useRealtimeRefresh(
    ["invoices", "invoice_payments", "returns", "shipments", "supplier_payments", "purchase_returns", "vouchers", "contacts"],
    load
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (fromDate && new Date(r.date) < new Date(fromDate)) return false;
      if (toDate && new Date(r.date) > new Date(toDate + "T23:59:59")) return false;
      return true;
    });
  }, [rows, fromDate, toDate]);

  const totals = useMemo(() => {
    const d = filtered.reduce((s, r) => s + r.debit, 0);
    const c = filtered.reduce((s, r) => s + r.credit, 0);
    return { debit: d, credit: c, net: d - c };
  }, [filtered]);

  const finalBalance = Number(contact?.balance ?? 0);

  const exportExcel = () => {
    const sheet = filtered.map((r) => ({
      "التاريخ": formatDate(r.date),
      "النوع": r.type,
      "المرجع": r.reference,
      "التفاصيل": r.description,
      "مدين (له علينا)": r.debit || "",
      "دائن (عليه لنا)": r.credit || "",
      "الرصيد": r.balance ?? 0,
    }));
    exportToExcel(`كشف_حساب_${contact?.name ?? contactId}${branchNames ? "_" + branchNames : ""}`, [
      { name: "ملخص", rows: [{ البيان: "الفرع", القيمة: branchNames || "كل الفروع" }, { البيان: "صافي الرصيد", القيمة: finalBalance }] },
      { name: "كشف الحساب", rows: sheet },
    ]);
  };

  const printPdf = () => {
    const rowsHtml = filtered.map((r) => `
      <tr>
        <td>${formatDate(r.date)}</td>
        <td>${r.type}</td>
        <td>${r.reference}</td>
        <td>${r.description}</td>
        <td>${r.debit ? formatEGP(r.debit) : "—"}</td>
        <td>${r.credit ? formatEGP(r.credit) : "—"}</td>
        <td><b class="${(r.balance ?? 0) >= 0 ? "pos" : "neg"}">${formatEGP(r.balance ?? 0)}</b></td>
      </tr>`).join("");
    const html = `
      <h1>كشف حساب: ${contact?.name ?? "—"}</h1>
      <div class="meta">النوع: ${contact?.type ?? "—"} · الهاتف: ${contact?.phone ?? "—"} · الفرع: ${branchNames || "كل الفروع"}</div>
      <div class="kpi">
        <div><span class="muted">إجمالي مدين</span><b>${formatEGP(totals.debit)}</b></div>
        <div><span class="muted">إجمالي دائن</span><b>${formatEGP(totals.credit)}</b></div>
        <div><span class="muted">صافي الرصيد</span><b class="${finalBalance >= 0 ? "pos" : "neg"}">${formatEGP(finalBalance)}</b></div>
      </div>
      <table>
        <thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>التفاصيل</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p class="muted">ملاحظة: الرصيد الموجب = عليه فلوس لنا، السالب = إحنا علينا فلوس له.</p>
    `;
    printReport(`كشف حساب - ${contact?.name ?? ""}`, html, { landscape: true });
  };

  return (
    <Layout>
      <PageHeader
        title={`كشف حساب: ${contact?.name ?? "..."}`}
        subtitle={contact ? `${contact.type === "customer" ? "عميل" : contact.type === "supplier" ? "مورد" : "عميل ومورد"} · ${contact.phone ?? ""} · الفرع: ${branchNames || "كل الفروع"}` : ""}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => nav(-1)}><ArrowRight className="w-4 h-4 ml-1" /> رجوع</Button>
            <Button variant="outline" onClick={exportExcel}><Download className="w-4 h-4 ml-1" /> Excel</Button>
            <Button onClick={printPdf}><Printer className="w-4 h-4 ml-1" /> طباعة / PDF</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">إجمالي المدين</div>
          <div className="text-xl font-bold mt-1">{formatEGP(totals.debit)}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">إجمالي الدائن</div>
          <div className="text-xl font-bold mt-1">{formatEGP(totals.credit)}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">عدد الحركات</div>
          <div className="text-xl font-bold mt-1">{filtered.length}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">الرصيد الحالي</div>
          <div className={`text-xl font-bold mt-1 ${finalBalance >= 0 ? "text-success" : "text-destructive"}`}>
            {formatEGP(finalBalance)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {finalBalance > 0.01 ? "له علينا" : finalBalance < -0.01 ? "علينا له" : "مستوي"}
          </div>
        </div>
      </div>

      <div className="card-elevated p-4 mb-4 flex gap-3 flex-wrap items-end">
        <div>
          <Label className="text-xs">من تاريخ</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">إلى تاريخ</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
        </div>
        {(fromDate || toDate) && (
          <Button variant="outline" size="sm" onClick={() => { setFromDate(""); setToDate(""); }}>مسح</Button>
        )}
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        onRowClick={(r: Row) => { if (r.link) nav(r.link); }}
        empty="لا توجد حركات"
        columns={[
          { key: "date", header: "التاريخ", render: (r: Row) => formatDate(r.date) },
          { key: "type", header: "النوع" },
          { key: "reference", header: "المرجع", render: (r: Row) => <span className="font-mono text-xs">{r.reference}</span> },
          { key: "description", header: "التفاصيل" },
          { key: "debit", header: "مدين", render: (r: Row) => r.debit ? <span className="text-success font-semibold">{formatEGP(r.debit)}</span> : "—" },
          { key: "credit", header: "دائن", render: (r: Row) => r.credit ? <span className="text-destructive font-semibold">{formatEGP(r.credit)}</span> : "—" },
          { key: "balance", header: "الرصيد", render: (r: Row) => (
            <span className={`font-bold ${(r.balance ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
              {formatEGP(r.balance ?? 0)}
            </span>
          )},
        ]}
      />
    </Layout>
  );
}
