import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownCircle, ArrowUpCircle, Calculator, Gift, PlusCircle, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/StatCard";
import { PermCard } from "@/contexts/PermCustomize";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { fetchPartnersOverview, pct, salaryText, type PartnerCards } from "@/lib/partners";
import { PartnerFormDialog } from "@/components/partners/PartnerFormDialog";
import { PartnerMoneyDialog } from "@/components/partners/PartnerMoneyDialog";
import { PeriodSharesDialog } from "@/components/partners/PeriodSharesDialog";

/**
 * «الشركاء» (0137, owner «غيرها كلها من الاول»): every partner with his five numbers, and the three things the owner does
 * here — add / promote a partner, put money in / take it out (branch, vessel, day), and book the operating shares /
 * % salaries of a period before distributing it.
 */
export default function PartnersList(_props: { embedded?: boolean } = {}) {
  const { isOwner, isAdmin } = useAuth();
  const canWrite = isOwner || isAdmin;
  const [rows, setRows] = useState<PartnerCards[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [shares, setShares] = useState(false);
  const [money, setMoney] = useState<{ kind: "contribution" | "withdrawal"; cards: PartnerCards } | null>(null);
  const [showOld, setShowOld] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setRows(await fetchPartnersOverview()); } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const active = rows.filter((r) => r.partner.is_active);
  const shown = showOld ? rows : active;
  const totals = useMemo(() => active.reduce((s, r) => ({
    capital: s.capital + Number(r.capital), profit: s.profit + Number(r.profit), advances: s.advances + Number(r.advances),
  }), { capital: 0, profit: 0, advances: 0 }), [active]);

  return (
    <div dir="rtl" className="text-right space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-extrabold">الشركاء</h2>
          <p className="text-sm text-muted-foreground">رأس مال كل شريك وربحه وسلفه — دوس على أي شريك تشوف حركاته.</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAdding(true)} className="gap-2"><PlusCircle className="w-4 h-4" /> شريك جديد</Button>
            <Button variant="outline" onClick={() => setShares(true)} className="gap-2"><Calculator className="w-4 h-4" /> حصص التشغيل والمرتبات</Button>
            <Button variant="outline" asChild className="gap-2"><Link to="/admin/accounting/flexible-distribution"><Gift className="w-4 h-4" /> توزيع الأرباح</Link></Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد الشركاء" value={String(active.length)} icon={<UserCircle className="w-5 h-5" />} accent="secondary"
          metricHint={{ meaning: "الشركاء الشغالين دلوقتي", source: "الشركاء (partners_overview)", formula: "عدد الشركاء غير الموقوفين" }} />
        <StatCard label="رأس المال لحد النهارده" value={formatEGP(totals.capital)} icon={<ArrowUpCircle className="w-5 h-5" />} accent="primary"
          metricHint={{ meaning: "رأس مال كل الشركاء الشغالين", source: "حركات الشركاء (partners_overview)", formula: "Σ (المساهمات − المسحوبات من رأس المال)" }} />
        <StatCard label="صافي ربح الشركاء" value={formatEGP(totals.profit)} hint="اتحسبلهم ولسه ماسحبوهوش" icon={<Gift className="w-5 h-5" />} accent="success"
          metricHint={{ meaning: "الربح اللي اتحسب للشركاء ولسه في الشركة", source: "حركات الشركاء (partners_overview)", formula: "Σ (نصيب + حصة تشغيل + مرتب من الربح − سحب من الربح − سداد سلف)" }} />
        <StatCard label="السلف" value={formatEGP(totals.advances)} hint="بتتخصم من التوزيع الجاي" icon={<ArrowDownCircle className="w-5 h-5" />} accent={totals.advances > 0 ? "warning" : "secondary"}
          metricHint={{ meaning: "اللي الشركاء سحبوه أكتر من ربحهم", source: "سلف الشركاء المفتوحة", formula: "Σ الباقي من كل سلفة مفتوحة" }} />
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">جاري التحميل…</div>
      ) : shown.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">مفيش شركاء لسه — دوس «شريك جديد».</CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((r) => (
            <PermCard key={r.partner.id} label="كارت الشريك">
              <Card className={`overflow-hidden ${r.partner.is_active ? "" : "opacity-60"}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link to={`/admin/financial-position/partner/${r.partner.id}`} className="text-lg font-bold hover:underline">{r.partner.name}</Link>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Badge variant="secondary">{r.partner.role_kind === "employee_partner" ? "موظف وشريك" : "شريك"}</Badge>
                        {Number(r.partner.operating_share) > 0 && <Badge variant="outline">حصة تشغيل {pct(r.partner.operating_share)}</Badge>}
                        {r.partner.role_kind === "employee_partner" && <Badge variant="outline">{salaryText(r.partner)}</Badge>}
                        {!r.partner.is_active && <Badge variant="destructive">موقوف</Badge>}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" asChild><Link to={`/admin/financial-position/partner/${r.partner.id}`}>افتح صفحته</Link></Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                    <Num label="المساهمات" v={r.contributions} />
                    <Num label="مسحوب من رأس المال" v={r.capital_withdrawals} tone="destructive" />
                    <Num label="رأس المال" v={r.capital} tone="primary" strong />
                    <Num label="صافي الربح" v={r.profit} tone={r.profit < 0 ? "destructive" : "success"} strong />
                    <Num label="السلف" v={r.advances} tone={r.advances > 0 ? "warning" : undefined} />
                  </div>
                  {canWrite && r.partner.is_active && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => setMoney({ kind: "contribution", cards: r })}><ArrowUpCircle className="w-4 h-4" /> مساهمة</Button>
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => setMoney({ kind: "withdrawal", cards: r })}><ArrowDownCircle className="w-4 h-4" /> سحب</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </PermCard>
          ))}
        </div>
      )}
      {rows.length > active.length && (
        <Button variant="link" className="px-0" onClick={() => setShowOld((v) => !v)}>{showOld ? "اخفي الموقوفين" : `اعرض الموقوفين (${rows.length - active.length})`}</Button>
      )}

      {adding && <PartnerFormDialog onClose={() => setAdding(false)} onDone={load} />}
      {shares && <PeriodSharesDialog onClose={() => setShares(false)} onDone={load} />}
      {money && <PartnerMoneyDialog kind={money.kind} cards={money.cards} onClose={() => setMoney(null)} onDone={load} />}
    </div>
  );
}

const TONE = { primary: "text-primary", success: "text-success", destructive: "text-destructive", warning: "text-warning" } as const;

function Num({ label, v, tone, strong }: { label: string; v: number; tone?: "primary" | "success" | "destructive" | "warning"; strong?: boolean }) {
  const c = tone ? TONE[tone] : "";
  return (
    <div className="rounded-lg bg-muted/40 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={`mt-1 ${strong ? "font-extrabold text-sm" : "font-semibold"} ${c}`}>{formatEGP(v)}</div>
    </div>
  );
}
