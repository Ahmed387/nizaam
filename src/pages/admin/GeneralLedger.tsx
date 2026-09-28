import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

type Account = { id: string; code: string; name: string; name_ar: string | null; normal_balance: "debit" | "credit" };
type Line = { id: string; entry_id: string; debit: number; credit: number; description: string | null;
  journal_entries: { entry_number: string; entry_date: string; description: string | null; status: string } };

export default function GeneralLedger() {
  const { tenantId } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("chart_of_accounts" as any).select("id,code,name,name_ar,normal_balance")
      .eq("tenant_id", tenantId).eq("is_active", true).order("code")
      .then(({ data }) => setAccounts((data ?? []) as any));
  }, [tenantId]);

  useEffect(() => {
    if (!accountId) { setLines([]); return; }
    const build = () => {
    let q = supabase.from("journal_entry_lines" as any)
      .select("*, journal_entries!inner(entry_number,entry_date,description,status)")
      .eq("account_id", accountId).eq("journal_entries.status", "posted")
      .order("entry_date", { referencedTable: "journal_entries", ascending: true });
    if (from) q = q.gte("journal_entries.entry_date", from);
    if (to) q = q.lte("journal_entries.entry_date", to);
    return q.order("id");
    };
    fetchAllRows<any>(build)
      .then((data) => {
        const sorted = [...data].sort((a, b) => String(a.journal_entries?.entry_date ?? "").localeCompare(String(b.journal_entries?.entry_date ?? "")));
        setLines(sorted as any);
      })
      .catch(() => setLines([]));
  }, [accountId, from, to]);

  const account = accounts.find(a => a.id === accountId);
  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rowsWithBalance = useMemo(() => {
    if (!account) return [];
    let running = 0;
    return lines.map(l => {
      const d = Number(l.debit) || 0;
      const c = Number(l.credit) || 0;
      running += account.normal_balance === "debit" ? (d - c) : (c - d);
      return { ...l, balance: running };
    });
  }, [lines, account]);

  const totals = rowsWithBalance.reduce((s, r) => ({ d: s.d + Number(r.debit || 0), c: s.c + Number(r.credit || 0) }), { d: 0, c: 0 });

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title="دفتر الأستاذ" subtitle="حركة حساب معين" />

        <Card>
          <CardHeader><CardTitle>الفلاتر</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>الحساب</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="اختر حساب" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name_ar || a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>من</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label>إلى</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          </CardContent>
        </Card>

        {account && (
          <Card>
            <CardHeader><CardTitle>{account.code} — {account.name_ar || account.name}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-right">رقم القيد</TableHead>
                    <TableHead className="text-right">الوصف</TableHead>
                    <TableHead className="text-right">مدين</TableHead>
                    <TableHead className="text-right">دائن</TableHead>
                    <TableHead className="text-right">الرصيد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rowsWithBalance.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{format(new Date(r.journal_entries.entry_date), "yyyy-MM-dd")}</TableCell>
                      <TableCell className="font-mono text-sm">{r.journal_entries.entry_number}</TableCell>
                      <TableCell className="text-sm">{r.description || r.journal_entries.description}</TableCell>
                      <TableCell className="font-mono">{Number(r.debit) > 0 ? fmt(r.debit) : "-"}</TableCell>
                      <TableCell className="font-mono">{Number(r.credit) > 0 ? fmt(r.credit) : "-"}</TableCell>
                      <TableCell className="font-mono font-semibold">{fmt(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell colSpan={3}>الإجمالي</TableCell>
                    <TableCell className="font-mono">{fmt(totals.d)}</TableCell>
                    <TableCell className="font-mono">{fmt(totals.c)}</TableCell>
                    <TableCell className="font-mono">{fmt(rowsWithBalance.at(-1)?.balance ?? 0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
