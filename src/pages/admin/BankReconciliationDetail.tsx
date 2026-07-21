import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowRight, Plus, Link2, Unlink, CheckCircle2, Sparkles } from "lucide-react";

type Statement = any;
type StmtLine = { id: string; txn_date: string; description: string | null; reference: string | null; debit: number; credit: number; is_matched: boolean; matched_journal_line_id: string | null };
type JLine = { id: string; entry_id: string; debit: number; credit: number; description: string | null; entry_date: string; entry_number: string; matched: boolean };

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

export default function BankReconciliationDetail() {
  const { id } = useParams();
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [account, setAccount] = useState<any>(null);
  const [lines, setLines] = useState<StmtLine[]>([]);
  const [journal, setJournal] = useState<JLine[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [openLine, setOpenLine] = useState(false);
  const [lineForm, setLineForm] = useState({ txn_date: "", description: "", reference: "", debit: "0", credit: "0" });

  const [selectedStmt, setSelectedStmt] = useState<string>("");
  const [selectedJ, setSelectedJ] = useState<string>("");

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data: s } = await supabase.from("bank_statements" as any).select("*").eq("id", id).single() as any;
    if (!s) { setLoading(false); return; }
    setStmt(s);
    const { data: acc } = await supabase.from("bank_accounts" as any).select("*").eq("id", s.bank_account_id).single() as any;
    setAccount(acc);
    setLineForm(f => ({ ...f, txn_date: s.statement_date }));

    const { data: ls } = await supabase.from("bank_statement_lines" as any).select("*").eq("statement_id", id).order("txn_date") as any;
    setLines((ls as any) ?? []);

    if (acc?.gl_account_id) {
      const { data: jl } = await supabase
        .from("journal_entry_lines" as any)
        .select("id,entry_id,debit,credit,description,journal_entries!inner(entry_date,entry_number,status)")
        .eq("account_id", acc.gl_account_id)
        .gte("journal_entries.entry_date", s.period_start)
        .lte("journal_entries.entry_date", s.period_end)
        .eq("journal_entries.status", "posted") as any;
      const matchedIds = new Set(((ls as any) ?? []).map((l: any) => l.matched_journal_line_id).filter(Boolean));
      const mapped: JLine[] = (jl ?? []).map((r: any) => ({
        id: r.id, entry_id: r.entry_id, debit: Number(r.debit || 0), credit: Number(r.credit || 0),
        description: r.description, entry_date: r.journal_entries.entry_date, entry_number: r.journal_entries.entry_number,
        matched: matchedIds.has(r.id),
      }));
      mapped.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
      setJournal(mapped);
    } else {
      setJournal([]);
    }

    const { data: sum } = await supabase.rpc("get_bank_reconciliation_summary" as any, {
      p_bank_account_id: s.bank_account_id, p_period_start: s.period_start, p_period_end: s.period_end,
    });
    setSummary(sum);
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  const addLine = async () => {
    if (!id) return;
    if (!stmt) return;
    const debit = Number(lineForm.debit) || 0;
    const credit = Number(lineForm.credit) || 0;
    if (debit === 0 && credit === 0) { toast.error("أدخل مبلغ مدين أو دائن"); return; }
    const { error } = await supabase.from("bank_statement_lines" as any).insert({
      statement_id: id, bank_account_id: stmt.bank_account_id,
      txn_date: lineForm.txn_date || stmt.statement_date,
      description: lineForm.description || null, reference: lineForm.reference || null,
      debit, credit,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم إضافة البند");
    setOpenLine(false);
    setLineForm({ txn_date: stmt.statement_date, description: "", reference: "", debit: "0", credit: "0" });
    load();
  };

  const doMatch = async () => {
    if (!selectedStmt || !selectedJ) { toast.error("اختر بند من كل جانب"); return; }
    const s = lines.find(l => l.id === selectedStmt);
    const j = journal.find(x => x.id === selectedJ);
    if (!s || !j) return;
    const sNet = (s.debit || 0) - (s.credit || 0);
    const jNet = (j.debit || 0) - (j.credit || 0);
    if (Math.abs(sNet - jNet) > 0.01) {
      if (!confirm(`المبالغ غير متطابقة (${fmt(sNet)} مقابل ${fmt(jNet)}). متابعة المطابقة؟`)) return;
    }
    const { error } = await supabase.from("bank_statement_lines" as any).update({
      is_matched: true, matched_journal_line_id: selectedJ, matched_at: new Date().toISOString(),
    }).eq("id", selectedStmt);
    if (error) { toast.error(error.message); return; }
    toast.success("تمت المطابقة");
    setSelectedStmt(""); setSelectedJ(""); load();
  };

  const unmatch = async (lineId: string) => {
    const { error } = await supabase.from("bank_statement_lines" as any).update({
      is_matched: false, matched_journal_line_id: null, matched_at: null,
    }).eq("id", lineId);
    if (error) { toast.error(error.message); return; }
    toast.success("تم إلغاء المطابقة"); load();
  };

  const autoMatch = async () => {
    let count = 0;
    const unmatchedStmt = lines.filter(l => !l.is_matched);
    const matchedJ = new Set(lines.filter(l => l.matched_journal_line_id).map(l => l.matched_journal_line_id));
    const availableJ = journal.filter(j => !matchedJ.has(j.id));
    for (const s of unmatchedStmt) {
      const sNet = (s.debit || 0) - (s.credit || 0);
      const cand = availableJ.find(j => {
        if (matchedJ.has(j.id)) return false;
        const jNet = (j.debit || 0) - (j.credit || 0);
        return Math.abs(sNet - jNet) < 0.01 && Math.abs(new Date(j.entry_date).getTime() - new Date(s.txn_date).getTime()) < 5 * 24 * 3600 * 1000;
      });
      if (cand) {
        const { error } = await supabase.from("bank_statement_lines" as any).update({
          is_matched: true, matched_journal_line_id: cand.id, matched_at: new Date().toISOString(),
        }).eq("id", s.id);
        if (!error) { count++; matchedJ.add(cand.id); }
      }
    }
    toast.success(count > 0 ? `تمت مطابقة ${count} بند تلقائيًا` : "لا توجد مطابقات تلقائية");
    load();
  };

  const markReconciled = async () => {
    if (!id) return;
    const { error } = await supabase.from("bank_statements" as any).update({ status: "reconciled" }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم إغلاق الكشف كمطابق"); load();
  };

  const stmtTotals = useMemo(() => ({
    debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0),
    credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0),
    matched: lines.filter(l => l.is_matched).length,
    unmatched: lines.filter(l => !l.is_matched).length,
  }), [lines]);

  const diff = summary ? Number(summary.book_balance) - (Number(stmt?.opening_balance || 0) + Number(summary.statement_net)) : 0;

  if (loading) return <AdminLayout><div className="p-6">جاري التحميل…</div></AdminLayout>;
  if (!stmt) return <AdminLayout><div className="p-6">لم يتم العثور على الكشف</div></AdminLayout>;

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <div className="flex items-center justify-between gap-3">
          <PageHeader title={`مطابقة كشف — ${account?.name || ""}`} subtitle={`${stmt.period_start} → ${stmt.period_end}`} />
          <Button variant="outline" asChild><Link to="/admin/accounting/bank-reconciliation"><ArrowRight className="w-4 h-4 ml-1" />رجوع</Link></Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">رصيد الدفاتر</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(summary?.book_balance || 0)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">صافي الكشف</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(summary?.statement_net || 0)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">الرصيد الختامي (كشف)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(stmt.closing_balance)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">بنود مطابقة / غير مطابقة</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-success">{stmtTotals.matched}</div><div className="text-sm text-warning">غير مطابق: {stmtTotals.unmatched}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">الفرق</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${Math.abs(diff) < 0.01 ? "text-success" : "text-warning"}`}>{fmt(diff)}</div></CardContent></Card>
        </div>

        {/* Actions */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-4">
            <Dialog open={openLine} onOpenChange={setOpenLine}>
              <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />إضافة بند كشف</Button></DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader><DialogTitle>بند كشف بنكي</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>التاريخ</Label><Input type="date" value={lineForm.txn_date} onChange={e => setLineForm({ ...lineForm, txn_date: e.target.value })} /></div>
                    <div><Label>المرجع</Label><Input value={lineForm.reference} onChange={e => setLineForm({ ...lineForm, reference: e.target.value })} /></div>
                  </div>
                  <div><Label>الوصف</Label><Input value={lineForm.description} onChange={e => setLineForm({ ...lineForm, description: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>مدين (إيداع)</Label><Input type="number" value={lineForm.debit} onChange={e => setLineForm({ ...lineForm, debit: e.target.value })} /></div>
                    <div><Label>دائن (سحب)</Label><Input type="number" value={lineForm.credit} onChange={e => setLineForm({ ...lineForm, credit: e.target.value })} /></div>
                  </div>
                </div>
                <DialogFooter><Button onClick={addLine}>حفظ</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Button size="sm" variant="outline" onClick={autoMatch}><Sparkles className="w-4 h-4 ml-1" />مطابقة تلقائية</Button>
            <Button size="sm" onClick={doMatch} disabled={!selectedStmt || !selectedJ}><Link2 className="w-4 h-4 ml-1" />مطابقة المحدد</Button>
            <div className="flex-1" />
            <Button size="sm" variant="default" onClick={markReconciled} disabled={stmt.status === "reconciled" || stmtTotals.unmatched > 0}>
              <CheckCircle2 className="w-4 h-4 ml-1" />إغلاق كمطابق
            </Button>
          </CardContent>
        </Card>

        {!account?.gl_account_id && (
          <Card><CardContent className="py-4 text-warning">هذا الحساب البنكي غير مرتبط بحساب في دليل الحسابات — لا يمكن جلب قيود الدفاتر.</CardContent></Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Statement lines */}
          <Card>
            <CardHeader><CardTitle>بنود الكشف البنكي ({lines.length})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead></TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">الوصف</TableHead>
                  <TableHead className="text-right">مدين</TableHead>
                  <TableHead className="text-right">دائن</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {lines.map(l => (
                    <TableRow key={l.id} className={l.is_matched ? "bg-success/5" : ""}>
                      <TableCell>
                        {!l.is_matched && (
                          <Checkbox checked={selectedStmt === l.id} onCheckedChange={(v) => setSelectedStmt(v ? l.id : "")} />
                        )}
                      </TableCell>
                      <TableCell>{l.txn_date}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={l.description || ""}>{l.description || "—"}{l.reference ? ` (${l.reference})` : ""}</TableCell>
                      <TableCell>{l.debit ? fmt(l.debit) : "—"}</TableCell>
                      <TableCell>{l.credit ? fmt(l.credit) : "—"}</TableCell>
                      <TableCell>
                        {l.is_matched ? (
                          <Button size="sm" variant="ghost" onClick={() => unmatch(l.id)}><Unlink className="w-4 h-4" /></Button>
                        ) : <Badge variant="outline">غير مطابق</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {lines.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد بنود</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Journal lines */}
          <Card>
            <CardHeader><CardTitle>قيود الدفاتر ({journal.length})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead></TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">قيد</TableHead>
                  <TableHead className="text-right">الوصف</TableHead>
                  <TableHead className="text-right">مدين</TableHead>
                  <TableHead className="text-right">دائن</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {journal.map(j => (
                    <TableRow key={j.id} className={j.matched ? "bg-success/5 opacity-60" : ""}>
                      <TableCell>
                        {!j.matched && (
                          <Checkbox checked={selectedJ === j.id} onCheckedChange={(v) => setSelectedJ(v ? j.id : "")} />
                        )}
                      </TableCell>
                      <TableCell>{j.entry_date}</TableCell>
                      <TableCell>
                        <Link to={`/admin/accounting/journal/${j.entry_id}`} className="text-primary hover:underline">{j.entry_number}</Link>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate" title={j.description || ""}>{j.description || "—"}</TableCell>
                      <TableCell>{j.debit ? fmt(j.debit) : "—"}</TableCell>
                      <TableCell>{j.credit ? fmt(j.credit) : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {journal.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد قيود</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
