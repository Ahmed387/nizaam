import { useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { archiveProblem, canDeletePartner, deletePartner, setPartnerArchived, type PartnerCards } from "@/lib/partners";

type Act = "delete" | "archive" | "restore";

/**
 * «حذف» / «أرشفة» / «استرجاع» a partner (0295, owner 2026-11-27): delete only a partner with nothing at all (the server checks
 * movements, advances, distributions, logins too); archive only when his capital, profit and advances are zero — he stays
 * with his history under «المؤرشفين». Owner / admin only (the server refuses anybody else).
 */
export function PartnerArchiveActions({ cards, onDone, onDeleted }: { cards: PartnerCards; onDone: () => void; onDeleted?: () => void }) {
  const [act, setAct] = useState<Act | null>(null);
  const archived = !!cards.partner.archived_at;
  const canDelete = canDeletePartner(cards);
  const why = archiveProblem(cards);
  return (
    <>
      {archived ? (
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setAct("restore")} data-testid="partner-restore"><ArchiveRestore className="w-4 h-4" /> استرجاع</Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" variant="outline" className="gap-1" disabled={!!why} onClick={() => setAct("archive")} data-testid="partner-archive"><Archive className="w-4 h-4" /> أرشفة</Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{why ?? "يتشال من القايمة ويفضل بحركاته تحت «المؤرشفين»"}</TooltipContent>
        </Tooltip>
      )}
      {canDelete && (
        <Button size="sm" variant="ghost" className="gap-1 text-destructive hover:text-destructive" onClick={() => setAct("delete")} data-testid="partner-delete"><Trash2 className="w-4 h-4" /> حذف</Button>
      )}
      {act && <ArchiveDialog act={act} cards={cards} onClose={() => setAct(null)} onDone={() => { setAct(null); if (act === "delete") onDeleted?.(); onDone(); }} />}
    </>
  );
}

const TEXT: Record<Act, { title: string; body: string; btn: string }> = {
  delete: { title: "حذف الشريك", body: "هيتمسح نهائي — مفيش له أي حركة ولا رأس مال ولا ربح ولا سلف. مينفعش يرجع.", btn: "احذف" },
  archive: { title: "أرشفة الشريك", body: "هيتشال من الشركاء الشغالين ومن توزيع الأرباح، وحركاته القديمة تفضل زي ما هي. ينفع ترجّعه بعدين.", btn: "أرشف" },
  restore: { title: "استرجاع الشريك", body: "هيرجع شريك شغال بنفس بياناته وحركاته.", btn: "رجّعه" },
};

function ArchiveDialog({ act, cards, onClose, onDone }: { act: Act; cards: PartnerCards; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const t = TEXT[act];
  const needReason = act !== "restore";
  const go = async () => {
    if (needReason && !reason.trim()) return toast.error("اكتب السبب");
    setBusy(true);
    try {
      if (act === "delete") await deletePartner(cards.partner.id, reason.trim());
      else await setPartnerArchived(cards.partner.id, act === "archive", reason.trim() || undefined);
      toast.success(act === "delete" ? `اتحذف ${cards.partner.name}` : act === "archive" ? `اتأرشف ${cards.partner.name}` : `رجع ${cards.partner.name}`);
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-md" data-testid="partner-archive-dialog">
        <DialogHeader>
          <DialogTitle>{t.title} — {cards.partner.name}</DialogTitle>
          <DialogDescription className="text-right leading-6">{t.body}</DialogDescription>
        </DialogHeader>
        {needReason && (
          <div>
            <Label htmlFor="pa-reason">السبب <span className="text-destructive">*</span></Label>
            <Input id="pa-reason" className="mt-1.5" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
              placeholder={act === "delete" ? "مثلاً: اتسجل للتجربة" : "مثلاً: خرج من الشراكة"} />
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button variant={act === "delete" ? "destructive" : "default"} onClick={go} disabled={busy || (needReason && !reason.trim())} data-testid="pa-confirm">{busy ? "لحظة…" : t.btn}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
