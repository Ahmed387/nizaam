import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { fin } from "@/lib/financeTerms";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Row = {
  account_id: string; code: string; name: string; name_ar: string | null;
  account_type: string; normal_balance: "debit" | "credit";
  total_debit: number; total_credit: number; balance: number;
};

const typeLabels: Record<string, string> = {
  asset: "أصول", liability: "خصوم", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات",
};

export default function TrialBalance() {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("v_account_balances" as any).select("*").eq("tenant_id", tenantId).order("code")
      .then(({ data }) => setRows((data ?? []) as any));
  }, [tenantId]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Show only accounts with movement or non-zero balance
  const displayed = rows.filter(r => Number(r.total_debit) !== 0 || Number(r.total_credit) !== 0);

  const totals = useMemo(() => {
    let td = 0, tc = 0;
    displayed.forEach(r => {
      const bal = Number(r.balance) || 0;
      if (r.normal_balance === "debit") {
        if (bal >= 0) td += bal; else tc += -bal;
      } else {
        if (bal >= 0) tc += bal; else td += -bal;
      }
    });
    return { td, tc };
  }, [displayed]);

  const isBalanced = Math.abs(totals.td - totals.tc) < 0.01;

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title={fin("trialBalance")} subtitle="أرصدة كل الحسابات — المدين (Debit) لازم يساوي الدائن (Credit)" />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>الأرصدة ({displayed.length} حساب)</CardTitle>
            <Badge variant={isBalanced ? "default" : "destructive"} className={isBalanced ? "bg-green-500/15 text-green-600 border-green-500/30" : ""}>
              {isBalanced ? "الميزان متوازن ✓" : "غير متوازن ✗"}
            </Badge>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الكود</TableHead>
                  <TableHead className="text-right">الحساب</TableHead>
                  <TableHead className="text-right">النوع</TableHead>
                  <TableHead className="text-right">مجموع المدين</TableHead>
                  <TableHead className="text-right">مجموع الدائن</TableHead>
                  <TableHead className="text-right">رصيد مدين</TableHead>
                  <TableHead className="text-right">رصيد دائن</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(r => {
                  const bal = Number(r.balance) || 0;
                  const isDebitSide = r.normal_balance === "debit" ? bal >= 0 : bal < 0;
                  const absBal = Math.abs(bal);
                  return (
                    <TableRow key={r.account_id}>
                      <TableCell className="font-mono">{r.code}</TableCell>
                      <TableCell>{r.name_ar || r.name}</TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{typeLabels[r.account_type]}</span></TableCell>
                      <TableCell className="font-mono">{fmt(r.total_debit)}</TableCell>
                      <TableCell className="font-mono">{fmt(r.total_credit)}</TableCell>
                      <TableCell className="font-mono">{isDebitSide ? fmt(absBal) : "-"}</TableCell>
                      <TableCell className="font-mono">{!isDebitSide ? fmt(absBal) : "-"}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="font-bold bg-muted/50 text-lg">
                  <TableCell colSpan={5}>الإجمالي</TableCell>
                  <TableCell className="font-mono">{fmt(totals.td)}</TableCell>
                  <TableCell className="font-mono">{fmt(totals.tc)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
