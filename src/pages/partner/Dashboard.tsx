import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, FileText } from "lucide-react";
import { PartnerLayout } from "@/components/layout/PartnerLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { downloadPartnerStatementPdf } from "@/lib/partnerStatement";
import { loadAllPaymentMethods } from "@/lib/paymentMethods";
import { fetchMoneyBranches, fetchPartnerCards, movementsOfCard, pct, salaryText, type CardKey, type PartnerCards } from "@/lib/partners";
import { PartnerCardsRow } from "@/components/partners/PartnerCardsRow";
import { PartnerMovementsTable } from "@/components/partners/PartnerMovementsTable";

/**
 * The partner's own page (0137) — read only. A «شريك» sees his five cards and movements; a «موظف وشريك» also sees how he
 * is paid. Example: المساهمات 1,000,000 · من رأس المال 200,000 · رأس المال 800,000 · صافي الربح 150,000 · السلف 0.
 */
export default function PartnerDashboard() {
  const { user, profile } = useAuth();
  const [partnerId, setPartnerId] = useState<string | null | undefined>(undefined);
  const [cards, setCards] = useState<PartnerCards | null>(null);
  const [card, setCard] = useState<CardKey | null>(null);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    supabase.from("partner_users" as any).select("partner_id").eq("user_id", user.id).eq("is_active", true).limit(1).maybeSingle()
      .then(({ data }) => setPartnerId((data as any)?.partner_id ?? null));
    fetchMoneyBranches().then((b) => setBranches(Object.fromEntries(b.map((x) => [x.id, x.name])))).catch(() => {});
    loadAllPaymentMethods().then((m) => setMethods(Object.fromEntries(m.map((x) => [x.value, x.label])))).catch(() => {});
  }, [user?.id]);

  const load = async () => { if (partnerId) setCards(await fetchPartnerCards(partnerId).catch(() => null)); };
  useEffect(() => { load(); }, [partnerId]);
  useEffect(() => {
    if (!partnerId) return;
    const ch = supabase.channel(`partner-dash-${partnerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_transactions", filter: `partner_id=eq.${partnerId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [partnerId]);

  const rows = useMemo(() => movementsOfCard(card, cards?.movements ?? []).filter((m) => !m.void), [card, cards]);
  const p = cards?.partner;

  return (
    <PartnerLayout>
      <div dir="rtl" className="text-right space-y-4">
        <PageHeader title={`أهلاً ${profile?.name ?? ""}`} subtitle="حسابك كشريك — رأس مالك وربحك وسلفك" />

        {partnerId === null ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">حسابك لسه مش مربوط بشريك — كلم الإدارة.</CardContent></Card>
        ) : !cards || !p ? (
          <div className="text-sm text-muted-foreground">جاري التحميل…</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{p.role_kind === "employee_partner" ? "موظف وشريك" : "شريك"}</Badge>
              {Number(p.operating_share) > 0 && <Badge variant="outline">حصة تشغيل {pct(p.operating_share)}</Badge>}
              {p.role_kind === "employee_partner" && <Badge variant="outline">{salaryText(p, p.salary_branch_id ? branches[p.salary_branch_id] : undefined)}</Badge>}
            </div>

            <PartnerCardsRow cards={cards} selected={card} onSelect={setCard} />

            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <CardTitle>{card ? "الحركات اللي تحت الكارت ده" : "حركاتك"}</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => downloadPartnerStatementPdf({ partnerId: p.id, branchName: "الشركة", userName: profile?.name ?? p.name })}>
                    <FileText className="w-4 h-4 ml-2" />كشف حساب PDF
                  </Button>
                  <Button asChild size="sm" variant="outline"><Link to="/partner/ledger"><BookOpen className="w-4 h-4 ml-2" />الكشف الكامل</Link></Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <PartnerMovementsTable rows={rows} canWrite={false} onChanged={load}
                  branchName={(b) => (b ? branches[b] ?? "—" : "—")} methodName={(m) => (m ? methods[m] ?? m : "—")} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PartnerLayout>
  );
}
