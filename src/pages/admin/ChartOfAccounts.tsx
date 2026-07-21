import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, BookOpen } from "lucide-react";

type Account = {
  id: string; code: string; name: string; name_ar: string | null;
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
  normal_balance: "debit" | "credit"; is_system: boolean; is_active: boolean;
};

const typeLabels: Record<string, string> = {
  asset: "أصول", liability: "خصوم", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات",
};
const typeColors: Record<string, string> = {
  asset: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  liability: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  equity: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  revenue: "bg-green-500/15 text-green-600 border-green-500/30",
  expense: "bg-red-500/15 text-red-600 border-red-500/30",
};

export default function ChartOfAccounts() {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<Account[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", name_ar: "", account_type: "asset", normal_balance: "debit" });

  const load = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("chart_of_accounts" as any)
      .select("*").eq("tenant_id", tenantId).order("code");
    setRows((data ?? []) as any);
  };
  useEffect(() => { load(); }, [tenantId]);

  const save = async () => {
    if (!form.code || !form.name) { toast.error("الكود والاسم مطلوبان"); return; }
    const { error } = await supabase.from("chart_of_accounts" as any).insert({
      tenant_id: tenantId, code: form.code, name: form.name, name_ar: form.name_ar || null,
      account_type: form.account_type, normal_balance: form.normal_balance, is_system: false,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("تم إضافة الحساب");
    setOpen(false);
    setForm({ code: "", name: "", name_ar: "", account_type: "asset", normal_balance: "debit" });
    load();
  };

  const filtered = filter === "all" ? rows : rows.filter(r => r.account_type === filter);

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title="دليل الحسابات" subtitle="إدارة الحسابات المحاسبية" icon={<BookOpen />} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>الحسابات ({filtered.length})</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأنواع</SelectItem>
                  <SelectItem value="asset">أصول</SelectItem>
                  <SelectItem value="liability">خصوم</SelectItem>
                  <SelectItem value="equity">حقوق ملكية</SelectItem>
                  <SelectItem value="revenue">إيرادات</SelectItem>
                  <SelectItem value="expense">مصروفات</SelectItem>
                </SelectContent>
              </Select>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild><Button><Plus className="w-4 h-4 ml-1" />حساب جديد</Button></DialogTrigger>
                <DialogContent dir="rtl" className="text-right">
                  <DialogHeader><DialogTitle>إضافة حساب</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>الكود</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
                    <div><Label>الاسم بالإنجليزية</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div><Label>الاسم بالعربية</Label><Input value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })} /></div>
                    <div>
                      <Label>النوع</Label>
                      <Select value={form.account_type} onValueChange={v => setForm({ ...form, account_type: v, normal_balance: (v === "asset" || v === "expense") ? "debit" : "credit" })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asset">أصول</SelectItem>
                          <SelectItem value="liability">خصوم</SelectItem>
                          <SelectItem value="equity">حقوق ملكية</SelectItem>
                          <SelectItem value="revenue">إيرادات</SelectItem>
                          <SelectItem value="expense">مصروفات</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>الرصيد الطبيعي</Label>
                      <Select value={form.normal_balance} onValueChange={v => setForm({ ...form, normal_balance: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="debit">مدين</SelectItem>
                          <SelectItem value="credit">دائن</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter><Button onClick={save}>حفظ</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الكود</TableHead>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">النوع</TableHead>
                  <TableHead className="text-right">الرصيد الطبيعي</TableHead>
                  <TableHead className="text-right">النظام</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono font-semibold">{a.code}</TableCell>
                    <TableCell>{a.name_ar || a.name}</TableCell>
                    <TableCell><Badge variant="outline" className={typeColors[a.account_type]}>{typeLabels[a.account_type]}</Badge></TableCell>
                    <TableCell>{a.normal_balance === "debit" ? "مدين" : "دائن"}</TableCell>
                    <TableCell>{a.is_system ? <Badge variant="secondary">افتراضي</Badge> : "-"}</TableCell>
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
