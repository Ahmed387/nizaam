import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PermTable } from "@/components/PermTable";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { cancelPartnerTransaction, fetchPartnerCards, pct, TX_LABEL, type PartnerCards, type PartnerMovement } from "@/lib/partners";
import { PartnerMoveActions, PartnerMoveStatus } from "./PartnerMoveActions";
import { ExistingCapitalDialog } from "./ExistingCapitalDialog";
import { PartnerMoneyDialog } from "./PartnerMoneyDialog";
import { ReasonDialog } from "./ReasonDialog";
import { CapitalGapCard } from "./CapitalGapCard";
import type { usePartnersData } from "./usePartnersData";

type Data = ReturnType<typeof usePartnersData>;
type CapMove = PartnerMovement & { partner: string; existing?: boolean; cards: PartnerCards };

/**
 * «رأس المال» tab (owner 2026-11-25): each partner's capital and % of the profit, and the three ways it moves —
 * «موجود بالفعل» (old money: no till, no entry), «مساهمة في خزنة» (into a branch / vessel / day) and «سحب».
 * Every capital movement is listed under it; «موجود بالفعل» and till movements are cancelled from here (with a reason).
 */
export function PartnersCapitalTab({ data }: { data: Data }) {
  const { isOwner, isAdmin } = useAuth();
  const canWrite = isOwner || isAdmin;
  const { active, shares, load } = data;
  const [existing, setExisting] = useState<PartnerCards | null>(null);
  const [money, setMoney] = useState<{ kind: "contribution" | "withdrawal"; cards: PartnerCards } | null>(null);
  const [moves, setMoves] = useState<CapMove[]>([]);
  const [cancelling, setCancelling] = useState<CapMove | null>(null);
  const totalCapital = active.reduce((s, r) => s + Math.max(Number(r.capital) || 0, 0), 0);

  const loadMoves = async () => {
    try {
      const all = await Promise.all(active.map((r) => fetchPartnerCards(r.partner.id)));
      setMoves(all.flatMap((c) => (c.movements ?? [])
        .filter((m) => ["contribution", "capital_withdrawal", "capital_adjustment"].includes(m.type))
        .map((m) => ({ ...m, partner: c.partner.name, cards: c })))
        .sort((a, b) => (a.date < b.date ? 1 : -1)));
    } catch (e: any) { toast.error(e.message); }
  };
  const ids = useMemo(() => active.map((r) => r.partner.id + r.capital).join(), [active]);
  useEffect(() => { loadMoves(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ids]);

  const refresh = () => { load(); loadMoves(); };
  const cancel = async (reason: string) => {
    if (!cancelling) return;
    try {
      await cancelPartnerTransaction(cancelling.id, reason);
      toast.success("اتلغت الحركة"); setCancelling(null); refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5">
      {totalCapital <= 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
          لسه مفيش رأس مال متسجل لأي شريك — التوزيع بيتقسم على رأس المال، فمحدش هياخد حاجة لحد ما تسجّل رأس مال كل شريك.
          لو الفلوس اتدفعت قبل كده دوس «موجود بالفعل».
        </div>
      )}
      <Card>
        <CardHeader><CardTitle>رأس مال كل شريك</CardTitle></CardHeader>
        <CardContent>
          <PermTable className="w-full text-sm" permTable="capital" noFilter>
            <thead className="bg-muted/40">
              <tr className="text-right">
                <th className="p-2">الشريك</th><th className="p-2">رأس المال</th><th className="p-2">نصيبه من الربح</th>
                {canWrite && <th className="p-2">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {active.map((r) => (
                <tr key={r.partner.id} className="border-t">
                  <td className="p-2 font-semibold">{r.partner.name}</td>
                  <td className="p-2 tabular-nums font-bold">{formatEGP(r.capital)}</td>
                  <td className="p-2 tabular-nums font-extrabold text-primary">{pct(shares[r.partner.id]?.share ?? 0)}</td>
                  {canWrite && (
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => setExisting(r)}><Archive className="w-4 h-4" /> موجود بالفعل</Button>
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => setMoney({ kind: "contribution", cards: r })}><ArrowUpCircle className="w-4 h-4" /> مساهمة في خزنة</Button>
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => setMoney({ kind: "withdrawal", cards: r })}><ArrowDownCircle className="w-4 h-4" /> سحب</Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-t bg-muted/30 font-extrabold">
                <td className="p-2">الإجمالي</td><td className="p-2 tabular-nums">{formatEGP(totalCapital)}</td>
                <td className="p-2">{totalCapital > 0 ? "100%" : "—"}</td>{canWrite && <td />}
              </tr>
            </tbody>
          </PermTable>
          <p className="text-xs text-muted-foreground mt-2">
            «موجود بالفعل» بيتحسب من أول الشهر اللي تختاره. المساهمة في خزنة بتتحسب من أول الشهر اللي بعدها.
          </p>
        </CardContent>
      </Card>

      <CapitalGapCard reloadKey={ids} onDone={refresh} />

      <Card>
        <CardHeader><CardTitle>حركات رأس المال</CardTitle></CardHeader>
        <CardContent>
          {moves.length === 0 ? <div className="text-sm text-muted-foreground">مفيش حركات لسه.</div> : (
            <div className="overflow-x-auto"><PermTable className="w-full text-sm" permTable="capital_moves">
              <thead className="bg-muted/40">
                <tr className="text-right"><th className="p-2">التاريخ / بيتحسب من</th><th className="p-2">اتدفعت إمتى</th><th className="p-2">الشريك</th><th className="p-2">الحركة</th><th className="p-2">المبلغ</th><th className="p-2">الحالة</th><th className="p-2">إجراءات</th></tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id} data-testid={`cap-move-${m.id}`} className={`border-t ${m.void ? "opacity-50" : ""}`}>
                    <td className="p-2 tabular-nums">{m.date}</td>
                    <td className="p-2 tabular-nums" title={m.deposited_on ? "اليوم اللي الشريك حط فيه الفلوس فعلاً" : "مش متسجل — عدّل الحركة وحطه"}>{m.deposited_on ?? "—"}</td>
                    <td className="p-2">{m.partner}</td>
                    <td className="p-2">{m.existing ? "رأس مال موجود بالفعل" : TX_LABEL[m.type]}</td>
                    <td className={`p-2 tabular-nums font-bold ${m.type === "capital_withdrawal" ? "text-destructive" : "text-success"}`}>{formatEGP(m.amount)}</td>
                    <td className="p-2"><PartnerMoveStatus m={m} /></td>
                    <td className="p-2"><PartnerMoveActions m={m} cards={m.cards} active={active} canWrite={canWrite} onCancel={(x) => setCancelling(x as CapMove)} onChanged={refresh} /></td>
                  </tr>
                ))}
              </tbody>
            </PermTable></div>
          )}
        </CardContent>
      </Card>

      {existing && <ExistingCapitalDialog cards={existing} active={active} onClose={() => setExisting(null)} onDone={refresh} />}
      {money && <PartnerMoneyDialog kind={money.kind} cards={money.cards} onClose={() => setMoney(null)} onDone={refresh} />}
      {cancelling && <ReasonDialog title={`إلغاء ${cancelling.existing ? "رأس مال موجود بالفعل" : TX_LABEL[cancelling.type]} — ${formatEGP(cancelling.amount)}`}
        description={cancelling.existing ? "هيتشال من رأس ماله ونسبته — مفيش خزنة ولا قيد يتعكس." : "الفلوس هترجع / تطلع من نفس الخزنة في نفس اليوم."}
        onConfirm={cancel} onClose={() => setCancelling(null)} />}
    </div>
  );
}
