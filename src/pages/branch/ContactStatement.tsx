import { addDaysDay, cairoTodayDay, monthStartDay } from "@/lib/cairoDate";
import { PermCard } from "@/contexts/PermCustomize";
import { PermTable } from "@/components/PermTable";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BranchLayout, AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberedPagination } from "@/components/NumberedPagination";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { exportToExcel, printReport } from "@/lib/export";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, Download, Printer, Search, X } from "lucide-react";
import { fetchContactStatement, type Side, type StatementLine } from "@/lib/ledger";

/**
 * Contact statement from the unified ledger (Step 6C). One side at a time: the customer account and the
 * supplier account of the same contact are two separate statements — never netted.
 *   customer: debit = invoices / refunds paid back (adds to what he owes), credit = collections, deposits,
 *             return credit. Balance + = he owes us, − = his advance with us.
 *   supplier: debit = purchase invoices / refunds received, credit = our payments, return credit.
 *             Balance + = we owe him, − = our advance with him.
 * Branch scope: that branch's documents and money; money that crossed branches shows as its own line.
 */
const PAGE_SIZE = 50;
const DATE_SHORTCUTS: { label: string; range: () => [string, string] }[] = [
  { label: "النهاردة", range: () => { const d = cairoTodayDay(); return [d, d]; } },
  { label: "امبارح", range: () => { const d = addDaysDay(cairoTodayDay(), -1); return [d, d]; } },
  { label: "آخر 7 أيام", range: () => { const d = cairoTodayDay(); return [addDaysDay(d, -6), d]; } },
  { label: "الشهر ده", range: () => { const d = cairoTodayDay(); return [monthStartDay(d), d]; } },
  { label: "الشهر اللي فات", range: () => { const d = cairoTodayDay(); return [monthStartDay(d, -1), addDaysDay(monthStartDay(d), -1)]; } },
];
type KindFilter = "all" | "documents" | "money" | "returns" | "cross";
const kindOf = (l: StatementLine): KindFilter =>
  l.doc_type ? "documents"
  : l.line_type.includes("مرتجع") ? "returns"
  : l.line_type.includes("فرع آخر") ? "cross"
  : "money";

const includesText = (value: unknown, search: string) => String(value ?? "").toLocaleLowerCase("ar-EG").includes(search.toLocaleLowerCase("ar-EG"));

