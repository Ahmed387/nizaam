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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { notifyMany, getBranchManagers } from "@/lib/notifications";
import { toast } from "sonner";
import { Plus, ArrowLeftRight, Trash2, Pencil, CheckCircle2 } from "lucide-react";

export default function Treasury() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, branches, isAdmin, hasRole } = useAuth();
  const canTransfer = isAdmin || hasRole("branch_manager");

  const [rows, setRows] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "income" | "expense">("all");
  const [openTransfer, setOpenTransfer] = useState(false);
  const [openExpense, setOpenExpense] = useState(false);
  const [tForm, setTForm] = useState({ to: "", amount: "", reason: "" });
  const [eForm, setEForm] = useState({ type: "operational", amount: "", description: "" });
  const [editing, setEditing] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    const [tr, tt] = await Promise.all([
      supabase.from("treasury").select("*").eq("branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("treasury_transfers").select("*, from_branch:branches!from_branch_id(name), to_branch:branches!to_branch_id(name)").or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`).order("created_at", { ascending: false }),
    ]);
    setRows(tr.data ?? []); setTransfers(tt.data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);

  const balance = useMemo(() => rows.reduce((s, r) => s + (r.type === "income" ? 1 : -1) * Number(r.amount), 0), [rows]);
  const filtered = rows.filter((r) => tab === "all" || r.type === tab);

  const transfer = async () => {
    if (!tForm.to || !tForm.amount) return toast.error("املأ البيانات");
    const amt = Number(tForm.amount);
    if (amt <= 0) return toast.error("المبلغ لازم يكون أكبر من صفر");
    if (amt > balance) return toast.error(`الرصيد غير كافٍ — المتاح: ${formatEGP(balance)}`);
    const { error } = await supabase.rpc("transfer_treasury_atomic", {
      p_from_branch: branchId!, p_to_branch: tForm.to, p_amount: amt, p_reason: tForm.reason || null,
    });
    if (error) return toast.error(error.message);

    const toBr = branches.find((b) => b.id === tForm.to);
    const recipients = await getBranchManagers(tForm.to);
    await notifyMany(recipients, {
      title: "💰 تحويل خزنة وارد",
      body: `استلمت خزنة فرعك ${formatEGP(amt)}${tForm.reason ? ` — ${tForm.reason}` : ""}`,
      type: "general",
      link: `/branch/${tForm.to}/treasury`,
      relatedEntity: "treasury_transfer",
    });

    toast.success(`تم تحويل ${formatEGP(amt)} لـ ${toBr?.name ?? "الفرع"}`);
    setOpenTransfer(false); setTForm({ to: "", amount: "", reason: "" }); load();
  };

  const expense = async () => {
    if (!eForm.amount) return toast.error("أدخل المبلغ");
    await supabase.from("expenses").insert({
      branch_id: branchId!, type: eForm.type, amount: Number(eForm.amount),
      description: eForm.description, date: new Date().toISOString().slice(0, 10), created_by: user!.id,
    });
    // Note: expense_to_treasury trigger auto-creates the treasury entry
    toast.success("تم تسجيل المصروف");
    setOpenExpense(false); setEForm({ type: "operational", amount: "", description: "" }); load();
  };

  const removeRow = async (r: any) => {
    if (!isAdmin) return;
    if (!confirm(`حذف هذا القيد (${formatEGP(r.amount)})؟`)) return;
    const { error } = await supabase.from("treasury").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف"); load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { error } = await supabase.from("treasury").update({
      amount: Number(editing.amount), description: editing.description, category: editing.category,
    }).eq("id", editing.id);
    if (error) return toast.error(error.message);
    toast.success("تم التعديل"); setEditing(null); load();
  };

  const acknowledge = async (t: any) => {
    const { error } = await supabase.rpc("acknowledge_treasury_transfer", { p_transfer_id: t.id });
    if (error) return toast.error(error.message);
    toast.success("تم تأكيد الاستلام"); load();
  };

  const otherBranches = branches.filter((b) => b.id !== branchId);
  const canAck = isAdmin || hasRole("branch_manager");

  return (
    <BranchLayout>
      <PageHeader title="الخزنة"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpenExpense(true)}><Plus className="w-4 h-4 ml-1" /> مصروف</Button>
            {canTransfer && otherBranches.length > 0 && (
              <Button className="btn-gradient" onClick={() => setOpenTransfer(true)}>
                <ArrowLeftRight className="w-4 h-4 ml-1" /> تحويل لفرع
              </Button>
            )}
          </div>
        }
      />

      <div className="card-elevated p-6 mb-6 text-center">
        <div className="text-sm text-muted-foreground mb-2">رصيد الخزنة الحالي</div>
        <div className="text-4xl md:text-5xl font-extrabold gradient-text">{formatEGP(balance)}</div>
      </div>

      <Tabs defaultValue="movements">
        <TabsList>
          <TabsTrigger value="movements">حركات الخزنة</TabsTrigger>
          <TabsTrigger value="transfers">تحويلات بين الفروع ({transfers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="movements" className="mt-4">
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
              ...(isAdmin ? [{ key: "actions", header: "إجراءات", render: (r: any) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ ...r })}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => removeRow(r)} className="text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              )}] : []),
            ]} />
        </TabsContent>

        <TabsContent value="transfers" className="mt-4">
          <DataTable loading={loading} rows={transfers}
            columns={[
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
              { key: "direction", header: "الاتجاه", render: (r: any) => (
                r.from_branch_id === branchId
                  ? <span className="text-destructive font-bold">↗ صادر</span>
                  : <span className="text-success font-bold">↘ وارد</span>
              )},
              { key: "from", header: "من", render: (r: any) => r.from_branch?.name ?? "—" },
              { key: "to", header: "إلى", render: (r: any) => r.to_branch?.name ?? "—" },
              { key: "amount", header: "المبلغ", render: (r: any) => <span className="font-bold">{formatEGP(r.amount)}</span> },
              { key: "reason", header: "السبب", render: (r: any) => r.reason ?? "—" },
              { key: "ack", header: "الاستلام", render: (r: any) => (
                r.acknowledged_at
                  ? <span className="text-xs px-2 py-1 rounded bg-success/15 text-success font-bold">✓ مؤكد {formatDateTime(r.acknowledged_at)}</span>
                  : r.to_branch_id === branchId && canAck
                    ? <Button size="sm" variant="outline" onClick={() => acknowledge(r)}><CheckCircle2 className="w-3.5 h-3.5 ml-1" /> تأكيد الاستلام</Button>
                    : <span className="text-xs px-2 py-1 rounded bg-warning/15 text-warning">بانتظار التأكيد</span>
              )},
            ]} />
        </TabsContent>
      </Tabs>

      <Dialog open={openTransfer} onOpenChange={setOpenTransfer}>
        <DialogContent>
          <DialogHeader><DialogTitle>تحويل لفرع آخر</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              الرصيد المتاح: <span className="font-bold">{formatEGP(balance)}</span>
            </div>
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

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>تعديل قيد الخزنة</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>التصنيف</Label><Input value={editing.category ?? ""} onChange={(e) => setEditing({...editing, category: e.target.value})} className="mt-1.5" /></div>
              <div><Label>المبلغ</Label><Input type="number" value={editing.amount} onChange={(e) => setEditing({...editing, amount: e.target.value})} className="mt-1.5" /></div>
              <div><Label>الوصف</Label><Textarea value={editing.description ?? ""} onChange={(e) => setEditing({...editing, description: e.target.value})} className="mt-1.5" /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button><Button className="btn-gradient" onClick={saveEdit}>حفظ</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
