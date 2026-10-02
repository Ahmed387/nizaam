import { addDaysDay, cairoTodayDay, getCairoDayBounds, monthStartDay } from "@/lib/cairoDate";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BranchLayout, AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberedPagination } from "@/components/NumberedPagination";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { exportToExcel, printReport } from "@/lib/export";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ArrowRight, Download, Printer, Search, X } from "lucide-react";
import { fetchContactLedger, filterLedgerByBranches, withRunningBalance, ledgerSum, type LedgerRow } from "@/lib/contactLedger";

type Row = LedgerRow & { paymentMethod?: string; synthetic?: boolean };
type MovementFilter = "all" | "invoices" | "vouchers" | "returns" | "payments";

const PAGE_SIZE = 50;
const DATE_SHORTCUTS: { label: string; range: () => [string, string] }[] = [
  { label: "النهاردة", range: () => { const d = cairoTodayDay(); return [d, d]; } },
  { label: "امبارح", range: () => { const d = addDaysDay(cairoTodayDay(), -1); return [d, d]; } },
  { label: "آخر 7 أيام", range: () => { const d = cairoTodayDay(); return [addDaysDay(d, -6), d]; } },
  { label: "الشهر ده", range: () => { const d = cairoTodayDay(); return [monthStartDay(d), d]; } },
  { label: "الشهر اللي فات", range: () => { const d = cairoTodayDay(); return [monthStartDay(d, -1), addDaysDay(monthStartDay(d), -1)]; } },
];

const MOVEMENT_KINDS: Record<Exclude<MovementFilter, "all">, Set<LedgerRow["kind"]>> = {
  invoices: new Set(["sale", "purchase"]),
  vouchers: new Set(["receipt_voucher", "payment_voucher", "credit_deposit"]),
  returns: new Set(["sale_return", "purchase_return"]),
  payments: new Set(["sale_payment", "supplier_payment"]),
};

const PAYMENT_METHODS = [
  { value: "all", label: "الكل", terms: [] },
  { value: "cash", label: "نقدي", terms: ["cash", "نقدي", "كاش"] },
  { value: "vodafone", label: "فودافون كاش", terms: ["vodafone", "فودافون"] },
  { value: "instapay", label: "إنستاباي", terms: ["instapay", "انستاباي", "إنستاباي"] },
  { value: "bank", label: "حساب بنكي", terms: ["bank", "بنك", "بنكي"] },
  { value: "credit_balance", label: "رصيد مسبق", terms: ["credit_balance", "رصيد مسبق", "دفعة مقدمة"] },
] as const;

const includesText = (value: unknown, search: string) => String(value ?? "").toLocaleLowerCase("ar-EG").includes(search.toLocaleLowerCase("ar-EG"));

