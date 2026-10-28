import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/DataTable";
import { NumberedPagination } from "@/components/NumberedPagination";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useListFilter, useRememberedFilter } from "@/hooks/useListFilter";
import { readAllBounded, useWholeList } from "@/hooks/useWholeList";
import { periodOfFilter, withPeriod, type ListColumn } from "@/lib/tableFilter";
import { format } from "date-fns";

type Entry = {
  id: string; entry_number: string; entry_date: string; description: string | null;
  source_type: string | null; status: string; total_debit: number; total_credit: number;
};

const PAGE = 50;
/** a month can hold 40,000+ entries: the column filters keep at most this many in memory (narrow the period first) */
const MAX_WHOLE = 10_000;
const STATUS_LABEL: Record<string, string> = { posted: "مرحّل", reversed: "معكوس" };
const safeLike = (s: string) => s.replace(/[,()%*\\]/g, " ").trim();

/** what each column shows, for the Excel filters (owner 2026-10-26) */
const COLS: ListColumn<Entry>[] = [
  { key: "entry_number", label: "رقم القيد", kind: "text", get: (r) => r.entry_number },
  { key: "entry_date", label: "التاريخ", kind: "date", get: (r) => r.entry_date },
  { key: "description", label: "الوصف", kind: "text", get: (r) => r.description },
  { key: "source_type", label: "المصدر", kind: "text", get: (r) => r.source_type },
  { key: "total_debit", label: "مدين", kind: "number", get: (r) => Number(r.total_debit) || 0, sum: true },
  { key: "total_credit", label: "دائن", kind: "number", get: (r) => Number(r.total_credit) || 0, sum: true },
  { key: "status", label: "الحالة", kind: "text", get: (r) => STATUS_LABEL[r.status] ?? r.status },
];

export default function JournalEntries() {
  const { tenantId } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  // Excel filters, remembered; the period on top IS the «التاريخ» column's from / to (both stay, linked)
  const [colState, setColState] = useRememberedFilter(`xf:v1:${pathname}`);
  const { from, to } = periodOfFilter(colState, "entry_date");
  const setFrom = (v: string) => setColState(withPeriod(colState, "entry_date", v, to));
  const setTo = (v: string) => setColState(withPeriod(colState, "entry_date", from, v));
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(safeLike(q)), 300); return () => clearTimeout(t); }, [q]);

  /** the entries of the bar's filters (period + search), newest first — every page from a fresh query */
  const query = (select: string, opts?: { count?: "exact"; head?: boolean }) => {
    let qb: any = supabase.from("journal_entries" as any).select(select, opts).eq("tenant_id", tenantId!);
    if (from) qb = qb.gte("entry_date", from);
    if (to) qb = qb.lte("entry_date", to);
    if (dq) qb = qb.or(`entry_number.ilike.%${dq}%,description.ilike.%${dq}%,source_type.ilike.%${dq}%`);
    return opts?.head ? qb : qb.order("entry_date", { ascending: false }).order("entry_number", { ascending: false }).order("id");
  };

  // one page of 50 from the database (it used to show the latest 500 only)
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const req = useRef(0);

  // the whole list of the period, when a column filter / sort is on (at most MAX_WHOLE entries)
  const wholeSig = `${tenantId}|${from}|${to}|${dq}`;
  const whole = useWholeList<Entry>(wholeSig, (signal) => readAllBounded<Entry>(() => query("*"), () => query("id", { count: "exact", head: true }), MAX_WHOLE, signal),
    { auto: Object.keys(colState.filters).some((k) => k !== "entry_date" || !!(colState.filters[k] as any).days?.length) || !!colState.sort });
  const { result: listRes, adapter, state: colEff } = useListFilter({ rows: whole.rows, columns: COLS, state: colState, onChange: setColState, ensureRows: whole.ensure });
  // the period alone runs in the database; any other column filter or a sort reads the whole list
  const wholeMode = !!colEff.sort || Object.entries(colEff.filters).some(([k, f]) => !(k === "entry_date" && f.kind === "date" && !f.days?.length));
  const colSig = JSON.stringify(colEff);
  useEffect(() => { setPage(1); }, [from, to, dq, colSig]);

  useEffect(() => {
    if (!tenantId || wholeMode) return;
    const id = ++req.current;
    setLoading(true);
    const start = (page - 1) * PAGE;
    query("*", { count: "exact" }).range(start, start + PAGE - 1).then(({ data, count }: any) => {
      if (id !== req.current) return;
      setRows((data ?? []) as Entry[]);
      setTotal(count ?? 0);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, from, to, dq, page, wholeMode]);

  const shown = wholeMode ? (listRes ? listRes.rows.slice((page - 1) * PAGE, page * PAGE) : []) : rows;
  const shownCount = wholeMode ? (listRes ? listRes.rows.length : 0) : total;
  const tableAdapter = useMemo(() => ({ ...adapter, shown: adapter.shown ?? total }), [adapter, total]);
  const fmt = (n: number) => Number(n).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title="القيود اليومية" subtitle="كل قيود دفتر اليومية" />

        <Card>
          <CardHeader>
            <CardTitle>الفلاتر</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="text-sm">من</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><label className="text-sm">إلى</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
            <div><label className="text-sm">بحث</label><Input value={q} onChange={e => setQ(e.target.value)} placeholder="رقم القيد / وصف / مصدر" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>القيود ({shownCount.toLocaleString("en-US")})</CardTitle></CardHeader>
          <CardContent>
            {wholeMode && whole.tooMany && (
              <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="alert">{whole.tooMany.message}</div>
            )}
            <DataTable
              loading={wholeMode ? !listRes && !whole.tooMany : loading}
              rows={shown}
              excel={{ id: "journal", server: tableAdapter }}
              getRowKey={(r: Entry) => r.id}
              onRowClick={(r: Entry) => nav(`/admin/accounting/journal/${r.id}`)}
              empty="مفيش قيود بالفلاتر دي"
              columns={[
                { key: "entry_number", header: "رقم القيد", align: "right", render: (r: Entry) => (
                  <Link to={`/admin/accounting/journal/${r.id}`} className="font-mono text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.entry_number}</Link>
                ) },
                { key: "entry_date", header: "التاريخ", align: "right", render: (r: Entry) => format(new Date(r.entry_date), "yyyy-MM-dd") },
                { key: "description", header: "الوصف", align: "right", render: (r: Entry) => r.description ?? "—" },
                { key: "source_type", header: "المصدر", align: "right", render: (r: Entry) => <span className="text-xs text-muted-foreground">{r.source_type ?? "—"}</span> },
                { key: "total_debit", header: "مدين", align: "right", numeric: true, render: (r: Entry) => <span className="font-mono">{fmt(r.total_debit)}</span> },
                { key: "total_credit", header: "دائن", align: "right", numeric: true, render: (r: Entry) => <span className="font-mono">{fmt(r.total_credit)}</span> },
                { key: "status", header: "الحالة", align: "right", render: (r: Entry) => (
                  <Badge variant={r.status === "posted" ? "default" : r.status === "reversed" ? "destructive" : "secondary"}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                ) },
              ]}
            />
            {shownCount > PAGE && (
              <div className="mt-3 flex justify-center">
                <NumberedPagination page={page} pageCount={Math.max(1, Math.ceil(shownCount / PAGE))} onChange={setPage} disabled={loading} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
