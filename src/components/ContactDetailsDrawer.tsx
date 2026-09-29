import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ContactBranchAccordion } from "@/components/ContactBranchAccordion";
import { fetchContactLedger, filterLedgerByBranches, withRunningBalance, ledgerSum, type LedgerRow } from "@/lib/contactLedger";
import { formatDate, formatEGP } from "@/lib/format";
import { FileText, UserRound } from "lucide-react";
import { CreditDepositButton } from "@/components/CreditDepositDialog";

interface Props {
  contact: { id: string; name: string; type: string } | null;
  tenantId: string;
  branchId: string;
  canSettle: boolean;
  onClose: () => void;
  onSettled: () => void;
}

/** Side panel: «كل الفروع» summary tab + one running-balance statement tab per branch the contact dealt with. */
export function ContactDetailsDrawer({ contact, tenantId, branchId, canSettle, onClose, onSettled }: Props) {
  const nav = useNavigate();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [branchNames, setBranchNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("all");

  useEffect(() => {
    if (!contact) return;
    let cancelled = false;
    setTab("all"); setLoading(true);
    (async () => {
      const l = await fetchContactLedger(contact.id);
      const ids = Array.from(new Set(l.rows.map((r) => r.branch_id).filter(Boolean))) as string[];
      const { data } = ids.length ? await supabase.from("branches").select("id,name").in("id", ids) : { data: [] };
      if (cancelled) return;
      setRows(l.rows);
      setBranchNames(Object.fromEntries((data ?? []).map((b: any) => [b.id, b.name])));
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contact]);

  const branchIds = useMemo(() => {
    const ids = Object.keys(branchNames);
    // current branch first
    return ids.sort((a, b) => (a === branchId ? -1 : b === branchId ? 1 : (branchNames[a] ?? "").localeCompare(branchNames[b] ?? "", "ar")));
  }, [branchNames, branchId]);

  return (
    <Sheet open={!!contact} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="left" className="w-full sm:max-w-3xl overflow-y-auto" dir="rtl">
        {contact && (
          <>
            <SheetHeader>
              <SheetTitle className="text-right">{contact.name}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-wrap gap-2 my-3">
              <Button size="sm" variant="outline" onClick={() => nav(`/branch/${branchId}/contacts/${contact.id}`)}>
                <UserRound className="w-4 h-4 ml-1" /> الملف الكامل
              </Button>
              <CreditDepositButton size="sm" contact={contact} onDone={onSettled} />
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="all">كل الفروع</TabsTrigger>
                {branchIds.map((id) => <TabsTrigger key={id} value={id}>{branchNames[id]}</TabsTrigger>)}
              </TabsList>
              <TabsContent value="all">
                <ContactBranchAccordion
                  contactId={contact.id}
                  contactName={contact.name}
                  contactType={contact.type}
                  tenantId={tenantId}
                  receivingBranchId={branchId}
                  expanded
                  canSettle={canSettle}
                  onSettled={onSettled}
                />
              </TabsContent>
              {branchIds.map((id) => (
                <TabsContent key={id} value={id}>
                  <BranchStatement rows={rows} branchId={id} loading={loading}
                    onFull={() => nav(`/branch/${branchId}/contacts/${contact.id}/statement?branches=${id}`)}
                    onOpen={(link) => nav(link)} />
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function BranchStatement({ rows, branchId, loading, onFull, onOpen }: { rows: LedgerRow[]; branchId: string; loading: boolean; onFull: () => void; onOpen: (l: string) => void }) {
  const list = useMemo(() => {
    const scoped = filterLedgerByBranches(rows, [branchId]);
    return { bal: ledgerSum(scoped), rows: withRunningBalance(scoped).reverse() };
  }, [rows, branchId]);
  if (loading) return <div className="p-4 text-sm text-muted-foreground">جاري التحميل...</div>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between card-elevated p-3">
        <div>
          <div className="text-xs text-muted-foreground">رصيد هذا الفرع</div>
          <div className={`text-lg font-bold ${list.bal >= 0 ? "text-success" : "text-destructive"}`}>{formatEGP(list.bal)}</div>
        </div>
        <Button size="sm" variant="outline" onClick={onFull}><FileText className="w-4 h-4 ml-1" /> كشف تفصيلي بالفلاتر</Button>
      </div>
      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr><th className="p-2 text-right">التاريخ</th><th className="p-2 text-right">النوع</th><th className="p-2 text-right">المرجع</th><th className="p-2 text-right">مدين</th><th className="p-2 text-right">دائن</th><th className="p-2 text-right">الرصيد</th></tr>
          </thead>
          <tbody>
            {list.rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">لا توجد حركات</td></tr>}
            {list.rows.map((r, i) => (
              <tr key={i} className={`border-t ${r.link ? "cursor-pointer hover:bg-muted/40" : ""}`} onClick={() => r.link && onOpen(r.link)}>
                <td className="p-2 whitespace-nowrap">{formatDate(r.date)}</td>
                <td className="p-2">{r.type}</td>
                <td className="p-2 font-mono text-xs">{r.reference}</td>
                <td className="p-2 text-success">{r.debit ? formatEGP(r.debit) : "—"}</td>
                <td className="p-2 text-destructive">{r.credit ? formatEGP(r.credit) : "—"}</td>
                <td className={`p-2 font-bold ${(r.balance ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{formatEGP(r.balance ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
