import { useState } from "react";
import { toast } from "sonner";
import { PermTable } from "@/components/PermTable";
import { formatEGP } from "@/lib/format";
import { cancelPartnerTransaction, moveLabel, splitMoves, txSign, type PartnerCards, type PartnerMovement } from "@/lib/partners";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReasonDialog } from "./ReasonDialog";
import { PartnerMoveActions, PartnerMoveStatus } from "./PartnerMoveActions";

/**
 * A partner's movements, newest first. The owner / admin can edit a capital movement any day with a reason («تعديل»,
 * 0288: «موجود بالفعل» or a till contribution / capital withdrawal), attach its proof (📎), and cancel a movement that
 * went through the till («إلغاء» — on its own day; a withdrawal goes with every part of it and the advance it opened).
 */
export function PartnerMovementsTable({ rows, branchName, methodName, canWrite, cards, active, onChanged }: {
  rows: PartnerMovement[];
  branchName: (id: string | null) => string;
  methodName: (m: string | null) => string;
  canWrite: boolean;
  cards?: PartnerCards | null;
  active?: PartnerCards[];
  onChanged: () => void;
}) {
  const [cancelling, setCancelling] = useState<PartnerMovement | null>(null);
  const [tab, setTab] = useState<"live" | "cancelled">("live");
  const showDeposit = rows.some((m) => m.deposited_on);
  // 0290 (owner 2026-11-26): cancelled movements and the old side of an edit live in their own tab «الملغاة»
  const split = splitMoves(rows);
  const table = (list: PartnerMovement[], cancelled: boolean) => (
      <div className="overflow-x-auto">
        <PermTable className="w-full text-sm" permTable={cancelled ? "partner_moves_cancelled" : "partner_moves"}>
          <thead className="bg-muted/40">
            <tr className="text-right">
              <th className="p-2">التاريخ</th>{showDeposit && <th className="p-2">اتدفعت إمتى</th>}<th className="p-2">الحركة</th><th className="p-2">المبلغ</th>
              <th className="p-2">الفرع / الوعاء</th><th className="p-2">البيان</th><th className="p-2">الحالة</th>
              <th className="p-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={showDeposit ? 8 : 7} className="p-4 text-center text-muted-foreground">{cancelled ? "مفيش حركات ملغاة" : "مفيش حركات"}</td></tr>}
            {list.map((m) => (
              <tr key={m.id} className={`border-t ${cancelled ? "text-muted-foreground" : ""}`}>
                <td className="p-2 whitespace-nowrap">{m.date}</td>
                {showDeposit && <td className="p-2 whitespace-nowrap">{m.deposited_on ?? "—"}</td>}
                <td className="p-2">{moveLabel(m)}</td>
                <td className={`p-2 font-semibold whitespace-nowrap ${cancelled ? "line-through" : txSign(m.type) < 0 ? "text-destructive" : "text-success"}`}>
                  {txSign(m.type) < 0 ? "−" : "+"}{formatEGP(m.amount)}
                </td>
                <td className="p-2 text-xs">{m.branch_id ? `${branchName(m.branch_id)} • ${methodName(m.method)}` : "—"}</td>
                <td className="p-2 text-xs max-w-[280px]">{m.description}</td>
                    <td className="p-2"><PartnerMoveStatus m={m} /></td>
                <td className="p-2">
                  <PartnerMoveActions m={m} cards={cards} active={active ?? (cards ? [cards] : [])} canWrite={canWrite}
                    onCancel={setCancelling} onChanged={onChanged} />
                </td>
              </tr>
            ))}
          </tbody>
        </PermTable>
      </div>
  );

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "live" | "cancelled")}>
        <TabsList>
          <TabsTrigger value="live">الشغالة ({split.live.length})</TabsTrigger>
          <TabsTrigger value="cancelled">الملغاة ({split.cancelled.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="live">{table(split.live, false)}</TabsContent>
        <TabsContent value="cancelled">{table(split.cancelled, true)}</TabsContent>
      </Tabs>

      {cancelling && (
        <ReasonDialog
          title={`إلغاء ${moveLabel(cancelling)} ${formatEGP(cancelling.amount)}`}
          description={cancelling.existing ? "الحركة بتتشال من حسابه — مفيش خزنة ولا قيد يتعكس. هتلاقيها في «الملغاة»."
            : "الفلوس بترجع للخزنة في نفس يوم الحركة، والقيد بيتعكس. لو السحب عمل سلفة، السلفة بتتلغي معاه."}
          confirm="الغي الحركة"
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            try { await cancelPartnerTransaction(cancelling.id, reason); toast.success("اتلغت الحركة"); setCancelling(null); onChanged(); }
            catch (e: any) { toast.error(e.message); }
          }}
        />
      )}
    </>
  );
}
