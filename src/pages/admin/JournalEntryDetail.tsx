import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";

export default function JournalEntryDetail() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useAuth();
  const [entry, setEntry] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);

  useEffect(() => {
    if (!id || !tenantId) return;
    (async () => {
      const { data: e } = await supabase.from("journal_entries" as any).select("*").eq("id", id).maybeSingle();
      setEntry(e);
      const { data: l } = await supabase.from("journal_entry_lines" as any)
        .select("*, chart_of_accounts(code,name,name_ar)").eq("entry_id", id).order("line_order");
      setLines((l ?? []) as any);
    })();
  }, [id, tenantId]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!entry) return <AdminLayout><div className="p-8">جاري التحميل...</div></AdminLayout>;

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader title={`قيد ${entry.entry_number}`} subtitle={entry.description || ""} />
          <Button asChild variant="outline"><Link to="/admin/accounting/journal"><ArrowRight className="w-4 h-4 ml-1" />القيود</Link></Button>
        </div>

        <Card>
          <CardHeader><CardTitle>بيانات القيد</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-muted-foreground">التاريخ</div><div className="font-semibold">{format(new Date(entry.entry_date), "yyyy-MM-dd")}</div></div>
            <div><div className="text-muted-foreground">المصدر</div><div className="font-semibold">{entry.source_type || "-"}</div></div>
            <div><div className="text-muted-foreground">الحالة</div><Badge variant={entry.status === "posted" ? "default" : "secondary"}>{entry.status}</Badge></div>
            <div><div className="text-muted-foreground">الإجمالي</div><div className="font-semibold">{fmt(entry.total_debit)}</div></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>بنود القيد</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الحساب</TableHead>
                  <TableHead className="text-right">الوصف</TableHead>
                  <TableHead className="text-right">مدين</TableHead>
                  <TableHead className="text-right">دائن</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => (
                  <TableRow key={l.id}>
                    <TableCell><span className="font-mono">{l.chart_of_accounts?.code}</span> — {l.chart_of_accounts?.name_ar || l.chart_of_accounts?.name}</TableCell>
                    <TableCell className="text-sm">{l.description}</TableCell>
                    <TableCell className="font-mono">{Number(l.debit) > 0 ? fmt(l.debit) : "-"}</TableCell>
                    <TableCell className="font-mono">{Number(l.credit) > 0 ? fmt(l.credit) : "-"}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/50">
                  <TableCell colSpan={2}>الإجمالي</TableCell>
                  <TableCell className="font-mono">{fmt(entry.total_debit)}</TableCell>
                  <TableCell className="font-mono">{fmt(entry.total_credit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
