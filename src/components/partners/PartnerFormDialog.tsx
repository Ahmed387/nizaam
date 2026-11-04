import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cairoTodayDay } from "@/lib/cairoDate";
import { fetchMoneyBranches, partnerFormProblem, savePartner, type PartnerForm } from "@/lib/partners";

const EMPTY: PartnerForm = {
  name: "", role_kind: "partner", employee_id: null, operating_on: false, operating_percent: "",
  salary_mode: "none", salary_amount: "", salary_percent: "", salary_base: "company", salary_branch_id: null, salary_when: "before",
  start_date: cairoTodayDay(), notes: "",
};

/**
 * Add a partner, promote an employee, or change a partner's answers (0137).
 *  «شريك بس» — capital only. «موظف وشريك» — he stays an employee: salary fixed (paid with the salaries) or a % of net profit
 *  (company or one branch, before or after the operating shares). «حصة تشغيل» — yes / no, then the % taken first as salary expense.
 */
export function PartnerFormDialog({ initial, onClose, onDone }: { initial?: PartnerForm; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState<PartnerForm>(initial ?? EMPTY);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<PartnerForm>) => setF((x) => ({ ...x, ...p }));
  const editing = !!f.id;

  useEffect(() => {
    supabase.from("employees").select("id, name").eq("is_active", true).order("name").then(({ data }) => setEmployees((data ?? []) as any[]));
    fetchMoneyBranches().then((b) => setBranches(b.filter((x) => !["PARTNER-CASH"].includes(x.code ?? "")))).catch(() => setBranches([]));
  }, []);

  const save = async () => {
    const problem = partnerFormProblem(f);
    if (problem) return toast.error(problem);
    setBusy(true);
    try {
      const id = await savePartner(f);
      toast.success(editing ? "اتحفظت بيانات الشريك" : "اتضاف الشريك — سجّل مساهمته من صفحته");
      onDone(id);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `بيانات الشريك — ${f.name}` : "شريك جديد"}</DialogTitle>
          <DialogDescription>رأس المال بيدخل بعد كده بـ «مساهمة» من صفحة الشريك (بتختار الفرع والوعاء والتاريخ).</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>هو إيه؟</Label>
            <RadioGroup value={f.role_kind} onValueChange={(v) => set({ role_kind: v as PartnerForm["role_kind"], ...(v === "partner" ? { salary_mode: "none" } : {}) })} className="grid grid-cols-2 gap-2">
              <label className={`rounded-lg border p-3 cursor-pointer ${f.role_kind === "partner" ? "border-primary bg-primary/5" : ""}`}>
                <div className="flex items-center gap-2 font-semibold"><RadioGroupItem value="partner" /> شريك بس</div>
                <div className="text-xs text-muted-foreground mt-1">بيحط فلوس وياخد نصيبه من الربح</div>
              </label>
              <label className={`rounded-lg border p-3 cursor-pointer ${f.role_kind === "employee_partner" ? "border-primary bg-primary/5" : ""}`}>
                <div className="flex items-center gap-2 font-semibold"><RadioGroupItem value="employee_partner" /> موظف وشريك</div>
                <div className="text-xs text-muted-foreground mt-1">بيشتغل معانا وليه مرتب + نصيبه كشريك</div>
              </label>
            </RadioGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{f.role_kind === "employee_partner" ? "الموظف" : "موظف عندنا؟ (اختياري)"}</Label>
              <Select value={f.employee_id ?? "none"} onValueChange={(v) => {
                const e = employees.find((x) => x.id === v);
                set({ employee_id: v === "none" ? null : v, ...(e && !f.name ? { name: e.name } : {}) });
              }}>
                <SelectTrigger><SelectValue placeholder="اختار" /></SelectTrigger>
                <SelectContent>
                  {f.role_kind === "partner" && <SelectItem value="none">مش موظف</SelectItem>}
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الاسم</Label>
              <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={f.employee_id ? "اسم الموظف" : ""} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>بداية الشراكة</Label>
              <Input type="date" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} />
            </div>
          </div>

          {f.role_kind === "employee_partner" && (
            <div className="rounded-lg border p-3 space-y-3">
              <Label>مرتبه</Label>
              <RadioGroup value={f.salary_mode} onValueChange={(v) => set({ salary_mode: v as PartnerForm["salary_mode"] })} className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="fixed" /> مرتب ثابت</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="percent" /> نسبة من صافي الربح</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="none" /> مالوش مرتب</label>
              </RadioGroup>
              {f.salary_mode === "fixed" && (
                <div className="max-w-xs">
                  <Label className="text-xs">المرتب في الشهر</Label>
                  <Input type="number" min={0} value={f.salary_amount} onChange={(e) => set({ salary_amount: e.target.value })} />
                  <p className="text-xs text-muted-foreground mt-1">بيتصرف مع مرتبات الموظفين.</p>
                </div>
              )}
              {f.salary_mode === "percent" && (
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">النسبة %</Label>
                      <Input type="number" min={0} max={100} value={f.salary_percent} onChange={(e) => set({ salary_percent: e.target.value })} placeholder="مثلاً 5" />
                    </div>
                    <div>
                      <Label className="text-xs">من ربح</Label>
                      <Select value={f.salary_base} onValueChange={(v) => set({ salary_base: v as PartnerForm["salary_base"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="company">الشركة كلها</SelectItem>
                          <SelectItem value="branch">فرع واحد</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {f.salary_base === "branch" && (
                    <div className="max-w-xs">
                      <Label className="text-xs">الفرع</Label>
                      <Select value={f.salary_branch_id ?? ""} onValueChange={(v) => set({ salary_branch_id: v })}>
                        <SelectTrigger><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
                        <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  <RadioGroup value={f.salary_when} onValueChange={(v) => set({ salary_when: v as PartnerForm["salary_when"] })} className="grid gap-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="before" /> من صافي الربح كله (قبل حصص التشغيل)</label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="after" /> من اللي باقي بعد حصص التشغيل</label>
                  </RadioGroup>
                  <p className="text-xs text-muted-foreground">
                    مثال: ربح الشهر 100,000 ونسبته 5% ← 5,000 مرتب بيتسجل مصروف مرتبات قبل التوزيع. الشهر الخسران انت اللي بتكتب مرتبه.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>حصة تشغيل؟</Label>
                <p className="text-xs text-muted-foreground">نسبة بتتاخد الأول من صافي الربح وتتسجل مرتبات — والباقي بيتقسم على رأس المال.</p>
              </div>
              <Switch checked={f.operating_on} onCheckedChange={(v) => set({ operating_on: v })} />
            </div>
            {f.operating_on && (
              <div className="max-w-xs">
                <Label className="text-xs">النسبة %</Label>
                <Input type="number" min={0} max={100} value={f.operating_percent} onChange={(e) => set({ operating_percent: e.target.value })} placeholder="مثلاً 10" />
              </div>
            )}
          </div>

          <div>
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy}>{editing ? "احفظ" : "ضيف الشريك"}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
