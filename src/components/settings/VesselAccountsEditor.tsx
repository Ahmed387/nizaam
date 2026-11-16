import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Trash2, Users } from "lucide-react";
import { formatEGP } from "@/lib/format";
import { loadVesselAccounts, type VesselAccount } from "@/lib/vesselAccounts";
import { rpcErrorText } from "@/lib/rpcError";

type Employee = { id: string; name: string; phone: string | null };
type Bal = { vessel_account_id: string | null; balance: number; movements: number };

/**
 * «حسابات الوعاء» (0244) on a vessel card in الإعدادات ← طرق الدفع: the numbers / accounts the money lands on —
 * an employee of the company or an outside number. Only the company owner adds / edits them. Once a vessel has an
 * active account, choosing one is required in every payment with it.
 */
export function VesselAccountsEditor({ method }: { method: string }) {
  const { tenantId, isOwner, isSuperAdmin } = useAuth() as any;
  const canEdit = !!(isOwner || isSuperAdmin);
  const [rows, setRows] = useState<VesselAccount[]>([]);
  const [bal, setBal] = useState<Record<string, Bal>>({});
  const [emps, setEmps] = useState<Employee[]>([]);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState<string>("");          // employee id or "other"
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const all = await loadVesselAccounts(true);
    setRows(all.filter((a) => a.payment_method === method));
    const { data } = await (supabase.rpc as any)("vessel_account_balances", { p_branch: null });
    const m: Record<string, Bal> = {};
    for (const r of (data ?? []) as any[]) if (r.vessel_account_id) m[r.vessel_account_id] = r;
    setBal(m);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [method]);
  useEffect(() => {
    if (!adding || emps.length) return;
    (supabase.from("employees") as any).select("id,name,phone").eq("is_active", true).order("name")
      .then(({ data }: any) => setEmps(data ?? []));
  }, [adding, emps.length]);

  const pickWho = (v: string) => {
    setWho(v);
    if (v === "other") { setName(""); setNumber(""); return; }
    const e = emps.find((x) => x.id === v);
    setName(e?.name ?? "");
    setNumber(e?.phone ?? "");
  };

  const add = async () => {
    if (!who) return toast.error("اختار صاحب الحساب");
    if (!name.trim()) return toast.error("اكتب اسم صاحب الحساب");
    if (!number.trim()) return toast.error("اكتب الرقم / رقم الحساب");
    setBusy(true);
    const { error } = await (supabase.from as any)("vessel_accounts").insert({
      tenant_id: tenantId, payment_method: method, employee_id: who === "other" ? null : who,
      holder_name: name.trim(), account_number: number.trim(), sort_order: rows.length,
    });
    setBusy(false);
    if (error) {
      if ((error as any).code === "23505") return toast.error("الرقم ده متسجل قبل كده في نفس الوعاء");
      return toast.error(rpcErrorText(error, "الحساب"));
    }
    toast.success("الحساب اتضاف");
    setAdding(false); setWho(""); setName(""); setNumber("");
    load();
  };

  const setActive = async (a: VesselAccount, v: boolean) => {
    const { error } = await (supabase.from as any)("vessel_accounts").update({ is_active: v, updated_at: new Date().toISOString() }).eq("id", a.id);
    if (error) return toast.error(rpcErrorText(error, "الحساب"));
    load();
  };

  const remove = async (a: VesselAccount) => {
    if (!window.confirm(`تمسح حساب «${a.holder_name} — ${a.account_number}»؟`)) return;
    const { error } = await (supabase.from as any)("vessel_accounts").delete().eq("id", a.id);
    if (error) return toast.error(rpcErrorText(error, "الحساب"));
    load();
  };

  return (
    <div className="mb-3 rounded-md border border-border/60 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm">
          <div className="font-semibold flex items-center gap-1.5"><Users className="w-4 h-4" /> حسابات الوعاء</div>
          <div className="text-xs text-muted-foreground">
            الأرقام اللي الفلوس بتنزل عليها (موظف من الشركة أو رقم من بره). لو فيه حساب شغال، اختياره بيبقى إجباري في أي دفع بالوعاء ده، وكل حساب ليه رصيده.
          </div>
        </div>
        {canEdit && !adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="w-4 h-4 ml-1" /> ضيف حساب</Button>}
      </div>

      {rows.length === 0 && !adding && <div className="text-xs text-muted-foreground">مفيش حسابات — الدفع بالوعاء ده بيكتب الرقم بإيده زي الأول.</div>}

      {rows.map((a) => {
        const b = bal[a.id];
        const used = (b?.movements ?? 0) > 0;
        return (
          <div key={a.id} className={`flex items-center gap-2 rounded border p-2 text-sm ${a.is_active ? "" : "opacity-60"}`}>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{a.holder_name}{!a.employee_id && <span className="text-xs text-muted-foreground"> (من بره الشركة)</span>}</div>
              <div className="text-xs text-muted-foreground" dir="ltr" style={{ textAlign: "right" }}>{a.account_number}</div>
            </div>
            <div className="text-xs text-left">
              <div className="font-bold tabular-nums">{formatEGP(Number(b?.balance ?? 0))}</div>
              <div className="text-muted-foreground">{b?.movements ?? 0} حركة</div>
            </div>
            {canEdit && (
              <>
                <Switch checked={a.is_active} onCheckedChange={(v) => setActive(a, v)} title={a.is_active ? "شغال" : "موقوف"} />
                {!used && (
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => remove(a)} title="مسح">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        );
      })}

      {adding && (
        <div className="rounded border border-primary/30 bg-primary/5 p-2.5 space-y-2">
          <div>
            <Label className="text-xs">صاحب الحساب</Label>
            <Select value={who} onValueChange={pickWho}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="اختار موظف أو «رقم من بره الشركة»" /></SelectTrigger>
              <SelectContent>
                {emps.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                <SelectItem value="other">➕ رقم من بره الشركة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {who && (
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">الاسم اللي هيظهر</Label>
                <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلًا: رقم أحمد" />
              </div>
              <div>
                <Label className="text-xs">الرقم / رقم الحساب</Label>
                <Input className="mt-1 h-9 text-right" dir="ltr" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="010… أو IBAN" />
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setWho(""); }}>رجوع</Button>
            <Button size="sm" onClick={add} disabled={busy}>{busy ? "..." : "حفظ الحساب"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
