import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Eye, EyeOff, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
import { accountText, loadVesselAccounts, type VesselAccount } from "@/lib/vesselAccounts";
import { LEVEL_LABEL, loadVesselRulesOf, rowsToSave, saveVesselRules, type VesselLevel } from "@/lib/vesselAccess";

const LEVELS: VesselLevel[] = ["use", "view", "hidden"];
const TONE: Record<VesselLevel, string> = {
  use: "border-emerald-400 bg-emerald-50 text-emerald-800",
  view: "border-amber-400 bg-amber-50 text-amber-800",
  hidden: "border-rose-400 bg-rose-50 text-rose-700",
};

function LevelChoice({ value, onChange, label, inherit }: { value: VesselLevel | "inherit"; onChange: (v: VesselLevel | "inherit") => void; label: string; inherit?: VesselLevel }) {
  const opts: (VesselLevel | "inherit")[] = inherit ? ["inherit", ...LEVELS] : LEVELS;
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {opts.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)}
          className={`rounded-full border px-3 py-1 text-xs font-bold min-h-[32px] ${value === o ? (o === "inherit" ? "border-primary bg-primary/10 text-primary" : TONE[o]) : "border-border bg-background text-muted-foreground"}`}>
          {o === "inherit" ? `زي الوعاء (${LEVEL_LABEL[inherit!]})` : LEVEL_LABEL[o]}
        </button>
      ))}
    </div>
  );
}

/**
 * «الأوعية لكل شخص» (migration 0281, owner 2026-11-25): the owner picks a person, then for each vessel «يشوف ويستخدم» /
 * «يشوف بس مايدفعش» / «مخفي خالص» — and, for a vessel with several numbers, each number alone (or «زي الوعاء»).
 * The server enforces it (no new money, hidden rows / balances not readable); the owner himself is never limited.
 */
export function VesselAccessEditor() {
  const { isOwner, user } = useAuth();
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [who, setWho] = useState("");
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [accounts, setAccounts] = useState<VesselAccount[]>([]);
  const [vessels, setVessels] = useState<Record<string, VesselLevel>>({});
  const [accLevels, setAccLevels] = useState<Record<string, VesselLevel>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    supabase.from("profiles").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setPeople(((data ?? []) as any[]).filter((p) => p.id !== user?.id)));
    loadAllPaymentMethods(true).then((m) => setMethods(m.filter((x) => x.is_enabled !== false))).catch(() => setMethods([]));
    loadVesselAccounts().then((a) => setAccounts((a ?? []).filter((x) => x.is_active))).catch(() => setAccounts([]));
  }, [isOwner, user?.id]);

  useEffect(() => {
    if (!who) return;
    loadVesselRulesOf(who).then((rows) => {
      setVessels(Object.fromEntries(rows.filter((r) => !r.account_id).map((r) => [r.method, r.level])));
      setAccLevels(Object.fromEntries(rows.filter((r) => r.account_id).map((r) => [`${r.method}:${r.account_id}`, r.level])));
    }).catch((e) => toast.error(e.message));
  }, [who]);

  const accountsOf = useMemo(() => (m: string) => accounts.filter((a) => a.payment_method === m), [accounts]);
  if (!isOwner) return null;

  const save = async () => {
    if (!who) return toast.error("اختار الشخص");
    setBusy(true);
    try {
      await saveVesselRules(who, rowsToSave(vessels, accLevels));
      toast.success(`اتحفظت الأوعية لـ ${people.find((p) => p.id === who)?.name ?? ""}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /> الأوعية لكل شخص</CardTitle>
        <p className="text-xs text-muted-foreground">
          لكل شخص: كل وعاء «يشوف ويستخدم» أو «يشوف بس مايدفعش» أو «مخفي خالص» — والوعاء اللي فيه أكتر من رقم تقدر تحدد كل رقم لوحده.
          انت كصاحب الشركة بتشوف كل الأوعية دايماً.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm">
          <Label htmlFor="va-person">الشخص</Label>
          <select id="va-person" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">اختار…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {who && (
          <div className="space-y-2">
            {methods.map((m) => {
              const level = vessels[m.value] ?? "use";
              const accs = accountsOf(m.value);
              return (
                <div key={m.value} className="rounded-xl border p-3 space-y-2" data-testid={`vessel-${m.value}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold flex items-center gap-2">
                      {level === "hidden" ? <EyeOff className="w-4 h-4 text-rose-600" /> : <Eye className="w-4 h-4 text-emerald-600" />}
                      {m.label}
                    </div>
                    <LevelChoice label={m.label} value={level} onChange={(v) => setVessels({ ...vessels, [m.value]: v as VesselLevel })} />
                  </div>
                  {accs.length > 0 && (
                    <>
                      <Button type="button" variant="ghost" size="sm" className="gap-1 px-1" onClick={() => setOpen({ ...open, [m.value]: !open[m.value] })}>
                        {open[m.value] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} كل رقم لوحده ({accs.length})
                      </Button>
                      {open[m.value] && (
                        <div className="space-y-2 border-r-2 pr-3">
                          {accs.map((a) => {
                            const key = `${m.value}:${a.id}`;
                            return (
                              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span dir="auto">{accountText(a)}</span>
                                <LevelChoice label={accountText(a)} inherit={level} value={accLevels[key] ?? "inherit"}
                                  onChange={(v) => {
                                    const next = { ...accLevels };
                                    if (v === "inherit") delete next[key]; else next[key] = v;
                                    setAccLevels(next);
                                  }} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <Button onClick={save} disabled={busy}>احفظ</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
