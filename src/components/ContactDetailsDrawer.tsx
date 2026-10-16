import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SideSummary } from "@/components/contact/SideSummary";
import { ContactBalanceHeader } from "@/components/contact/ContactBalanceHeader";
import { ContactSettleDialog, type ContactOpenInvoice } from "@/components/ContactSettleDialog";
import { CreditDepositButton } from "@/components/CreditDepositDialog";
import { fetchContactDocuments, fetchContactOverview, type ContactOverview } from "@/lib/ledger";
import { formatDate, formatEGP } from "@/lib/format";
import { FileText, UserRound, HandCoins } from "lucide-react";
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
 * Side panel of a contact from the unified ledger: this branch or all branches, customer and supplier
 * accounts shown separately (no netting), open documents, and the collection shortcut.
 */
export function ContactDetailsDrawer({ contact, branchId, canSettle, onClose, onSettled }: Props) {
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [scope, setScope] = useState<"branch" | "all">("branch");
  const [ov, setOv] = useState<ContactOverview | null>(null);
  const [openInv, setOpenInv] = useState<ContactOpenInvoice[]>([]);
  const [openShip, setOpenShip] = useState<ContactOpenInvoice[]>([]);
  const [openInvAll, setOpenInvAll] = useState<ContactOpenInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => { setScope("branch"); }, [contact?.id]);

  useEffect(() => {
    if (!contact) return;
    let cancelled = false;
    setLoading(true);
    const scopeBranch = scope === "branch" ? branchId : null;
    (async () => {
      const o = await fetchContactOverview(contact.id, scopeBranch);
      const toOpen = (docs: Awaited<ReturnType<typeof fetchContactDocuments>>) => docs
        .filter((d) => d.state === "open" && d.doc_type !== "movement")
        .map((d) => ({ id: d.doc_id, invoice_number: d.doc_number ?? "—", invoice_date: d.doc_date, branch_id: d.branch_id,
                       branch_name: d.branch_name ?? "—", total: d.total, paid: (d.paid_money ?? 0) + (d.paid_by_returns ?? 0), remaining: d.remaining ?? 0 }))
        .sort((a, b) => (a.invoice_date < b.invoice_date ? -1 : 1));
      // documents of other branches are listed for company admins only (branch staff see totals)
      const listBranch = scopeBranch ?? (isAdmin ? null : branchId);
      const [ci, si, ca] = await Promise.all([
        o.customer ? fetchContactDocuments(contact.id, "customer", listBranch).then(toOpen) : Promise.resolve([]),
        o.supplier ? fetchContactDocuments(contact.id, "supplier", listBranch).then(toOpen) : Promise.resolve([]),
        // the collection dialog lists every branch's open invoices for admins (oldest first)
        o.customer && listBranch && isAdmin ? fetchContactDocuments(contact.id, "customer", null).then(toOpen) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setOv(o); setOpenInv(ci); setOpenShip(si); setOpenInvAll(ca ?? ci);
    })().catch(() => { if (!cancelled) { setOv(null); setOpenInv([]); setOpenShip([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contact, scope, branchId, reload, isAdmin]);

  const showC = !!ov?.customer && (contact?.type === "customer" || contact?.type === "both" || Math.abs(ov.customer.balance) > 0.005);
  const showS = !!ov?.supplier && (contact?.type === "supplier" || contact?.type === "both" || Math.abs(ov.supplier.balance) > 0.005);

  const OpenList = ({ title, rows, doc }: { title: string; rows: ContactOpenInvoice[]; doc: "sales" | "shipments" }) => (
    <div className="rounded-lg border">
      <div className="px-3 py-2 border-b bg-muted/40 text-sm font-bold flex justify-between">
        <span>{title}</span>
        <span className="tabular-nums">{formatEGP(rows.reduce((s, r) => s + r.remaining, 0))}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-3 text-sm text-muted-foreground text-center">مفيش مستندات مفتوحة</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/20"><tr><th className="p-2 text-right">رقم</th><th className="p-2 text-right">التاريخ</th><th className="p-2 text-right">الفرع</th><th className="p-2 text-right">الإجمالي</th><th className="p-2 text-right">المتبقي</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => nav(`/branch/${r.branch_id}/${doc}/${r.id}`)}>
                <td className="p-2 font-mono text-xs">{r.invoice_number}</td>
                <td className="p-2 whitespace-nowrap">{formatDate(r.invoice_date)}</td>
                <td className="p-2">{r.branch_name}</td>
                <td className="p-2 tabular-nums">{formatEGP(r.total)}</td>
                <td className="p-2 tabular-nums font-bold">{formatEGP(r.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

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
                <UserRound className="w-4 h-4 ml-1" /> الملف الكامل (360°)
              </Button>
              <Button size="sm" variant="outline" onClick={() => nav(`/branch/${branchId}/contacts/${contact.id}/statement`)}>
                <FileText className="w-4 h-4 ml-1" /> كشف حساب
              </Button>
              {canSettle && showC && (
                <Button size="sm" className="btn-gradient" onClick={() => setSettleOpen(true)}>
                  <HandCoins className="w-4 h-4 ml-1" /> تحصيل وإقفال فواتير
                </Button>
              )}
              <CreditDepositButton size="sm" contact={contact} onDone={() => { setReload((x) => x + 1); onSettled(); }} />
            </div>
            <Tabs value={scope} onValueChange={(v) => setScope(v as any)}>
              <TabsList>
                <TabsTrigger value="branch">الفرع ده</TabsTrigger>
                <TabsTrigger value="all">كل الفروع</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground mt-2">
              {scope === "branch"
                ? "فواتير وفلوس الفرع ده بس؛ الفلوس اللي اتدفعت في فرع تاني على فاتورة هنا بتظهر كسداد من فرع آخر."
                : isAdmin ? "مجموع كل الفروع (الرصيد الإجمالي للجهة)." : "الرصيد الإجمالي للجهة في كل الفروع؛ القوائم تحت لفواتير الفرع ده بس."}
              {" "}حساب العميل وحساب المورد منفصلين.
            </p>
            {loading && <div className="p-4 text-sm text-muted-foreground">جاري التحميل...</div>}
            {!loading && !ov && <div className="p-4 text-sm text-destructive">تعذر تحميل حساب الجهة — جرّب تاني.</div>}
            {!loading && ov && (
              <div className="space-y-4 mt-3">
                <ContactBalanceHeader customer={showC ? ov.customer : null} supplier={showS ? ov.supplier : null}
                  scopeLabel={scope === "branch" ? "الفرع ده" : "كل الفروع"} />
                {showC && (
                  <section className="space-y-2">
                    <h4 className="font-bold text-sm">حساب العميل</h4>
                    <SideSummary side="customer" data={ov.customer!} compact />
                    <OpenList title={ov.customer?.totals_only ? "فواتير بيع مفتوحة — الفرع ده" : "فواتير بيع مفتوحة"} rows={openInv} doc="sales" />
                  </section>
                )}
                {showS && (
                  <section className="space-y-2">
                    <h4 className="font-bold text-sm">حساب المورد</h4>
                    <SideSummary side="supplier" data={ov.supplier!} compact />
                    <OpenList title={ov.supplier?.totals_only ? "فواتير شراء مفتوحة — الفرع ده" : "فواتير شراء مفتوحة"} rows={openShip} doc="shipments" />
                  </section>
                )}
              </div>
            )}
            {showC && (
              <ContactSettleDialog
                open={settleOpen}
                onOpenChange={setSettleOpen}
                contactId={contact.id}
                contactName={contact.name}
                receivingBranchId={branchId}
                openInvoices={openInvAll}
                onDone={() => { setReload((x) => x + 1); onSettled(); }}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
