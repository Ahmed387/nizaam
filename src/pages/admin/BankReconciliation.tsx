import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Landmark, Plus, ArrowLeftRight, FileSpreadsheet } from "lucide-react";
import { cairoTodayDay } from "@/lib/cairoDate";

type BankAccount = { id: string; name: string; bank_name: string | null; account_number: string | null; currency: string; gl_account_id: string | null; opening_balance: number; is_active: boolean };
type COA = { id: string; code: string; name: string; name_ar: string | null };
type Statement = { id: string; bank_account_id: string; statement_date: string; period_start: string; period_end: string; opening_balance: number; closing_balance: number; status: string };

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

export default function BankReconciliation() {
  const { tenantId } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [coa, setCoa] = useState<COA[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [openAcct, setOpenAcct] = useState(false);
  const [openStmt, setOpenStmt] = useState(false);
  const [selectedAcct, setSelectedAcct] = useState<string>("");

  const [acctForm, setAcctForm] = useState({ name: "", bank_name: "", account_number: "", currency: "EGP", gl_account_id: "", opening_balance: "0" });
  const today = cairoTodayDay();
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [stmtForm, setStmtForm] = useState({ bank_account_id: "", statement_date: today, period_start: firstOfMonth, period_end: today, opening_balance: "0", closing_balance: "0" });

  const load = async () => {
    const [a, c, s] = await Promise.all([
      supabase.from("bank_accounts" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("chart_of_accounts" as any).select("id,code,name,name_ar").order("code"),
      supabase.from("bank_statements" as any).select("*").order("statement_date", { ascending: false }).limit(50),
    ]);
    setAccounts((a.data as any) ?? []);
    setCoa((c.data as any) ?? []);
    setStatements((s.data as any) ?? []);
  };
  useEffect(() => { if (tenantId) load(); }, [tenantId]);

  const saveAccount = async () => {
    if (!acctForm.name.trim()) { toast.error("أدخل اسم الحساب"); return; }
    const { error } = await supabase.from("bank_accounts" as any).insert({
      name: acctForm.name.trim(),
      bank_name: acctForm.bank_name || null,
      account_number: acctForm.account_number || null,
      currency: acctForm.currency,
      gl_account_id: acctForm.gl_account_id || null,
      opening_balance: Number(acctForm.opening_balance) || 0,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم إضافة الحساب البنكي");
    setOpenAcct(false);
    setAcctForm({ name: "", bank_name: "", account_number: "", currency: "EGP", gl_account_id: "", opening_balance: "0" });
    load();
  };

  const saveStatement = async () => {
    if (!stmtForm.bank_account_id) { toast.error("اختر الحساب البنكي"); return; }
    const { data, error } = await supabase.from("bank_statements" as any).insert({
      bank_account_id: stmtForm.bank_account_id,
      statement_date: stmtForm.statement_date,
      period_start: stmtForm.period_start,
      period_end: stmtForm.period_end,
      opening_balance: Number(stmtForm.opening_balance) || 0,
      closing_balance: Number(stmtForm.closing_balance) || 0,
    }).select().single() as { data: any; error: any };
    if (error) { toast.error(error.message); return; }
    toast.success("تم إنشاء الكشف");
    setOpenStmt(false);
    load();
    if (data?.id) window.location.href = `/admin/accounting/bank-reconciliation/${data.id}`;
  };

  const filteredStatements = selectedAcct ? statements.filter(s => s.bank_account_id === selectedAcct) : statements;

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title="المطابقة البنكية" subtitle="إدارة الحسابات البنكية وكشوف الحسابات ومطابقتها مع الدفاتر" />

        {/* Bank Accounts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Landmark className="w-5 h-5 text-primary" />الحسابات البنكية</CardTitle>
            <Dialog open={openAcct} onOpenChange={setOpenAcct}>
              <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />حساب جديد</Button></DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader><DialogTitle>إضافة حساب بنكي</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>الاسم *</Label><Input value={acctForm.name} onChange={e => setAcctForm({ ...acctForm, name: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>البنك</Label><Input value={acctForm.bank_name} onChange={e => setAcctForm({ ...acctForm, bank_name: e.target.value })} /></div>
                    <div><Label>رقم الحساب</Label><Input value={acctForm.account_number} onChange={e => setAcctForm({ ...acctForm, account_number: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>العملة</Label><Input value={acctForm.currency} onChange={e => setAcctForm({ ...acctForm, currency: e.target.value })} /></div>
                    <div><Label>الرصيد الافتتاحي</Label><Input type="number" value={acctForm.opening_balance} onChange={e => setAcctForm({ ...acctForm, opening_balance: e.target.value })} /></div>
                  </div>
                  <div>
                    <Label>الحساب المحاسبي المرتبط (GL)</Label>
                    <Select value={acctForm.gl_account_id} onValueChange={v => setAcctForm({ ...acctForm, gl_account_id: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر حساب من الدليل" /></SelectTrigger>
                      <SelectContent>
                        {coa.map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter><Button onClick={saveAccount}>حفظ</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">لا توجد حسابات بنكية بعد</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">البنك</TableHead>
                  <TableHead className="text-right">رقم الحساب</TableHead>
                  <TableHead className="text-right">العملة</TableHead>
                  <TableHead className="text-right">الرصيد الافتتاحي</TableHead>
                  <TableHead className="text-right">الحساب المحاسبي</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {accounts.map(a => {
                    const gl = coa.find(c => c.id === a.gl_account_id);
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell>{a.bank_name || "—"}</TableCell>
                        <TableCell>{a.account_number || "—"}</TableCell>
                        <TableCell>{a.currency}</TableCell>
                        <TableCell>{fmt(a.opening_balance)}</TableCell>
                        <TableCell>{gl ? `${gl.code} — ${gl.name}` : <Badge variant="outline">غير مرتبط</Badge>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Statements */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-primary" />كشوف الحسابات</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={selectedAcct || "all"} onValueChange={v => setSelectedAcct(v === "all" ? "" : v)}>
                <SelectTrigger className="w-56"><SelectValue placeholder="كل الحسابات" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحسابات</SelectItem>
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Dialog open={openStmt} onOpenChange={setOpenStmt}>
                <DialogTrigger asChild><Button size="sm" disabled={accounts.length === 0}><Plus className="w-4 h-4 ml-1" />كشف جديد</Button></DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader><DialogTitle>إنشاء كشف حساب</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>الحساب البنكي *</Label>
                      <Select value={stmtForm.bank_account_id} onValueChange={v => setStmtForm({ ...stmtForm, bank_account_id: v })}>
                        <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                        <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div><Label>تاريخ الكشف</Label><Input type="date" value={stmtForm.statement_date} onChange={e => setStmtForm({ ...stmtForm, statement_date: e.target.value })} /></div>
                      <div><Label>من</Label><Input type="date" value={stmtForm.period_start} onChange={e => setStmtForm({ ...stmtForm, period_start: e.target.value })} /></div>
                      <div><Label>إلى</Label><Input type="date" value={stmtForm.period_end} onChange={e => setStmtForm({ ...stmtForm, period_end: e.target.value })} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>الرصيد الافتتاحي</Label><Input type="number" value={stmtForm.opening_balance} onChange={e => setStmtForm({ ...stmtForm, opening_balance: e.target.value })} /></div>
                      <div><Label>الرصيد الختامي</Label><Input type="number" value={stmtForm.closing_balance} onChange={e => setStmtForm({ ...stmtForm, closing_balance: e.target.value })} /></div>
                    </div>
                  </div>
                  <DialogFooter><Button onClick={saveStatement}>حفظ ومتابعة</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {filteredStatements.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">لا توجد كشوف</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-right">الحساب</TableHead>
                  <TableHead className="text-right">تاريخ الكشف</TableHead>
                  <TableHead className="text-right">الفترة</TableHead>
                  <TableHead className="text-right">الرصيد الافتتاحي</TableHead>
                  <TableHead className="text-right">الرصيد الختامي</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredStatements.map(s => {
                    const acc = accounts.find(a => a.id === s.bank_account_id);
                    return (
                      <TableRow key={s.id}>
                        <TableCell>{acc?.name || "—"}</TableCell>
                        <TableCell>{s.statement_date}</TableCell>
                        <TableCell>{s.period_start} → {s.period_end}</TableCell>
                        <TableCell>{fmt(s.opening_balance)}</TableCell>
                        <TableCell>{fmt(s.closing_balance)}</TableCell>
                        <TableCell><Badge variant={s.status === "reconciled" ? "default" : "outline"}>{s.status === "reconciled" ? "مطابق" : s.status === "reconciling" ? "جاري" : "مسودة"}</Badge></TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/admin/accounting/bank-reconciliation/${s.id}`}><ArrowLeftRight className="w-4 h-4 ml-1" />فتح</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
