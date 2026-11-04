import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDownCircle, ArrowRight, ArrowUpCircle, FileText, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PermTable } from "@/components/PermTable";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { loadAllPaymentMethods } from "@/lib/paymentMethods";
import { downloadPartnerStatementPdf } from "@/lib/partnerStatement";
import {
  fetchMoneyBranches, fetchPartnerCards, formFromPartner, movementsOfCard, pct, salaryText,
  type CardKey, type PartnerCards,
} from "@/lib/partners";
import { PartnerCardsRow } from "@/components/partners/PartnerCardsRow";
import { PartnerMoneyDialog } from "@/components/partners/PartnerMoneyDialog";
import { PartnerFormDialog } from "@/components/partners/PartnerFormDialog";
import { PartnerMovementsTable } from "@/components/partners/PartnerMovementsTable";

const CARD_TITLE: Record<CardKey, string> = {
  contributions: "حركات المساهمات",
  capital_withdrawals: "المسحوب من رأس المال",
  capital: "حركات رأس المال",
  profit: "حركات الربح",
  advances: "السلف وسدادها",
};

const ADV_STATUS: Record<string, string> = { active: "مفتوحة", partially_paid: "اتسدد جزء", fully_paid: "اتسددت", cancelled: "ملغية" };

/** One partner (0137): the five cards (click one → its movements), money in / out, his answers, the advances. */
export default function PartnerProfile() {
  const { id } = useParams();
  const { isOwner, isAdmin, profile } = useAuth();
  const canWrite = isOwner || isAdmin;
  const [cards, setCards] = useState<PartnerCards | null>(null);
  const [card, setCard] = useState<CardKey | null>(null);
  const [money, setMoney] = useState<"contribution" | "withdrawal" | null>(null);
  const [editing, setEditing] = useState(false);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<Record<string, string>>({});

  const load = async () => {
    if (!id) return;
    try { setCards(await fetchPartnerCards(id)); } catch (e: any) { toast.error(e.message); }
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    fetchMoneyBranches().then((b) => setBranches(Object.fromEntries(b.map((x) => [x.id, x.name])))).catch(() => {});
    loadAllPaymentMethods().then((m) => setMethods(Object.fromEntries(m.map((x) => [x.value, x.label])))).catch(() => {});
  }, []);
  useEffect(() => {
    if (!id) return;
    const ch = supabase.channel(`partner-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_transactions", filter: `partner_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  // «السلف» shows the «سداد سلفة» lines here and every advance in its own table below
  const rows = useMemo(() => movementsOfCard(card, cards?.movements ?? []), [card, cards]);

  if (!cards) {
    return <AdminLayout><div dir="rtl" className="p-6 text-muted-foreground">جاري التحميل…</div></AdminLayout>;
  }
  const p = cards.partner;

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-5">
        <Link to="/admin/financial-position?tab=partners" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="w-4 h-4" /> الشركاء
        </Link>
        <PageHeader
          title={p.name}
          subtitle={[p.role_kind === "employee_partner" ? "موظف وشريك" : "شريك", p.start_date ? `من ${p.start_date}` : null].filter(Boolean).join(" • ")}
          actions={canWrite && p.is_active ? (
            <>
              <Button className="gap-1" onClick={() => setMoney("contribution")}><ArrowUpCircle className="w-4 h-4" /> مساهمة</Button>
              <Button variant="outline" className="gap-1" onClick={() => setMoney("withdrawal")}><ArrowDownCircle className="w-4 h-4" /> سحب</Button>
              <Button variant="outline" className="gap-1" onClick={() => setEditing(true)}><Pencil className="w-4 h-4" /> بياناته</Button>
              <Button variant="ghost" className="gap-1" onClick={() => downloadPartnerStatementPdf({ partnerId: p.id, branchName: "الشركة", userName: profile?.name ?? "" })}>
                <FileText className="w-4 h-4" /> كشف حساب PDF
              </Button>
            </>
          ) : undefined}
        />

        <div className="flex flex-wrap gap-2">
          {Number(p.operating_share) > 0 && <Badge variant="outline">حصة تشغيل {pct(p.operating_share)} — بتتاخد الأول وتتسجل مرتبات</Badge>}
          {p.role_kind === "employee_partner" && <Badge variant="outline">{salaryText(p, p.salary_branch_id ? branches[p.salary_branch_id] : undefined)}</Badge>}
          {!p.is_active && <Badge variant="destructive">موقوف</Badge>}
        </div>

        <PartnerCardsRow cards={cards} selected={card} onSelect={setCard} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle>{card ? CARD_TITLE[card] : "كل الحركات"}</CardTitle>
            {card && <Button size="sm" variant="ghost" onClick={() => setCard(null)}>اعرض الكل</Button>}
          </CardHeader>
          <CardContent className="p-0">
            <PartnerMovementsTable
              rows={rows}
              branchName={(b) => (b ? branches[b] ?? "—" : "—")}
              methodName={(m) => (m ? methods[m] ?? m : "—")}
              canWrite={canWrite}
              onChanged={load}
            />
          </CardContent>
        </Card>

        {(card === null || card === "advances") && (cards.advances_list?.length ?? 0) > 0 && (
          <Card>
            <CardHeader><CardTitle>السلف</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <PermTable className="w-full text-sm" permTable="partner_advances">
                <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">السلفة</th><th className="p-2">اتسدد</th><th className="p-2">الباقي</th><th className="p-2">الحالة</th><th className="p-2">السبب</th></tr></thead>
                <tbody>
                  {cards.advances_list!.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="p-2">{a.date}</td>
                      <td className="p-2">{formatEGP(a.amount)}</td>
                      <td className="p-2 text-success">{formatEGP(a.paid_back)}</td>
                      <td className="p-2 font-semibold text-warning">{formatEGP(a.remaining)}</td>
                      <td className="p-2"><Badge variant={a.status === "cancelled" ? "destructive" : "secondary"}>{ADV_STATUS[a.status] ?? a.status}</Badge></td>
                      <td className="p-2 text-xs">{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </PermTable>
            </CardContent>
          </Card>
        )}
      </div>

      {money && <PartnerMoneyDialog kind={money} cards={cards} onClose={() => setMoney(null)} onDone={load} />}
      {editing && <PartnerFormDialog initial={formFromPartner(p)} onClose={() => setEditing(false)} onDone={load} />}
    </AdminLayout>
  );
}
