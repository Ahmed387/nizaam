import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ContactBalanceHeader } from "@/components/contact/ContactBalanceHeader";
import { ContactMovements } from "@/components/contact/ContactMovements";
import { fetchContactOverview, type ContactOverview } from "@/lib/ledger";
import { UserRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  contact: { id: string; name: string; type: string } | null;
  tenantId: string;
  branchId: string;
  canSettle: boolean;
  onClose: () => void;
  onSettled: () => void;
}

/**
 * Side panel of an account — «حساب جاري» (owner 2026-11-12): ONE balance (دائن + / مدين −) and its movements, this branch
 * or all branches. No customer / supplier side cards and no open-invoice lists; receipt and payment are on the list row.
 */
export function ContactDetailsDrawer({ contact, branchId, onClose }: Props) {
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [scope, setScope] = useState<"branch" | "all">("branch");
  const [ov, setOv] = useState<ContactOverview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setScope("branch"); }, [contact?.id]);
  useEffect(() => {
    if (!contact) return;
    let cancelled = false;
    setLoading(true);
    fetchContactOverview(contact.id, scope === "branch" ? branchId : null)
      .then((o) => { if (!cancelled) setOv(o); })
      .catch(() => { if (!cancelled) setOv(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contact, scope, branchId]);

  // all-branches movements are for company admins; branch staff see the total and their branch's movements
  const movesBranch = scope === "branch" || !isAdmin ? branchId : null;

  return (
    <Sheet open={!!contact} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="left" className="w-full sm:max-w-4xl overflow-y-auto" dir="rtl">
        {contact && (
          <>
            <SheetHeader><SheetTitle className="text-right">{contact.name}</SheetTitle></SheetHeader>
            <div className="flex flex-wrap items-center gap-2 my-3">
              <Button size="sm" variant="outline" onClick={() => nav(`/branch/${branchId}/contacts/${contact.id}`)}>
                <UserRound className="w-4 h-4 ml-1" /> ملف الحساب
              </Button>
              <Tabs value={scope} onValueChange={(v) => setScope(v as any)}>
                <TabsList>
                  <TabsTrigger value="branch">الفرع ده</TabsTrigger>
                  <TabsTrigger value="all">كل الفروع</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {loading && <div className="p-4 text-sm text-muted-foreground">جاري التحميل...</div>}
            {!loading && !ov && <div className="p-4 text-sm text-destructive">تعذر تحميل الحساب — جرّب تاني.</div>}
            {!loading && ov && (
              <ContactBalanceHeader customer={ov.customer} supplier={ov.supplier} scopeLabel={scope === "branch" ? "الفرع ده" : "كل الفروع"} />
            )}
            <ContactMovements contactId={contact.id} contactName={contact.name} branchId={movesBranch}
              scopeName={movesBranch ? "الفرع ده" : "كل الفروع"} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
