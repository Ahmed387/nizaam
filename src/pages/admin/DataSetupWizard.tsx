import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  ListOrdered, Wallet, Lock, Search, ShieldAlert, CheckCircle2, FileSpreadsheet,
  ChevronLeft, ChevronRight, Save, Trash2,
} from "lucide-react";
import CoreDataImport from "./CoreDataImport";
import DataMigration from "./DataMigration";
import { StepIntro, SheetGuideList, TabPurpose, CORE_SHEETS, LEGACY_SHEET } from "@/components/data-setup/SetupGuide";

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Contact = { id: string; name: string; type: string; phone: string | null; opening_balance: number };

const STEPS = [
  { n: 1, title: "القوائم الأساسية", icon: ListOrdered },
  { n: 2, title: "الأرصدة الافتتاحية", icon: Wallet },
  { n: 3, title: "القفل التلقائي", icon: Lock },
] as const;

/* ============ خطوة 2: الأرصدة الافتتاحية لكل عميل/مورد ============ */
function OpeningStep({ onGoLegacy }: { onGoLegacy: () => void }) {
  const { tenantId } = useAuth() as any;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [legacy, setLegacy] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [openingDate, setOpeningDate] = useState(`${new Date().getFullYear()}-01-01`);

  const load = async () => {
    if (!tenantId) return;
    const [c, inv, sh, pr] = await Promise.all([
      supabase.from("contacts" as any).select("id,name,type,phone,opening_balance").eq("tenant_id", tenantId).order("name"),
      supabase.from("invoices" as any).select("contact_id").eq("tenant_id", tenantId).not("migration_batch_id", "is", null),
      supabase.from("shipments" as any).select("contact_id").eq("tenant_id", tenantId).not("migration_batch_id", "is", null),
      supabase.from("purchase_returns" as any).select("contact_id").eq("tenant_id", tenantId).not("migration_batch_id", "is", null),
    ]);
    const map: Record<string, number> = {};
    [...((inv.data as any) ?? []), ...((sh.data as any) ?? []), ...((pr.data as any) ?? [])]
      .forEach((r: any) => { if (r.contact_id) map[r.contact_id] = (map[r.contact_id] ?? 0) + 1; });
    setLegacy(map);
    setContacts((((c.data as any) ?? []) as any[]).map((x) => ({ ...x, opening_balance: Number(x.opening_balance) || 0 })));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(s) || (c.phone ?? "").includes(s));
  }, [contacts, q]);

  /** بيدمج الرصيد الجديد مع الأرصدة المسجّلة وبيعيد النشر مرة واحدة من غير ازدواج */
  const saveBalance = async (contact: Contact, value: number) => {
    setBusy(true);
    try {
      const { data: snap } = await supabase.rpc("get_opening_balances" as any);
      const s: any = snap ?? {};
      const cash = ((s.cash ?? []) as any[]).filter((r) => r.branch_id)
        .map((r) => ({ branch_id: r.branch_id, amount: Number(r.amount) || 0 }));
      const contactsMap: Record<string, number> = {};
      ((s.contacts ?? []) as any[]).forEach((r) => { contactsMap[r.contact_id] = Number(r.amount) || 0; });
      contactsMap[contact.id] = value;
      const inventory = ((s.inventory ?? []) as any[]).map((r) => ({
        product_id: r.product_id, quantity: Number(r.quantity) || 0, cost_price: Number(r.cost_price) || 0,
      }));
      if (s.opening_date) setOpeningDate(String(s.opening_date).slice(0, 10));

      const { error } = await supabase.rpc("post_opening_balances" as any, {
        p_date: s.opening_date ? String(s.opening_date).slice(0, 10) : openingDate,
        p_cash: cash,
        p_contacts: Object.entries(contactsMap).filter(([, v]) => v !== 0).map(([contact_id, amount]) => ({ contact_id, amount })),
        p_inventory: inventory.filter((i) => i.quantity > 0),
      });
      if (error) throw error;
      toast.success(value === 0 ? `اتشال الرصيد الافتتاحي بتاع ${contact.name}` : `اتسجل رصيد افتتاحي لـ ${contact.name}: ${fmt(value)}`);
      setOpenId(null);
      await load();
    } catch (e: any) {
      toast.error("الحركة اترفضت", { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">لكل عميل/مورد: عندك ديون قديمة عليه/له تحب تدخلها؟</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• <b>رصيد إجمالي</b>: رقم واحد مجمّع (موجب = العميل مدين لك، سالب = إنت مدين للمورد).</p>
          <p>• <b>فواتير تاريخية مفصّلة</b>: ترفع فواتيره القديمة بتاريخها الحقيقي وحالة سدادها من تبويب الترحيل.</p>
          <p>• اختار طريقة واحدة بس لكل حساب — النظام هيقفل التانية تلقائيًا عشان الدين ميتحسبش مرتين.</p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="دوّر باسم العميل/المورد أو التليفون" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Badge variant="outline">{filtered.length} حساب</Badge>
      </div>

      <div className="space-y-2">
        {filtered.map((c) => {
          const hasLegacy = (legacy[c.id] ?? 0) > 0;
          const hasBalance = c.opening_balance !== 0;
          return (
            <Card key={c.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.phone ?? "—"}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasLegacy && <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">فواتير تاريخية ({legacy[c.id]})</Badge>}
                    {hasBalance && <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">رصيد إجمالي {fmt(c.opening_balance)}</Badge>}
                    {!hasLegacy && !hasBalance && <Badge variant="outline">مفيش ديون قديمة</Badge>}

                    {hasLegacy ? (
                      <span className="text-xs text-muted-foreground">
                        {c.name} له/عليه فواتير تاريخية مسجّلة بالفعل، مينفعش تضيفله رصيد افتتاحي كمان عشان الدين هيتحسب مرتين.
                      </span>
                    ) : (
                      <>
                        <Button size="sm" variant={openId === c.id ? "default" : "outline"}
                          onClick={() => { setOpenId(openId === c.id ? null : c.id); setDraft((d) => ({ ...d, [c.id]: String(c.opening_balance || "") })); }}>
                          رصيد إجمالي
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => {
                          if (hasBalance) {
                            toast.error(`${c.name} مسجّل له رصيد إجمالي`, { description: "امسح الرصيد الإجمالي الأول قبل ما ترفعله فواتير تاريخية." });
                            return;
                          }
                          onGoLegacy();
                        }}>
                          <FileSpreadsheet className="h-4 w-4 ml-1" /> فواتير تاريخية مفصّلة
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {openId === c.id && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                    <Input type="number" step="0.01" className="max-w-[180px]" placeholder="0.00"
                      value={draft[c.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))} />
                    <Button size="sm" disabled={busy} onClick={() => saveBalance(c, Number(draft[c.id]) || 0)}>
                      <Save className="h-4 w-4 ml-1" /> حفظ
                    </Button>
                    {hasBalance && (
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => saveBalance(c, 0)}>
                        <Trash2 className="h-4 w-4 ml-1" /> امسح الرصيد
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {!filtered.length && <p className="text-sm text-muted-foreground">مفيش عملاء أو موردين — ارفعهم الأول من الخطوة (1).</p>}
      </div>
    </div>
  );
}

/* ============ خطوة 3: القفل التلقائي ============ */
function LockStep() {
  const { tenantId } = useAuth() as any;
  const [rows, setRows] = useState<{ name: string; mode: string; detail: string }[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const [c, inv, sh, pr] = await Promise.all([
        supabase.from("contacts" as any).select("id,name,opening_balance").eq("tenant_id", tenantId).order("name"),
        supabase.from("invoices" as any).select("contact_id").eq("tenant_id", tenantId).not("migration_batch_id", "is", null),
        supabase.from("shipments" as any).select("contact_id").eq("tenant_id", tenantId).not("migration_batch_id", "is", null),
        supabase.from("purchase_returns" as any).select("contact_id").eq("tenant_id", tenantId).not("migration_batch_id", "is", null),
      ]);
      const map: Record<string, number> = {};
      [...((inv.data as any) ?? []), ...((sh.data as any) ?? []), ...((pr.data as any) ?? [])]
        .forEach((r: any) => { if (r.contact_id) map[r.contact_id] = (map[r.contact_id] ?? 0) + 1; });
      setRows((((c.data as any) ?? []) as any[])
        .map((x) => {
          const legacyCount = map[x.id] ?? 0;
          const bal = Number(x.opening_balance) || 0;
          if (legacyCount > 0) return { name: x.name, mode: "فواتير تاريخية", detail: `${legacyCount} مستند — مقفول عليه الرصيد الإجمالي` };
          if (bal !== 0) return { name: x.name, mode: "رصيد إجمالي", detail: `${fmt(bal)} — مقفولة عليه الفواتير التاريخية` };
          return { name: x.name, mode: "—", detail: "لسه مفتوح للطريقتين" };
        }));
    })();
  }, [tenantId]);

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" /> الحماية شغّالة على مستوى قاعدة البيانات</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• أي حساب له فواتير تاريخية مرحّلة → أي محاولة تسجّل له رصيد افتتاحي هتترفض فورًا برسالة واضحة.</p>
          <p>• أي حساب له رصيد افتتاحي → أي محاولة ترحّل له فواتير تاريخية هتترفض لحد ما تمسح الرصيد الأول.</p>
          <p>• الرفض بيتم من قاعدة البيانات نفسها، مش مجرد تحذير في الشاشة.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-right">الحساب</th>
                <th className="px-3 py-2 text-center">الطريقة المسجّلة</th>
                <th className="px-3 py-2 text-right">التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={r.mode === "—" ? "outline" : "secondary"}>{r.mode}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.detail}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">مفيش حسابات لسه</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DataSetupWizard() {
  const { isOwner, isAdmin } = useAuth() as any;
  const allowed = Boolean(isOwner || isAdmin);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showLegacy, setShowLegacy] = useState(false);

  if (!allowed) {
    return (
      <AdminLayout>
        <PageHeader title="تأسيس وترحيل البيانات" />
        <Card className="border-destructive/40">
          <CardContent className="p-8 text-center space-y-2">
            <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
            <p className="font-semibold">الشاشة دي للمالك أو المدير بس.</p>
          </CardContent>
        </Card>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <PageHeader
        title="تأسيس وترحيل البيانات"
        subtitle="3 خطوات: القوائم الأساسية → الأرصدة الافتتاحية → القفل التلقائي عشان الدين ميتحسبش مرتين."
      />

      <TabPurpose />

      <div className="flex items-center gap-2 mb-4 overflow-x-auto">

        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = step > s.n;
          const active = step === s.n;
          return (
            <div key={s.n} className="flex items-center gap-2 shrink-0">
              <button onClick={() => setStep(s.n as 1 | 2 | 3)} className="flex items-center gap-2">
                <span className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                  active ? "bg-primary text-primary-foreground shadow" : done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </span>
                <span className={`text-sm ${active ? "font-bold text-primary" : "text-muted-foreground"}`}>{s.n}) {s.title}</span>
              </button>
              {i < STEPS.length - 1 && <span className={`h-0.5 w-8 ${done ? "bg-emerald-500" : "bg-muted"}`} />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div key="s1" className="animate-fade-in">
          <StepIntro step={1} />
          <SheetGuideList sheets={CORE_SHEETS} />
          <CoreDataImport embedded />
        </div>
      )}

      {step === 2 && (
        <div key="s2" className="space-y-4 animate-fade-in">
          <StepIntro step={2} />
          <SheetGuideList sheets={[LEGACY_SHEET]} />
          <OpeningStep onGoLegacy={() => { setShowLegacy(true); setTimeout(() => document.getElementById("legacy-block")?.scrollIntoView({ behavior: "smooth" }), 100); }} />
          <div id="legacy-block">
            {showLegacy ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4" /> ترحيل الفواتير التاريخية المفصّلة
                  </CardTitle>
                </CardHeader>
                <CardContent><DataMigration embedded /></CardContent>
              </Card>
            ) : (
              <Button variant="outline" onClick={() => setShowLegacy(true)}>
                <FileSpreadsheet className="h-4 w-4 ml-1" /> افتح نموذج الفواتير التاريخية
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 3 && <div key="s3" className="animate-fade-in"><StepIntro step={3} /><LockStep /></div>}


      <div className="flex items-center justify-between mt-6 pt-4 border-t">
        <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => (s - 1) as any)}>
          <ChevronRight className="w-4 h-4 ml-1" /> السابق
        </Button>
        <Button disabled={step === 3} onClick={() => setStep((s) => (s + 1) as any)}>
          التالي <ChevronLeft className="w-4 h-4 mr-1" />
        </Button>
      </div>
    </AdminLayout>
  );
}
