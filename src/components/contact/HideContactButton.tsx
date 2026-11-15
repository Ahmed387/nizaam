// «إخفاء الحساب» (migration 0226, owner 2026-11-15): the owner hides a customer / supplier with all his documents from everybody
// else (employees, managers, partners). The totals keep him. Shown to the company owner only — the server refuses anybody else.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";

export function HideContactButton({ contactId, contactName, internalBranch, onChanged }: {
  contactId: string; contactName: string; internalBranch?: boolean; onChanged?: () => void;
}) {
  const { isOwner } = useAuth();
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    supabase.rpc("contact_is_hidden" as any, { p_contact: contactId }).then(({ data, error }) => setHidden(error ? null : !!data));
  }, [isOwner, contactId]);

  if (!isOwner || hidden === null || internalBranch) return null;

  const save = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("set_contact_hidden" as any, { p_contact: contactId, p_hidden: !hidden, p_reason: reason || null });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    setHidden(!hidden);
    setOpen(false);
    setReason("");
    toast.success(!hidden ? `«${contactName}» اتخفى — مش هيظهر لحد غيرك` : `«${contactName}» رجع يظهر للكل`);
    onChanged?.();
    void data;
  };

  return (
    <>
      {hidden && <Badge variant="secondary" className="self-center gap-1"><EyeOff className="w-3 h-3" />مخفي عن الكل غيرك</Badge>}
      <Button variant="outline" onClick={() => setOpen(true)}>
        {hidden ? <><Eye className="w-4 h-4 ml-1" />إظهار</> : <><EyeOff className="w-4 h-4 ml-1" />إخفاء</>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>{hidden ? `إظهار «${contactName}»` : `إخفاء «${contactName}»`}</DialogTitle></DialogHeader>
          {hidden ? (
            <div className="text-sm leading-7">
              الحساب وكل فواتيره وسنداته هيرجعوا يظهروا لكل اللي ليه صلاحية زي الأول.
            </div>
          ) : (
            <div className="text-sm leading-7 space-y-2">
              <p>الحساب ده وكل فواتيره ومرتجعاته وسنداته وحركاته في الخزنة <b>هيختفوا عن أي حد غيرك</b> — الموظفين والمديرين والشركاء — من القوايم والبحث والتقارير والملفات.</p>
              <p className="text-muted-foreground">فلوسه هتفضل محسوبة في رصيد الخزنة والأرباح والمخزن وإجمالي الأرصدة زي ما هي، فممكن حد يلاحظ إن الإجمالي أكبر من الحركات اللي قدامه.</p>
              <p className="text-muted-foreground">إنت بس اللي تقدر تعمل له فاتورة أو سند بعد كده. وتقدر ترجّعه في أي وقت من «الحسابات المخفية».</p>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="السبب (اختياري — بيظهر ليك بس)" />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" asChild><Link to="/admin/hidden-contacts">الحسابات المخفية</Link></Button>
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}{hidden ? "إظهار" : "إخفاء"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
