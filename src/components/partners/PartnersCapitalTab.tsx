import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, Archive, History, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PermTable } from "@/components/PermTable";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { cancelPartnerTransaction, fetchPartnerCards, isCapitalMove, moveLabel, pct, splitMoves, type PartnerCards, type PartnerMovement } from "@/lib/partners";
import { PartnerMoveActions, PartnerMoveStatus } from "./PartnerMoveActions";
import { OldMoneyDialog } from "./ExistingCapitalDialog";
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
  const [oldMoney, setOldMoney] = useState<{ kind: "in" | "out"; cards: PartnerCards } | null>(null);
  const [movesTab, setMovesTab] = useState<"live" | "cancelled">("live");
  const [money, setMoney] = useState<{ kind: "contribution" | "withdrawal"; cards: PartnerCards } | null>(null);
  const [moves, setMoves] = useState<CapMove[]>([]);
  const [cancelling, setCancelling] = useState<CapMove | null>(null);
  const totalCapital = active.reduce((s, r) => s + Math.max(Number(r.capital) || 0, 0), 0);

  const loadMoves = async () => {
    try {
      const all = await Promise.all(active.map((r) => fetchPartnerCards(r.partner.id)));
      setMoves(all.flatMap((c) => (c.movements ?? [])
        .filter(isCapitalMove)
        .map((m) => ({ ...m, partner: c.partner.name, cards: c })))
        .sort((a, b) => (a.date < b.date ? 1 : -1)));
    } catch (e: any) { toast.error(e.message); }
  };
  const ids = useMemo(() => active.map((r) => r.partner.id + r.capital).join(), [active]);
  useEffect(() => { loadMoves(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ids]);

  const refresh = () => { load(); loadMoves(); };
  const split = splitMoves(moves);
  const movesTable = (rows: CapMove[], cancelled: boolean) => rows.length === 0
    ? <div className="text-sm text-muted-foreground py-4">{cancelled ? "مفيش حركات ملغاة." : "مفيش حركات لسه."}</div>
    : (
      <div className="overflow-x-auto"><PermTable className="w-full text-sm" permTable={cancelled ? "capital_moves_cancelled" : "capital_moves"} data-testid={cancelled ? "cap-moves-cancelled" : "cap-moves-live"}>
        <thead className="bg-muted/40">
          <tr className="text-right"><th className="p-2">التاريخ / بيتحسب من</th><th className="p-2">اتدفعت / اتسحبت إمتى</th><th className="p-2">الشريك</th><th className="p-2">الحركة</th><th className="p-2">المبلغ</th><th className="p-2">{cancelled ? "اتلغت إزاي" : "الحالة"}</th><th className="p-2">إجراءات</th></tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} data-testid={`cap-move-${m.id}`} className={`border-t ${cancelled ? "text-muted-foreground" : ""}`}>
              <td className="p-2 tabular-nums">{m.date}</td>
              <td className="p-2 tabular-nums" title={m.deposited_on ? "اليوم اللي الفلوس اتحركت فيه فعلاً" : "مش متسجل — عدّل الحركة وحطه"}>{m.deposited_on ?? "—"}</td>
              <td className="p-2">{m.partner}</td>
              <td className="p-2">{moveLabel(m)}</td>
              <td className={`p-2 tabular-nums font-bold ${cancelled ? "line-through" : m.type === "contribution" || m.type === "capital_adjustment" ? "text-success" : "text-destructive"}`}>{formatEGP(m.amount)}</td>
              <td className="p-2"><PartnerMoveStatus m={m} /></td>
              <td className="p-2"><PartnerMoveActions m={m} cards={m.cards} active={active} canWrite={canWrite} onCancel={(x) => setCancelling(x as CapMove)} onChanged={refresh} /></td>
            </tr>
          ))}
        </tbody>
      </PermTable></div>
    );
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((r) => {
              const share = shares[r.partner.id]?.share ?? 0;
              return (
                <div key={r.partner.id} data-testid={`cap-card-${r.partner.id}`} className="rounded-2xl border bg-card p-4 shadow-sm flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold truncate" title={r.partner.name}>{r.partner.name}</div>
                      <div className="text-[11px] text-muted-foreground">رأس المال</div>
                    </div>
                    <div className="text-left">
                      <div className="text-lg font-extrabold text-primary tabular-nums">{pct(share)}</div>
                      <div className="text-[11px] text-muted-foreground">نصيبه من الربح</div>
                    </div>
                  </div>
                  <div className="text-2xl font-extrabold tabular-nums">{formatEGP(r.capital)}</div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(Math.max(share * 100, 0), 100)}%` }} />
                  </div>
                  <div className="grid grid-cols-5 gap-1 pt-2 border-t">
                    {canWrite && <>
                      <CapAction testId={`cap-act-existing-${r.partner.id}`} icon={<Archive className="w-5 h-5" />} label="موجود بالفعل" tone="success"
                        hint="فلوس دفعها قبل السيستم — بتزوّد رأس ماله ونسبته، من غير خزنة ولا قيد" onClick={() => setOldMoney({ kind: "in", cards: r })} />
                      <CapAction testId={`cap-act-presys-${r.partner.id}`} icon={<History className="w-5 h-5" />} label="سحب قبل السيستم" tone="warning"
                        hint="فلوس سحبها قبل السيستم — من رأس ماله ولا من الربح، من غير خزنة ولا قيد" onClick={() => setOldMoney({ kind: "out", cards: r })} />
                      <CapAction testId={`cap-act-in-${r.partner.id}`} icon={<ArrowUpCircle className="w-5 h-5" />} label="مساهمة" tone="primary"
                        hint="مساهمة دلوقتي — بتدخل خزنة فرع ووعاء تختارهم" onClick={() => setMoney({ kind: "contribution", cards: r })} />
                      <CapAction testId={`cap-act-out-${r.partner.id}`} icon={<ArrowDownCircle className="w-5 h-5" />} label="سحب" tone="destructive"
                        hint="سحب دلوقتي — بيطلع من خزنة فرع، من رأس المال أو الربح" onClick={() => setMoney({ kind: "withdrawal", cards: r })} />
                    </>}
                    <CapAction testId={`cap-act-page-${r.partner.id}`} icon={<UserRound className="w-5 h-5" />} label="صفحته" tone="muted"
                      hint="كروته وكل حركاته وكشف حسابه" to={`/admin/financial-position/partner/${r.partner.id}`} />
                  </div>
                </div>
              );
            })}
            <div className="rounded-2xl border border-dashed bg-muted/30 p-4 flex flex-col justify-center gap-1" data-testid="cap-total">
              <div className="text-sm text-muted-foreground">إجمالي رأس المال</div>
              <div className="text-2xl font-extrabold tabular-nums">{formatEGP(totalCapital)}</div>
              <div className="text-xs text-muted-foreground">{active.length} شريك — {totalCapital > 0 ? "100%" : "—"}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            «موجود بالفعل» و«سحب قبل السيستم» بيتحسبوا من أول الشهر اللي تختاره. المساهمة والسحب من الخزنة بيتحسبوا من أول الشهر اللي بعدهم.
          </p>
        </CardContent>
      </Card>

      <CapitalGapCard reloadKey={ids} onDone={refresh} />

      <Card>
        <CardHeader><CardTitle>حركات رأس المال</CardTitle></CardHeader>
        <CardContent>
          <Tabs value={movesTab} onValueChange={(v) => setMovesTab(v as "live" | "cancelled")}>
            <TabsList>
              <TabsTrigger value="live" data-testid="moves-tab-live">الشغالة ({split.live.length})</TabsTrigger>
              <TabsTrigger value="cancelled" data-testid="moves-tab-cancelled">الملغاة ({split.cancelled.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="live">{movesTable(split.live, false)}</TabsContent>
            <TabsContent value="cancelled">{movesTable(split.cancelled, true)}</TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {oldMoney && <OldMoneyDialog kind={oldMoney.kind} cards={oldMoney.cards} active={active} onClose={() => setOldMoney(null)} onDone={refresh} />}
      {money && <PartnerMoneyDialog kind={money.kind} cards={money.cards} active={active} onClose={() => setMoney(null)} onDone={refresh} />}
      {cancelling && <ReasonDialog title={`إلغاء ${moveLabel(cancelling)} — ${formatEGP(cancelling.amount)}`}
        description={cancelling.existing ? "الحركة بتتشال من حسابه — مفيش خزنة ولا قيد يتعكس. هتلاقيها في «الملغاة»." : "الفلوس هترجع / تطلع من نفس الخزنة في نفس اليوم. هتلاقيها في «الملغاة»."}
        onConfirm={cancel} onClose={() => setCancelling(null)} />}
    </div>
  );
}

/** one action of a partner's capital card: an icon with its name under it and a tooltip that says what it does */
function CapAction({ icon, label, hint, tone, onClick, to, testId }: {
  icon: React.ReactNode; label: string; hint: string; tone: "success" | "warning" | "primary" | "destructive" | "muted";
  onClick?: () => void; to?: string; testId: string;
}) {
  const color = { success: "text-success bg-success/10 group-hover:bg-success/20", warning: "text-warning bg-warning/10 group-hover:bg-warning/20",
    primary: "text-primary bg-primary/10 group-hover:bg-primary/20", destructive: "text-destructive bg-destructive/10 group-hover:bg-destructive/20",
    muted: "text-muted-foreground bg-muted group-hover:bg-muted/70" }[tone];
  const inner = (
    <>
      <span className={`rounded-full p-2 transition ${color}`}>{icon}</span>
      <span className="text-[10.5px] leading-[14px] text-center whitespace-normal break-words min-h-[28px]">{label}</span>
    </>
  );
  const cls = "group flex min-w-0 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {to ? <Link to={to} className={cls} data-testid={testId} aria-label={`${label}: ${hint}`}>{inner}</Link>
          : <button type="button" className={cls} data-testid={testId} aria-label={`${label}: ${hint}`} onClick={onClick}>{inner}</button>}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[220px] text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}
