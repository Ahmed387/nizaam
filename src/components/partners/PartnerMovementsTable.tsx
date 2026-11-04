import { useState } from "react";
import { toast } from "sonner";
import { Ban, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermTable } from "@/components/PermTable";
import { formatEGP } from "@/lib/format";
import { cancelPartnerTransaction, editPartnerContribution, TX_LABEL, txSign, type PartnerMovement } from "@/lib/partners";
import { ReasonDialog } from "./ReasonDialog";

/**
 * A partner's movements, newest first. The owner / admin can correct a contribution on its own day («تعديل»), and cancel a
 * movement that went through the till («إلغاء» — on its own day; a withdrawal goes with every part of it and the advance it opened).
 */
export function PartnerMovementsTable({ rows, branchName, methodName, canWrite, onChanged }: {
  rows: PartnerMovement[];
  branchName: (id: string | null) => string;
  methodName: (m: string | null) => string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [cancelling, setCancelling] = useState<PartnerMovement | null>(null);
  const [editing, setEditing] = useState<PartnerMovement | null>(null);
  const [newAmount, setNewAmount] = useState("");

  return (
    <>
      <div className="overflow-x-auto">
        <PermTable className="w-full text-sm" permTable="partner_moves">
          <thead className="bg-muted/40">
            <tr className="text-right">
              <th className="p-2">التاريخ</th><th className="p-2">الحركة</th><th className="p-2">المبلغ</th>
              <th className="p-2">الفرع / الوعاء</th><th className="p-2">البيان</th><th className="p-2">الحالة</th>
              {canWrite && <th className="p-2">إجراءات</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={canWrite ? 7 : 6} className="p-4 text-center text-muted-foreground">مفيش حركات</td></tr>}
            {rows.map((m) => (
              <tr key={m.id} className={`border-t ${m.void ? "opacity-60" : ""}`}>
                <td className="p-2 whitespace-nowrap">{m.date}</td>
                <td className="p-2">{TX_LABEL[m.type] ?? m.type}</td>
                <td className={`p-2 font-semibold whitespace-nowrap ${txSign(m.type) < 0 ? "text-destructive" : "text-success"}`}>
                  {txSign(m.type) < 0 ? "−" : "+"}{formatEGP(m.amount)}
                </td>
                <td className="p-2 text-xs">{m.branch_id ? `${branchName(m.branch_id)} • ${methodName(m.method)}` : "—"}</td>
                <td className="p-2 text-xs max-w-[280px]">{m.description}</td>
                <td className="p-2">
                  {m.void ? <Badge variant="destructive" title={m.cancel_reason ?? ""}>ملغي</Badge> : <Badge variant="secondary">شغال</Badge>}
                </td>
                {canWrite && (
                  <td className="p-2 whitespace-nowrap">
                    {m.editable && (
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(m); setNewAmount(String(m.amount)); }}>
                        <Pencil className="w-4 h-4 ml-1" /> تعديل
                      </Button>
                    )}
                    {m.cancellable && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelling(m)}>
                        <Ban className="w-4 h-4 ml-1" /> إلغاء
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </PermTable>
      </div>

      {cancelling && (
        <ReasonDialog
          title={`إلغاء ${TX_LABEL[cancelling.type] ?? ""} ${formatEGP(cancelling.amount)}`}
          description="الفلوس بترجع للخزنة في نفس يوم الحركة، والقيد بيتعكس. لو السحب عمل سلفة، السلفة بتتلغي معاه."
          confirm="الغي الحركة"
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            try { await cancelPartnerTransaction(cancelling.id, reason); toast.success("اتلغت الحركة"); setCancelling(null); onChanged(); }
            catch (e: any) { toast.error(e.message); }
          }}
        />
      )}

      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent dir="rtl" className="max-w-sm">
            <DialogHeader>
              <DialogTitle>تعديل المساهمة</DialogTitle>
              <DialogDescription>التعديل في نفس اليوم بس. بعد كده: الغيها واعمل واحدة جديدة.</DialogDescription>
            </DialogHeader>
            <div><Label>المبلغ الصح</Label><Input type="number" min={0} value={newAmount} onChange={(e) => setNewAmount(e.target.value)} autoFocus /></div>
            <DialogFooter className="gap-2 sm:justify-start">
              <Button onClick={async () => {
                try {
                  await editPartnerContribution(editing.id, Number(newAmount));
                  toast.success(`اتعدلت المساهمة: ${formatEGP(editing.amount)} ← ${formatEGP(Number(newAmount))}`);
                  setEditing(null); onChanged();
                } catch (e: any) { toast.error(e.message); }
              }}>احفظ</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>رجوع</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