export default function ContactStatement() {
  const params = useParams<{ id: string; contactId: string }>();
  const routeBranchId = params.id;
  const contactId = params.contactId;
  const nav = useNavigate();
  const { isAdmin, branches: myBranches } = useAuth();
  const isAdminView = !routeBranchId;
  const Layout = isAdminView ? AdminLayout : BranchLayout;
  const [sp, setSp] = useSearchParams();

  const [contact, setContact] = useState<any>(null);
  const [branchOpts, setBranchOpts] = useState<{ id: string; name: string }[]>([]);
  const side: Side = (sp.get("side") as Side) || (contact?.type === "supplier" ? "supplier" : "customer");
  // scope: "all" (company-wide, admins and contact totals) or one branch; branch users default to theirs
  const scope = sp.get("branch") ?? sp.get("branches")?.split(",")[0] ?? (routeBranchId && !isAdmin ? routeBranchId : "all");
  const scopeBranch = scope === "all" ? null : scope;

  const [lines, setLines] = useState<StatementLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => { const t = setTimeout(() => setSearch(searchText.trim()), 300); return () => clearTimeout(t); }, [searchText]);
  useEffect(() => { setPage(1); }, [fromDate, toDate, search, kind, minAmount, maxAmount, side, scope]);

  useEffect(() => {
    if (!contactId) return;
    supabase.from("contacts").select("id, name, type, phone").eq("id", contactId).maybeSingle().then(({ data }) => setContact(data));
    supabase.from("branches").select("id, name, code").eq("is_active", true).order("name").then(({ data }) =>
      setBranchOpts(((data ?? []) as any[])
        .filter((b) => b.code !== "PARTNER-CASH" && (isAdmin || myBranches.some((m: any) => m.id === b.id)))
        .map((b) => ({ id: b.id, name: b.code === "MAIN-TREASURY" ? `${b.name} (الأرصدة الافتتاحية)` : b.name }))));
  }, [contactId]);

  const load = async () => {
    if (!contactId || !contact) return;
    setLoading(true);
    setLoadError(null);
    try {
      setLines(await fetchContactStatement(contactId, side, scopeBranch, fromDate || null, toDate || null));
    } catch (e: any) {
      // never show an empty statement as if the account were clean: say that it failed
      setLines([]);
      setLoadError(e?.message ?? "تعذر تحميل كشف الحساب");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId, contact?.id, side, scopeBranch, fromDate, toDate]);
  useRealtimeRefresh(
    ["invoices", "invoice_payments", "returns", "shipments", "supplier_payments", "purchase_returns", "vouchers", "payment_transactions", "customer_credit_log", "contacts"],
    load,
  );

  const opening = lines.find((l) => l.line_no === 0) ?? null;
  const body = useMemo(() => lines.filter((l) => l.line_no !== 0), [lines]);
  const filtered = useMemo(() => {
    const min = minAmount === "" ? undefined : Number(minAmount);
    const max = maxAmount === "" ? undefined : Number(maxAmount);
    return body.filter((l) => {
      const amt = Math.max(l.debit, l.credit);
      if (search && ![l.reference, l.description, l.line_type, l.branch_name].some((v) => includesText(v, search))) return false;
      if (kind !== "all" && kindOf(l) !== kind) return false;
      if (min !== undefined && Number.isFinite(min) && amt < min) return false;
      if (max !== undefined && Number.isFinite(max) && amt > max) return false;
      return true;
    });
  }, [body, search, kind, minAmount, maxAmount]);
  const display = useMemo(() => (opening ? [opening, ...filtered] : filtered).slice().reverse(), [opening, filtered]);
  const pageCount = Math.max(1, Math.ceil(display.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = display.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const r2 = (v: number) => Math.round(v * 100) / 100;
  const totals = useMemo(() => ({ debit: r2(filtered.reduce((s, l) => s + l.debit, 0)), credit: r2(filtered.reduce((s, l) => s + l.credit, 0)) }), [filtered]);
  const finalBalance = body.length ? body[body.length - 1].balance : (opening?.balance ?? 0);
  const isC = side === "customer";
  const balLabel = (b: number) => Math.abs(b) <= 0.005 ? "مسدد"
    : isC ? (b > 0 ? "عليه لنا" : "مقدم منه عندنا") : (b > 0 ? "علينا له" : "مقدم لينا عنده");
  const debitHdr = isC ? "مدين (فواتير عليه)" : "دائن له (فواتير شراء)";
  const creditHdr = isC ? "دائن (مقبوضات ورصيد)" : "مدين (مدفوعات ورصيد)";
  const scopeName = scopeBranch ? branchOpts.find((b) => b.id === scopeBranch)?.name ?? "فرع" : "كل الفروع";
  const sideName = isC ? "حساب العميل" : "حساب المورد";

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v == null) next.delete(k); else next.set(k, v);
    next.delete("branches");
    setSp(next, { replace: true });
  };

  const exportExcel = () => {
    exportToExcel(`كشف_${sideName}_${contact?.name ?? contactId}_${scopeName}`, [
      { name: "ملخص", rows: [
        { البيان: "الجهة", القيمة: contact?.name ?? "" },
        { البيان: "الحساب", القيمة: sideName },
        { البيان: "النطاق", القيمة: scopeName },
        { البيان: "الرصيد", القيمة: finalBalance },
        { البيان: "الحالة", القيمة: balLabel(finalBalance) },
      ] },
      { name: "كشف الحساب", rows: (opening ? [opening, ...filtered] : filtered).map((l) => ({
        "التاريخ": l.line_date ? formatDate(l.line_date) : "",
        "النوع": l.line_type, "المرجع": l.reference ?? "", "الفرع": l.branch_name ?? "", "التفاصيل": l.description ?? "",
        [debitHdr]: l.debit || "", [creditHdr]: l.credit || "", "الرصيد": l.balance,
      })) },
    ]);
  };

  const printPdf = () => {
    const rowsHtml = (opening ? [opening, ...filtered] : filtered).map((l) => `
      <tr><td>${l.line_date ? formatDate(l.line_date) : ""}</td><td>${l.line_type}</td><td>${l.reference ?? ""}</td><td>${l.branch_name ?? ""}</td>
      <td>${l.debit ? formatEGP(l.debit) : "—"}</td><td>${l.credit ? formatEGP(l.credit) : "—"}</td><td><b>${formatEGP(l.balance)}</b></td></tr>`).join("");
    printReport(`كشف ${sideName} - ${contact?.name ?? ""}`, `
      <h1>كشف ${sideName}: ${contact?.name ?? "—"}</h1>
      <div class="meta">النطاق: ${scopeName} · ${fromDate || toDate ? `الفترة: ${fromDate || "البداية"} → ${toDate || "النهارده"}` : "كل الفترة من بداية الدفتر"}</div>
      <div class="kpi">
        <div><span class="muted">${debitHdr}</span><b>${formatEGP(totals.debit)}</b></div>
        <div><span class="muted">${creditHdr}</span><b>${formatEGP(totals.credit)}</b></div>
        <div><span class="muted">الرصيد</span><b>${formatEGP(Math.abs(finalBalance))} ${balLabel(finalBalance)}</b></div>
      </div>
      <PermTable><thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>الفرع</th><th>${debitHdr}</th><th>${creditHdr}</th><th>الرصيد</th></tr></thead><tbody>${rowsHtml}</tbody></PermTable>
      <p class="muted">${isC ? "الرصيد الموجب = على العميل لنا، السالب = مقدم من العميل عندنا." : "الرصيد الموجب = علينا للمورد، السالب = مقدم لينا عند المورد."} حساب العميل وحساب المورد منفصلين.</p>`, { landscape: true });
  };

  const showSideTabs = contact?.type === "both";

  return (
    <Layout>
      <PageHeader
        title={`كشف ${sideName}: ${contact?.name ?? "..."}`}
        subtitle={contact ? `${contact.type === "customer" ? "عميل" : contact.type === "supplier" ? "مورد" : "عميل ومورد"} · ${contact.phone ?? ""} · ${scopeName}` : ""}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => nav(-1)}><ArrowRight className="w-4 h-4 ml-1" /> رجوع</Button>
            <Button variant="outline" onClick={exportExcel}><Download className="w-4 h-4 ml-1" /> Excel</Button>
            <Button onClick={printPdf}><Printer className="w-4 h-4 ml-1" /> طباعة / PDF</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        {showSideTabs && (
          <Tabs value={side} onValueChange={(v) => setParam("side", v)}>
            <TabsList>
              <TabsTrigger value="customer">حساب العميل</TabsTrigger>
              <TabsTrigger value="supplier">حساب المورد</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <Select value={scope} onValueChange={(v) => setParam("branch", v === "all" ? null : v)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {isAdmin && <SelectItem value="all">كل الفروع (الرصيد الإجمالي)</SelectItem>}
            {branchOpts.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">حساب العميل وحساب المورد منفصلين.</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <PermCard label={String(debitHdr)}><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">{debitHdr}</div><div className="text-xl font-bold mt-1">{formatEGP(totals.debit)}</div></div></PermCard>
        <PermCard label={String(creditHdr)}><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">{creditHdr}</div><div className="text-xl font-bold mt-1">{formatEGP(totals.credit)}</div></div></PermCard>
        <PermCard label="عدد الحركات"><div className="card-elevated p-4"><div className="text-xs text-muted-foreground">عدد الحركات</div><div className="text-xl font-bold mt-1">{filtered.length}</div></div></PermCard>
        <PermCard label="الرصيد"><div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">الرصيد {toDate ? `في ${formatDate(toDate)}` : "الحالي"}</div>
          <div className={`text-xl font-bold mt-1 ${Math.abs(finalBalance) <= 0.005 ? "" : finalBalance > 0 ? "text-destructive" : "text-success"}`}>{formatEGP(Math.abs(finalBalance))}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{balLabel(finalBalance)}</div>
        </div></PermCard>
      </div>

      <div className="card-elevated p-4 mb-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {DATE_SHORTCUTS.map((s) => (
            <Button key={s.label} type="button" variant="outline" size="sm" onClick={() => { const [f, t] = s.range(); setFromDate(f); setToDate(t); }}>{s.label}</Button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">بحث</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="رقم الفاتورة / السند / الفرع..." className="pr-9" />
            </div>
          </div>
          <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <div>
            <Label className="text-xs">النوع</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="documents">فواتير</SelectItem>
                <SelectItem value="money">فلوس (تحصيل / سداد / إيداع / رد / افتتاحي)</SelectItem>
                <SelectItem value="returns">مرتجعات</SelectItem>
                <SelectItem value="cross">بين الفروع</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">المبلغ من</Label><Input type="number" min="0" step="0.01" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} /></div>
          <div><Label className="text-xs">المبلغ إلى</Label><Input type="number" min="0" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} /></div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setFromDate(""); setToDate(""); setSearchText(""); setKind("all"); setMinAmount(""); setMaxAmount(""); }}>
          <X className="ml-2 h-4 w-4" />مسح الفلاتر
        </Button>
      </div>

      {loadError && (
        <div className="card-elevated p-3 mb-3 text-sm text-destructive flex items-center justify-between gap-2">
          <span>تعذر تحميل الكشف: {loadError}</span>
          <Button size="sm" variant="outline" onClick={load}>إعادة المحاولة</Button>
        </div>
      )}
      <DataTable
        loading={loading}
        rows={pageRows}
        pageSize={PAGE_SIZE}
        onRowClick={(l: StatementLine) => {
          if (l.doc_type === "invoice" && l.doc_id && l.branch_id) nav(`/branch/${l.branch_id}/sales/${l.doc_id}`);
          if (l.doc_type === "shipment" && l.doc_id && l.branch_id) nav(`/branch/${l.branch_id}/shipments/${l.doc_id}`);
        }}
        empty="لا توجد حركات"
        columns={[
          { key: "date", header: "التاريخ", render: (l: StatementLine) => (l.line_date ? formatDate(l.line_date) : "—") },
          { key: "type", header: "النوع", render: (l: StatementLine) => <span className={l.line_no === 0 ? "font-bold" : ""}>{l.line_type}</span> },
          { key: "ref", header: "المرجع", render: (l: StatementLine) => <span className="font-mono text-xs">{l.reference ?? "—"}</span> },
          { key: "branch", header: "الفرع", render: (l: StatementLine) => l.branch_name ?? "—" },
          { key: "debit", header: debitHdr, render: (l: StatementLine) => (l.debit ? <span className="font-semibold">{formatEGP(l.debit)}</span> : "—") },
          { key: "credit", header: creditHdr, render: (l: StatementLine) => (l.credit ? <span className="font-semibold text-success">{formatEGP(l.credit)}</span> : "—") },
          { key: "balance", header: "الرصيد", render: (l: StatementLine) => (
            <span className="font-bold tabular-nums" title={balLabel(l.balance)}>{formatEGP(Math.abs(l.balance))} <span className="text-[10px] text-muted-foreground">{balLabel(l.balance)}</span></span>
          ) },
        ]}
      />
      <NumberedPagination page={safePage} pageCount={pageCount} onChange={setPage} disabled={loading} />
    </Layout>
  );
}
