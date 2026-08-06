import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

type Row = {
  date: string;
  type: string;
  reference: string;
  description: string;
  debit: number;  // عليه (له علينا) / زيادة في رصيد العميل لصالحنا
  credit: number; // له (لنا عنده)
  balance?: number;
  link?: string;
};

export default function ContactStatement() {
  const params = useParams<{ id: string; contactId: string }>();
  const branchId = params.id;
  const contactId = params.contactId!;
  const nav = useNavigate();
  const isAdminView = !branchId;
  const Layout = isAdminView ? AdminLayout : BranchLayout;

  const [contact, setContact] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const load = async () => {
    setLoading(true);
    const { data: c } = await supabase.from("contacts").select("*").eq("id", contactId).maybeSingle();
    // TODO Phase 2.2B: Remove after contacts.balance column is dropped — override with canonical view balance
    const { fetchContactBalance } = await import("@/lib/contactBalances");
    const liveBal = await fetchContactBalance(contactId);
    setContact(c ? { ...c, balance: liveBal } : c);

    const list: Row[] = [];
    const cType = c?.type as string;
    const isCustomer = cType === "customer" || cType === "both";
    const isSupplier = cType === "supplier" || cType === "both";

    // Customer flows
    if (isCustomer) {
      const [{ data: invs }, { data: pays }, { data: rets }] = await Promise.all([
        supabase.from("invoices")
          .select("id, invoice_number, total, created_at, invoice_date, status, is_migrated, branch_id")
          .eq("contact_id", contactId)
          .eq("status", "active"),
        supabase.from("invoice_payments")
          .select("id, amount, payment_method, created_at, invoice_id, invoices!inner(contact_id, invoice_number)")
          .eq("invoices.contact_id", contactId),
        supabase.from("returns")
          .select("id, return_number, total_refund, refund_method, created_at, invoice_id, invoices!inner(contact_id, invoice_number)")
          .eq("invoices.contact_id", contactId),
      ]);

      (invs ?? []).forEach((r: any) => list.push({
        date: r.invoice_date ?? r.created_at, type: "فاتورة بيع", reference: r.invoice_number,
        description: r.is_migrated ? "فاتورة قديمة مرحّلة" : "—",
        debit: Number(r.total ?? 0), credit: 0, link: r.branch_id ? `/branch/${r.branch_id}/sales/${r.id}` : undefined,
      }));
      (pays ?? []).forEach((p: any) => list.push({
        date: p.created_at, type: "تحصيل من عميل", reference: p.invoices?.invoice_number ?? "—",
        description: p.payment_method ?? "—",
        debit: 0, credit: Number(p.amount ?? 0),
      }));
      (rets ?? []).forEach((r: any) => list.push({
        date: r.created_at, type: "مرتجع بيع", reference: r.return_number ?? r.invoices?.invoice_number ?? "—",
        description: r.refund_method ?? "—",
        debit: 0, credit: Number(r.total_refund ?? 0),
      }));
    }

    // Supplier flows
    if (isSupplier) {
      const [{ data: ships }, { data: sp }, { data: prets }] = await Promise.all([
        supabase.from("shipments")
          .select("id, shipment_number, total_cost, arrival_date, invoice_date, created_at, is_migrated, branch_id")
          .eq("contact_id", contactId),
        supabase.from("supplier_payments" as any)
          .select("id, amount, paid_at, payment_method, reference_number")
          .eq("contact_id", contactId),
        supabase.from("purchase_returns")
          .select("id, return_number, total_amount, created_at, refund_method")
          .eq("contact_id", contactId),
      ]);

      (ships ?? []).forEach((s: any) => list.push({
        date: s.invoice_date ?? s.arrival_date ?? s.created_at, type: "فاتورة شراء (شحنة)", reference: s.shipment_number ?? "—",
        description: s.is_migrated ? "فاتورة قديمة مرحّلة" : "—",
        debit: 0, credit: Number(s.total_cost ?? 0), link: s.branch_id ? `/branch/${s.branch_id}/shipments/${s.id}` : undefined,
      }));
      (sp as any[] ?? []).forEach((p: any) => list.push({
        date: p.paid_at, type: "دفع لمورد", reference: p.reference_number ?? "—",
        description: p.payment_method ?? "—",
        debit: Number(p.amount ?? 0), credit: 0,
      }));
      (prets ?? []).forEach((r: any) => list.push({
        date: r.created_at, type: "مرتجع شراء", reference: r.return_number ?? "—",
        description: r.refund_method ?? "—",
        debit: Number(r.total_amount ?? 0), credit: 0,
      }));
    }

    // Manual vouchers (works for both)
    const { data: vchs } = await supabase.from("vouchers" as any)
      .select("id, voucher_number, type, amount, voucher_date, party_type, source, description")
      .eq("party_id", contactId)
      .eq("source", "manual")
      .eq("status", "active");

    (vchs as any[] ?? []).forEach((v: any) => {
      const isCust = v.party_type === "customer";
      // Customer: receipt → credit (paid us); payment → credit (we refunded them, increases what we owe)
      // Supplier: payment → debit (we paid); receipt → credit (they refunded)
      let debit = 0, credit = 0;
      if (isCust) credit = Number(v.amount ?? 0);
      else if (v.type === "payment") debit = Number(v.amount ?? 0);
      else credit = Number(v.amount ?? 0);
      list.push({
        date: v.voucher_date, type: v.type === "receipt" ? "سند قبض" : "سند صرف",
        reference: v.voucher_number ?? "—",
        description: v.description ?? "—",
        debit, credit,
      });
    });

    list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Compute running balance
    let run = 0;
    for (const r of list) {
      run += r.debit - r.credit;
      r.balance = run;
    }
    list.reverse(); // newest first for display

    setRows(list);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);
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
    exportToExcel(`كشف_حساب_${contact?.name ?? contactId}`, [{ name: "كشف الحساب", rows: sheet }]);
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
      <div class="meta">النوع: ${contact?.type ?? "—"} · الهاتف: ${contact?.phone ?? "—"}</div>
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
        subtitle={contact ? `${contact.type === "customer" ? "عميل" : contact.type === "supplier" ? "مورد" : "عميل ومورد"} · ${contact.phone ?? ""}` : ""}
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
