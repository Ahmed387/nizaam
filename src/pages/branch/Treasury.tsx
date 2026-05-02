import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, ArrowLeftRight } from "lucide-react";

export default function Treasury() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, branches, isAdmin } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "income" | "expense">("all");
  const [openTransfer, setOpenTransfer] = useState(false);
  const [openExpense, setOpenExpense] = useState(false);
  const [tForm, setTForm] = useState({ to: "", amount: "", reason: "" });
  const [eForm, setEForm] = useState({ type: "operational", amount: "", description: "" });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("treasury").select("*").eq("branch_id", branchId).order("created_at", { ascending: false });
    setRows(data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);

  const balance = useMemo(() => rows.reduce((s, r) => s + (r.type === "income" ? 1 : -1) * Number(r.amount), 0), [rows]);
  const filtered = rows.filter((r) => tab === "all" || r.type === tab);

  const transfer = async () => {
    if (!tForm.to || !tForm.amount) return toast.error("املأ البيانات");
    const amt = Number(tForm.amount);
    if (amt <= 0) return toast.error("المبلغ لازم يكون أكبر من صفر");
    const { error } = await supabase.rpc("transfer_treasury_atomic", {
      p_from_branch: branchId!,
      p_to_branch: tForm.to,
      p_amount: amt,
      p_reason: tForm.reason || null,
    });
    if (error) return toast.error(error.message);
    toast.success("تم التحويل");
    setOpenTransfer(false); setTForm({ to: "", amount: "", reason: "" }); load();
  };

  const expense = async () => {
    if (!eForm.amount) return toast.error("أدخل المبلغ");
    await supabase.from("treasury").insert({
      branch_id: branchId!, type: "expense", category: eForm.type,
      amount: Number(eForm.amount), description: eForm.description, created_by: user!.id,
    });
    await supabase.from("expenses").insert({
      branch_id: branchId!, type: eForm.type, amount: Number(eForm.amount),
      description: eForm.description, date: new Date().toISOString().slice(0, 10), created_by: user!.id,
    });
    toast.success("تم تسجيل المصروف");
    setOpenExpense(false); setEForm({ type: "operational", amount: "", description: "" }); load();
  };

  const otherBranches = branches.filter((b) => b.id !== branchId);

  return (
    <BranchLayout>
      <PageHeader title="الخزنة"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpenExpense(true)}><Plus className="w-4 h-4 ml-1" /> مصروف</Button>
            {(isAdmin || otherBranches.length > 0) && <Button className="btn-gradient" onClick={() => setOpenTransfer(true)}><ArrowLeftRight className="w-4 h-4 ml-1" /> تحويل</Button>}
          </div>
        }
      />

      <div className="card-elevated p-6 mb-6 text-center">
        <div className="text-sm text-muted-foreground mb-2">رصيد الخزنة الحالي</div>
        <div className="text-4xl md:text-5xl font-extrabold gradient-text">{formatEGP(balance)}</div>
      </div>

      <div className="flex gap-2 mb-4">
        {(["all", "income", "expense"] as const).map((t) => (
          <Button key={t} variant={tab === t ? "default" : "outline"} size="sm" onClick={() => setTab(t)}>
            {t === "all" ? "الكل" : t === "income" ? "دخول" : "خروج"}
          </Button>
        ))}
      </div>

      <DataTable loading={loading} rows={filtered}
        columns={[
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
          { key: "type", header: "النوع", render: (r: any) => (
            <span className={`px-2 py-1 rounded text-xs font-bold ${r.type === "income" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
              {r.type === "income" ? "💚 دخول" : "🔴 خروج"}
            </span>
          )},
          { key: "category", header: "التصنيف" },
          { key: "description", header: "الوصف" },
          { key: "amount", header: "المبلغ", render: (r: any) => (
            <span className={r.type === "income" ? "text-success font-bold" : "text-destructive font-bold"}>
              {r.type === "income" ? "+" : "-"} {formatEGP(r.amount)}
            </span>
          )},
        ]} />

      <Dialog open={openTransfer} onOpenChange={setOpenTransfer}>
        <DialogContent>
          <DialogHeader><DialogTitle>تحويل لفرع آخر</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الفرع المستهدف *</Label>
              <select className="w-full bg-input border border-border rounded-lg p-2 mt-1.5" value={tForm.to} onChange={(e) => setTForm({...tForm, to: e.target.value})}>
                <option value="">— اختر —</option>
                {otherBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div><Label>المبلغ *</Label><Input type="number" value={tForm.amount} onChange={(e) => setTForm({...tForm, amount: e.target.value})} className="mt-1.5" /></div>
            <div><Label>السبب</Label><Textarea value={tForm.reason} onChange={(e) => setTForm({...tForm, reason: e.target.value})} className="mt-1.5" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenTransfer(false)}>إلغاء</Button><Button className="btn-gradient" onClick={transfer}>تحويل</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openExpense} onOpenChange={setOpenExpense}>
        <DialogContent>
          <DialogHeader><DialogTitle>تسجيل مصروف</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>النوع</Label>
              <select className="w-full bg-input border border-border rounded-lg p-2 mt-1.5" value={eForm.type} onChange={(e) => setEForm({...eForm, type: e.target.value})}>
                <option value="operational">تشغيلية</option>
                <option value="shipping">شحن ونقل</option>
                <option value="admin">إدارية</option>
              </select>
            </div>
            <div><Label>المبلغ *</Label><Input type="number" value={eForm.amount} onChange={(e) => setEForm({...eForm, amount: e.target.value})} className="mt-1.5" /></div>
            <div><Label>الوصف</Label><Textarea value={eForm.description} onChange={(e) => setEForm({...eForm, description: e.target.value})} className="mt-1.5" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenExpense(false)}>إلغاء</Button><Button className="btn-gradient" onClick={expense}>تسجيل</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
