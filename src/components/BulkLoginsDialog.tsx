import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeError";
import { downloadCsvRows } from "@/lib/csvImport";
import { toast } from "sonner";
import { KeyRound, Download, Loader2, Copy } from "lucide-react";

type Res = { id: string; name: string; email: string; status: string; reason?: string; password?: string };

export function BulkLoginsDialog({
  open, onOpenChange, branchId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId?: string | null;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<"random" | "fixed">("random");
  const [pwd, setPwd] = useState("");
  const [force, setForce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Res[] | null>(null);

  const run = async (dry: boolean) => {
    if (mode === "fixed" && pwd.length < 6) return toast.error("كلمة المرور الافتراضية 6 حروف على الأقل");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-bulk-employee-logins", {
        body: { branch_id: branchId ?? null, mode, fixed_password: pwd, force_change: force, dry_run: dry },
      });
      if (error || (data as any)?.error) {
        return toast.error((await edgeErrorMessage(error, data)) ?? "فشلت العملية");
      }
      setResults((data as any).results ?? []);
      if (!dry) {
        toast.success(`اتعمل ${(data as any).created} حساب`, {
          description: `متخطي ${(data as any).skipped} • فشل ${(data as any).failed}`,
        });
        onDone?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    downloadCsvRows(
      "employee-logins",
      ["الاسم / Name", "الإيميل / Email", "كلمة المرور / Password", "الحالة / Status", "ملاحظة / Note"],
      (results ?? []).map((r) => [r.name, r.email, r.password ?? "", r.status, r.reason ?? ""]),
    );
  };

  const copyAll = () => {
    const txt = (results ?? []).filter((r) => r.password && r.status === "created")
      .map((r) => `${r.name} — ${r.email} — ${r.password}`).join("\n");
    navigator.clipboard.writeText(txt);
    toast.success("اتنسخت البيانات");
  };

  const created = (results ?? []).filter((r) => r.status === "created").length;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setResults(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> إنشاء حسابات دخول جماعية
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground leading-6">
            هيتعمل حساب دخول لكل موظف نشط في الفرع <b>عنده إيميل ولسه مالوش حساب</b>. اللي عنده حساب أو مفيش
            إيميل هيتساب زي ما هو من غير ما يتلمس.
          </p>

          <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="space-y-2">
            <label className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer">
              <RadioGroupItem value="random" className="mt-1" />
              <div>
                <div className="font-semibold text-sm">كلمة مرور عشوائية لكل موظف</div>
                <div className="text-xs text-muted-foreground">الأأمن — هتنزّل ملف فيه الباسوردات وتوزّعها.</div>
              </div>
            </label>
            <label className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer">
              <RadioGroupItem value="fixed" className="mt-1" />
              <div className="flex-1">
                <div className="font-semibold text-sm">كلمة مرور افتراضية واحدة للكل</div>
                <div className="text-xs text-muted-foreground mb-2">أسهل في التوزيع — لازم يغيروها أول دخول.</div>
                {mode === "fixed" && (
                  <Input dir="ltr" className="text-right" placeholder="Nizam@2026"
                    value={pwd} onChange={(e) => setPwd(e.target.value)} />
                )}
              </div>
            </label>
          </RadioGroup>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={force} onCheckedChange={(v) => setForce(!!v)} />
            إجبار الموظف على تغيير كلمة المرور أول ما يدخل
          </label>

          {results && (
            <div className="rounded-lg border max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>{["الاسم", "الإيميل", "كلمة المرور", "الحالة"].map((h) => (
                    <th key={h} className="px-2 py-2 font-bold">{h}</th>))}</tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5 font-mono" dir="ltr">{r.email || "—"}</td>
                      <td className="px-2 py-1.5 font-mono" dir="ltr">{r.password ?? "—"}</td>
                      <td className="px-2 py-1.5 text-center">
                        {r.status === "created" ? <Badge className="bg-success/15 text-success">اتعمل</Badge>
                          : r.status === "ready" ? <Badge variant="outline">جاهز</Badge>
                            : r.status === "skipped" ? <Badge variant="secondary" title={r.reason}>متخطي</Badge>
                              : <Badge variant="destructive" title={r.reason}>فشل</Badge>}
                        {r.reason && <div className="text-[10px] text-muted-foreground">{r.reason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          {created > 0 && (
            <>
              <Button variant="outline" onClick={exportCsv}><Download className="w-4 h-4 ml-1" /> تنزيل الباسوردات</Button>
              <Button variant="outline" onClick={copyAll}><Copy className="w-4 h-4 ml-1" /> نسخ</Button>
            </>
          )}
          <Button variant="outline" disabled={busy} onClick={() => run(true)}>معاينة مين هيتعملّه حساب</Button>
          <Button disabled={busy || created > 0} onClick={() => run(false)}>
            {busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <KeyRound className="w-4 h-4 ml-1" />}
            إنشاء الحسابات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