export default function ContactStatement() {
  const params = useParams<{ id: string; contactId: string }>();
  const branchId = params.id;
  const contactId = params.contactId;
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
  const [searchText, setSearchText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [search, setSearch] = useState("");
  const [notesSearch, setNotesSearch] = useState("");
  const [movementType, setMovementType] = useState<MovementFilter>("all");
  const [paymentMethod, setPaymentMethod] = useState("all");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => { const timer = setTimeout(() => setSearch(searchText.trim()), 300); return () => clearTimeout(timer); }, [searchText]);
  useEffect(() => { const timer = setTimeout(() => setNotesSearch(notesText.trim()), 300); return () => clearTimeout(timer); }, [notesText]);
  useEffect(() => { setPage(1); }, [fromDate, toDate, search, notesSearch, movementType, paymentMethod, minAmount, maxAmount]);

  const load = async () => {
    if (!contactId) return;
    setLoading(true);
    const l = await fetchContactLedger(contactId);
    const scoped = filterLedgerByBranches(l.rows, selBranches);
    const bal = selBranches.length ? ledgerSum(scoped) : l.totalBalance;
    const voucherMethods = new Map<string, string>(l.vouchers.map((v: any) => [String(v.voucher_number ?? "—"), String(v.payment_method ?? "")]));
    setContact(l.contact ? { ...l.contact, balance: bal } : l.contact);
    setRows(withRunningBalance(scoped).reverse().map((row) => ({
      ...row,
      paymentMethod: row.kind === "receipt_voucher" || row.kind === "payment_voucher"
        ? voucherMethods.get(row.reference)
        : row.kind === "sale_payment" ? row.description : undefined,
    })) as Row[]);
    setLoading(false);
  };


  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId, branchesParam]);
  useRealtimeRefresh(
    ["invoices", "invoice_payments", "returns", "shipments", "supplier_payments", "purchase_returns", "vouchers", "contacts"],
    load
  );

  const filtered = useMemo(() => {
    const { startIso, endIso } = getCairoDayBounds(fromDate, toDate);
    const startMs = startIso ? new Date(startIso).getTime() : undefined;
    const endMs = endIso ? new Date(endIso).getTime() : undefined;
    const min = minAmount === "" ? undefined : Number(minAmount);
    const max = maxAmount === "" ? undefined : Number(maxAmount);
    const method = PAYMENT_METHODS.find((item) => item.value === paymentMethod);
    return rows.filter((r) => {
      const time = new Date(r.date).getTime();
      const amount = Math.max(Number(r.debit || 0), Number(r.credit || 0));
      if (startMs !== undefined && time < startMs) return false;
      if (endMs !== undefined && time > endMs) return false;
      if (search && ![r.reference, r.description, r.type].some((value) => includesText(value, search))) return false;
      if (notesSearch && !includesText(r.description, notesSearch)) return false;
      if (movementType !== "all" && !MOVEMENT_KINDS[movementType].has(r.kind)) return false;
      if (min !== undefined && Number.isFinite(min) && amount < min) return false;
      if (max !== undefined && Number.isFinite(max) && amount > max) return false;
      if (method && method.value !== "all") {
        const haystack = `${r.paymentMethod ?? ""} ${r.description}`.toLocaleLowerCase("ar-EG");
        if (!method.terms.some((term) => haystack.includes(term.toLocaleLowerCase("ar-EG")))) return false;
      }
      return true;
    });
  }, [rows, fromDate, toDate, search, notesSearch, movementType, paymentMethod, minAmount, maxAmount]);

  const openingRow = useMemo<Row | null>(() => {
    if (!fromDate) return null;
    const { startIso } = getCairoDayBounds(fromDate);
    if (!startIso) return null;
    const startMs = new Date(startIso).getTime();
    const openingBalance = rows.reduce((sum, row) => {
      return new Date(row.date).getTime() < startMs ? sum + row.debit - row.credit : sum;
    }, 0);
    return {
      date: startIso,
      type: "رصيد افتتاحي للفترة",
      kind: "opening",
      reference: "رصيد ما قبل الفترة",
      description: "رصيد ما قبل الفترة",
      debit: 0,
      credit: 0,
      branch_id: null,
      balance: openingBalance,
      synthetic: true,
    };
  }, [rows, fromDate]);

  const displayRows = useMemo(() => openingRow ? [openingRow, ...filtered] : filtered, [openingRow, filtered]);
  const pageCount = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => displayRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [displayRows, safePage]);
  const startCount = displayRows.length ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const endCount = Math.min(safePage * PAGE_SIZE, displayRows.length);

  const totals = useMemo(() => {
    const d = filtered.reduce((s, r) => s + r.debit, 0);
    const c = filtered.reduce((s, r) => s + r.credit, 0);
    return { debit: d, credit: c, net: d - c };
  }, [filtered]);

  const finalBalance = Number(contact?.balance ?? 0);

  const exportExcel = () => {
    const sheet = displayRows.map((r) => ({
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
    const rowsHtml = displayRows.map((r) => `
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

      <div className="card-elevated p-4 mb-4 space-y-4">
        <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-bold">فلاتر كشف الحساب</h2>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              يعرض {startCount} - {endCount} من أصل {displayRows.length} حركة
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {DATE_SHORTCUTS.map((shortcut) => (
              <Button key={shortcut.label} type="button" variant="outline" size="sm" onClick={() => {
                const [from, to] = shortcut.range();
                getCairoDayBounds(from, to);
                setFromDate(from); setToDate(to);
              }}>{shortcut.label}</Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">بحث عام</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="رقم الفاتورة / السند / العملية..." className="pr-9" />
            </div>
          </div>
          <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>

          <div>
            <Label className="text-xs">النوع</Label>
            <Select value={movementType} onValueChange={(value) => setMovementType(value as MovementFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem><SelectItem value="invoices">فواتير</SelectItem>
                <SelectItem value="vouchers">سندات</SelectItem><SelectItem value="returns">مرتجعات</SelectItem>
                <SelectItem value="payments">دفعات</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">بحث الملاحظات</Label><Input value={notesText} onChange={(e) => setNotesText(e.target.value)} placeholder="جزء من البيان أو الملاحظات" /></div>
          <div><Label className="text-xs">المبلغ من</Label><Input type="number" min="0" step="0.01" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" /></div>

          <div>
            <Label className="text-xs">طريقة الدفع / الوعاء</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">المبلغ إلى</Label><Input type="number" min="0" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} /></div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={() => {
              setFromDate(""); setToDate(""); setSearchText(""); setNotesText("");
              setMovementType("all"); setPaymentMethod("all"); setMinAmount(""); setMaxAmount("");
            }}><X className="ml-2 h-4 w-4" />مسح الفلاتر</Button>
          </div>
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={pageRows}
        pageSize={PAGE_SIZE}
        onRowClick={(r: Row) => { if (!r.synthetic && r.link) nav(r.link); }}
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
      <NumberedPagination page={safePage} pageCount={pageCount} onChange={setPage} disabled={loading} />
    </Layout>
  );
}
