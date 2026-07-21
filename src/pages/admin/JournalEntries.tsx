import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

type Entry = {
  id: string; entry_number: string; entry_date: string; description: string | null;
  source_type: string | null; status: string; total_debit: number; total_credit: number;
};

export default function JournalEntries() {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<Entry[]>([]);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    let query = supabase.from("journal_entries" as any).select("*")
      .eq("tenant_id", tenantId).order("entry_date", { ascending: false }).order("entry_number", { ascending: false }).limit(500);
    if (from) query = query.gte("entry_date", from);
    if (to) query = query.lte("entry_date", to);
    query.then(({ data }) => setRows((data ?? []) as any));
  }, [tenantId, from, to]);

  const filtered = q ? rows.filter(r =>
    r.entry_number.includes(q) || (r.description ?? "").includes(q) || (r.source_type ?? "").includes(q)
  ) : rows;

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
          <CardHeader><CardTitle>القيود ({filtered.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم القيد</TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">الوصف</TableHead>
                  <TableHead className="text-right">المصدر</TableHead>
                  <TableHead className="text-right">مدين</TableHead>
                  <TableHead className="text-right">دائن</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id} className="hover:bg-muted/50 cursor-pointer">
                    <TableCell className="font-mono">
                      <Link to={`/admin/accounting/journal/${r.id}`} className="text-primary hover:underline">{r.entry_number}</Link>
                    </TableCell>
                    <TableCell>{format(new Date(r.entry_date), "yyyy-MM-dd")}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.source_type}</TableCell>
                    <TableCell className="font-mono">{fmt(r.total_debit)}</TableCell>
                    <TableCell className="font-mono">{fmt(r.total_credit)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "posted" ? "default" : r.status === "reversed" ? "destructive" : "secondary"}>
                        {r.status === "posted" ? "مرحّل" : r.status === "reversed" ? "معكوس" : r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
