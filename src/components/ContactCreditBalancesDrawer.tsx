import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { getCairoDayBounds } from "@/lib/cairoDate";
import { fetchContactLedger, type LedgerRow } from "@/lib/contactLedger";
import { formatEGP } from "@/lib/format";
import type { ContactCreditBalance } from "@/hooks/useContactCreditBalances";
import { Search, X } from "lucide-react";

type ContactWithLedger = ContactCreditBalance & { movements: LedgerRow[] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: ContactCreditBalance[];
  summaryLoading: boolean;
}

const includesText = (value: unknown, search: string) =>
  String(value ?? "").toLocaleLowerCase("ar-EG").includes(search.toLocaleLowerCase("ar-EG"));

const typeLabel = (type: string) => type === "customer" ? "عميل" : type === "supplier" ? "مورد" : "عميل ومورد";

export function ContactCreditBalancesDrawer({ open, onOpenChange, contacts, summaryLoading }: Props) {
  const nav = useNavigate();
  const [rows, setRows] = useState<ContactWithLedger[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const contactKey = useMemo(() => contacts.map((contact) => `${contact.contactId}:${contact.availableBalance}`).join("|"), [contacts]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const loaded: ContactWithLedger[] = [];
      for (let index = 0; index < contacts.length; index += 5) {
        const batch = contacts.slice(index, index + 5);
        const ledgers = await Promise.all(batch.map((contact) => fetchContactLedger(contact.contactId)));
        if (cancelled) return;
        loaded.push(...batch.map((contact, i) => ({ ...contact, movements: ledgers[i]?.rows ?? [] })));
      }
      if (!cancelled) setRows(loaded);
    })().catch(() => { if (!cancelled) setRows([]); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, contactKey]); // contacts are represented by the stable key above

  const filtered = useMemo(() => {
    const cleanSearch = search.trim();
    const cleanNotes = notes.trim();
    const { startIso, endIso } = getCairoDayBounds(fromDate, toDate);
    const start = startIso ? new Date(startIso).getTime() : undefined;
    const end = endIso ? new Date(endIso).getTime() : undefined;
    const min = minAmount === "" ? undefined : Number(minAmount);
    const max = maxAmount === "" ? undefined : Number(maxAmount);
    const hasMovementFilter = Boolean(cleanNotes || fromDate || toDate);

    return rows.filter((contact) => {
      if (min !== undefined && Number.isFinite(min) && contact.availableBalance < min) return false;
      if (max !== undefined && Number.isFinite(max) && contact.availableBalance > max) return false;
      const nameMatches = cleanSearch && includesText(contact.name, cleanSearch);
      const matchingMovements = contact.movements.filter((movement) => {
        const time = new Date(movement.date).getTime();
        if (start !== undefined && time < start) return false;
        if (end !== undefined && time > end) return false;
        if (cleanNotes && !includesText(movement.description, cleanNotes)) return false;
        if (cleanSearch && !nameMatches && ![movement.reference, movement.description, movement.type].some((value) => includesText(value, cleanSearch))) return false;
        return true;
      });
      if (cleanSearch && !nameMatches && matchingMovements.length === 0) return false;
      if (hasMovementFilter && matchingMovements.length === 0) return false;
      return true;
    });
  }, [rows, search, notes, fromDate, toDate, minAmount, maxAmount]);

  const clearFilters = () => {
    setSearch(""); setNotes(""); setFromDate(""); setToDate(""); setMinAmount(""); setMaxAmount("");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-5xl" dir="rtl">
        <SheetHeader className="text-right">
          <SheetTitle>أرصدة تحت الحساب (مقدمات العملاء والموردين)</SheetTitle>
          <SheetDescription>هذه الأرصدة تخص حسابات الجهات ولا تدخل ضمن إجماليات الخزائن المعروضة.</SheetDescription>
        </SheetHeader>

        <div className="my-5 space-y-4">
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 md:grid-cols-3">
            <div>
              <Label className="text-xs">اسم الجهة أو رقم السند / الفاتورة</Label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="عميل، مورد، سند أو فاتورة…" />
              </div>
            </div>
            <div><Label className="text-xs">الملاحظات / البيان</Label><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="جزء من البيان…" /></div>
            <div className="flex items-end"><Button type="button" variant="ghost" onClick={clearFilters}><X className="ml-1 h-4 w-4" />مسح الفلاتر</Button></div>
            <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
            <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">الرصيد من</Label><Input type="number" min="0" step="0.01" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} /></div>
              <div><Label className="text-xs">الرصيد إلى</Label><Input type="number" min="0" step="0.01" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} /></div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">يعرض {filtered.length} من أصل {contacts.length} جهة</span>
            <strong>إجمالي النتائج: {formatEGP(filtered.reduce((sum, contact) => sum + contact.availableBalance, 0))}</strong>
          </div>

          <DataTable
            rows={filtered}
            loading={loading || summaryLoading}
            indexColumn
            pageSize={20}
            empty="لا توجد أرصدة مطابقة للفلاتر"
            getRowKey={(contact) => contact.contactId}
            columns={[
              { key: "name", header: "الجهة", render: (contact: ContactWithLedger) => (
                <Button variant="link" className="h-auto p-0 font-bold" onClick={() => nav(`/admin/contacts/${contact.contactId}/statement`)}>{contact.name}</Button>
              ) },
              { key: "type", header: "النوع", render: (contact: ContactWithLedger) => typeLabel(contact.type) },
              { key: "availableBalance", header: "المبلغ المتاح", numeric: true, render: (contact: ContactWithLedger) => <strong className="text-warning">{formatEGP(contact.availableBalance)}</strong> },
            ]}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}