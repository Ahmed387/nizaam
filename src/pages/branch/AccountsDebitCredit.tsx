import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";

/**
 * «أرصدة الحسابات — مدين / دائن» (migration 0194): the «أرصدة الحسابات بتاريخ سابق» report of «سهل». One row per account
 * with its NET balance (customer side − supplier side) at the end of two dates the user picks: الرصيد السابق and الرصيد
 * الحالي, each split into مدين (عليه) and دائن (له). Read-only. Branch page = that branch; admin page = all branches.
 */
type Row = { contact_id: string; name: string; type: string; prev_debit: number; prev_credit: number; cur_debit: number; cur_credit: number };
const typeName = (t: string) => (t === "customer" ? "عميل" : t === "supplier" ? "مورد" : "عميل ومورد");
const money = (v: number) => (Math.abs(v) < 0.005 ? "—" : formatEGP(v));

export default function AccountsDebitCredit() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const today = cairoTodayDay();
  const [prev, setPrev] = useState(`${Number(today.slice(0, 4)) - 1}-12-31`);
  const [cur, setCur] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (supabase.rpc as any)("contacts_debit_credit", { p_branch_id: branchId ?? null, p_prev: prev || null, p_cur: cur || null })
      .then(({ data, error }: any) => {
        if (!alive) return;
        if (error) { toast.error(error.message); setRows([]); }
        else setRows(((data ?? []) as any[]).map((r) => ({ ...r, prev_debit: Number(r.prev_debit), prev_credit: Number(r.prev_credit), cur_debit: Number(r.cur_debit), cur_credit: Number(r.cur_credit) })));
        setLoading(false);
      });
    return () => { alive = false; };
  }, [branchId, prev, cur]);

  const tot = useMemo(() => rows.reduce((t, r) => ({ pd: t.pd + r.prev_debit, pc: t.pc + r.prev_credit, cd: t.cd + r.cur_debit, cc: t.cc + r.cur_credit }), { pd: 0, pc: 0, cd: 0, cc: 0 }), [rows]);
  const open = (r: Row) => nav(branchId ? `/branch/${branchId}/contacts/${r.contact_id}/statement` : `/admin/contacts/${r.contact_id}/statement`);

  const exportExcel = () => {
    const data = rows.map((r) => ({ "الحساب": r.name, "النوع": typeName(r.type), [`سابق مدين (${prev})`]: r.prev_debit, [`سابق دائن (${prev})`]: r.prev_credit, [`حالي مدين (${cur})`]: r.cur_debit, [`حالي دائن (${cur})`]: r.cur_credit }));
    data.push({ "الحساب": "الإجمالي", "النوع": "", [`سابق مدين (${prev})`]: tot.pd, [`سابق دائن (${prev})`]: tot.pc, [`حالي مدين (${cur})`]: tot.cd, [`حالي دائن (${cur})`]: tot.cc } as any);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أرصدة الحسابات");
    XLSX.writeFile(wb, `أرصدة-الحسابات-${prev}-${cur}.xlsx`);
  };

  return (
    <ConditionalLayout variant={branchId ? "branch" : "admin"}>
      <PageHeader
        title="أرصدة الحسابات — مدين / دائن"
        subtitle="رصيد كل حساب (صافي العميل والمورد) آخر يوم التاريخين — زي تقرير «أرصدة الحسابات بتاريخ سابق» في سهل"
        actions={<Button variant="outline" onClick={exportExcel} disabled={!rows.length}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>}
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div><Label>الرصيد السابق — آخر يوم</Label><Input type="date" value={prev} max={cur} onChange={(e) => setPrev(e.target.value)} className="mt-1 w-44" /></div>
        <div><Label>الرصيد الحالي — آخر يوم</Label><Input type="date" value={cur} onChange={(e) => setCur(e.target.value)} className="mt-1 w-44" /></div>
        <div className="text-sm text-muted-foreground">
          {rows.length} حساب — صافي السابق: <b>{formatEGP(Math.abs(tot.pd - tot.pc))}</b> {tot.pd - tot.pc >= 0 ? "مدين" : "دائن"} — صافي الحالي: <b>{formatEGP(Math.abs(tot.cd - tot.cc))}</b> {tot.cd - tot.cc >= 0 ? "مدين" : "دائن"}
        </div>
      </div>
      <DataTable
        loading={loading} rows={rows} permTable="accounts_debit_credit" onRowClick={open}
        columns={[
          { key: "name", header: "الحساب", render: (r: Row) => <span className="font-semibold">{r.name}</span> },
          { key: "type", header: "النوع", render: (r: Row) => typeName(r.type) },
          { key: "prev_debit", numeric: true, total: true, header: "سابق — مدين (عليه)", render: (r: Row) => <span className="tabular-nums">{money(r.prev_debit)}</span> },
          { key: "prev_credit", numeric: true, total: true, header: "سابق — دائن (له)", render: (r: Row) => <span className="tabular-nums">{money(r.prev_credit)}</span> },
          { key: "cur_debit", numeric: true, total: true, header: "حالي — مدين (عليه)", render: (r: Row) => <span className="tabular-nums font-bold text-success">{money(r.cur_debit)}</span> },
          { key: "cur_credit", numeric: true, total: true, header: "حالي — دائن (له)", render: (r: Row) => <span className="tabular-nums font-bold text-destructive">{money(r.cur_credit)}</span> },
        ] as any}
      />
    </ConditionalLayout>
  );
}
