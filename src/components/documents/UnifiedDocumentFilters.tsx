import { useEffect, useMemo, useState, type ReactNode, type InputHTMLAttributes, type FormEvent } from "react";
import { Search, X, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERIOD_PRESETS, periodRange, presetOf, type PeriodKey } from "@/lib/periodPresets";
import { cn } from "@/lib/utils";

export type DocumentFilters = {
  q: string; from: string; to: string; status: string; amountMin: string; amountMax: string; payment: string;
  categoryId: string; fromBranch: string; toBranch: string; partyId: string; recipient: string; notes: string;
  /** sale / purchase: «التصنيف» نقدي (cash) / آجل (credit) and «حالة السداد» (paid / partial / unpaid) */
  settleClass: string; payState: string;
};
export const EMPTY_DOCUMENT_FILTERS: DocumentFilters = { q: "", from: "", to: "", status: "", amountMin: "", amountMax: "", payment: "", categoryId: "", fromBranch: "", toBranch: "", partyId: "", recipient: "", notes: "", settleClass: "", payState: "" };

export interface Opt { value: string; label: string }

export type DraftSlot = (draft: DocumentFilters, set: (patch: Partial<DocumentFilters>) => void) => ReactNode;
type SlotContent = ReactNode | DraftSlot;

interface Props {
  title: string;
  shown: { from: number; to: number; total: number };
  /** the APPLIED filters; typing changes a draft that reaches `onChange` only on 🔍 / Enter (owner 2026-11-18) */
  value: DocumentFilters;
  onChange: (next: DocumentFilters) => void;
  onReset: () => void;
  hasAnyFilter: boolean;
  /** what a row is called in the count line («مستند», «حركة») */
  noun?: string;
  showSearch?: boolean;
  showDate?: boolean;
  showAmount?: boolean;
  /** «بحث الملاحظات» */
  showNotes?: boolean;
  /** «المستلم / البائع»: the users who make documents (value = the name written on the document) */
  recipientOptions?: Opt[];
  recipientLabel?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  searchInputProps?: Pick<InputHTMLAttributes<HTMLInputElement>, "onFocus" | "onBlur">;
  onSearchTyped?: () => void;
  /** every draft change (e.g. autocomplete under the search box) */
  onDraftChange?: (draft: DocumentFilters) => void;
  /** Rendered under the search box (e.g. autocomplete). */
  searchAddon?: ReactNode;
  statusOptions?: Opt[];
  paymentOptions?: Opt[];
  classOptions?: Opt[];
  payStateOptions?: Opt[];
  /** Screen-specific field after «التصنيف» (e.g. «نوع السند»): a function gets the draft, so it waits for «بحث» too */
  customField?: SlotContent;
  /** Any further screen-specific fields (party, branches...), same rule */
  extraFields?: SlotContent;
  footer?: ReactNode;
}

const Field = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <div className={cn("space-y-1.5 min-w-0", className)}>
    <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
    {children}
  </div>
);

function OptSelect({ value, options, onChange, ariaLabel }: { value: string; options: Opt[]; onChange: (v: string) => void; ariaLabel?: string }) {
  return (
    <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="h-10 bg-background" aria-label={ariaLabel}><SelectValue placeholder="الكل" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">الكل</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const sameFilters = (a: DocumentFilters, b: DocumentFilters) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The ONE search + filter panel of every document / money screen (owner 2026-11-18 «الشكل موحد»): search, من / إلى with a
 * period list (week from Saturday), التصنيف, طريقة الدفع / الوعاء, المبلغ من / إلى, المستلم / البائع (users), بحث الملاحظات,
 * then the screen's own fields. Typed values are a draft until «بحث» or Enter; «مسح الفلتر» clears everything.
 */
export function UnifiedDocumentFilters(p: Props) {
  const [draft, setDraft] = useState<DocumentFilters>(p.value);
  // the applied filters changed from outside (column arrows, a card, «مسح»): the draft follows
  const valueKey = JSON.stringify(p.value);
  useEffect(() => { setDraft(p.value); }, [valueKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<DocumentFilters>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    p.onDraftChange?.(next);
  };
  const dirty = !sameFilters(draft, p.value);
  const apply = (e?: FormEvent) => { e?.preventDefault(); p.onChange(draft); };
  const preset = presetOf(draft.from, draft.to);
  const recipientOpts = useMemo(() => {
    const o = p.recipientOptions ?? [];
    // a value typed before (old free text) stays choosable
    return draft.recipient && !o.some((x) => x.value === draft.recipient) ? [{ value: draft.recipient, label: draft.recipient }, ...o] : o;
  }, [p.recipientOptions, draft.recipient]);
  const noun = p.noun ?? "مستند";

  return (
    <form className="card-elevated p-4 md:p-5 mb-4 space-y-4" onSubmit={apply} role="search" data-unified-filters>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><Search className="w-4 h-4" /></span>
          <h3 className="font-extrabold text-foreground">فلاتر {p.title}</h3>
          <span className="rounded-full border border-border bg-surface-2 px-3 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums whitespace-nowrap">
            يعرض {p.shown.total ? `${p.shown.from.toLocaleString("en-US")}–${p.shown.to.toLocaleString("en-US")}` : 0} من أصل {p.shown.total.toLocaleString("en-US")} {noun}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.showDate !== false && (
            <Select value={preset ?? "__custom__"} onValueChange={(k) => { if (k !== "__custom__") set(periodRange(k as PeriodKey)); }}>
              <SelectTrigger className="h-9 w-44 rounded-full bg-background" aria-label="الفترة">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                <SelectValue placeholder="اختار الفترة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom__" disabled>{draft.from || draft.to ? "فترة مخصوصة" : "اختار الفترة"}</SelectItem>
                {PERIOD_PRESETS.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button type="submit" size="sm" className={cn("h-9 gap-1.5 rounded-full px-4", dirty && "ring-2 ring-primary/40 animate-pulse")}
            title={dirty ? "فيه تغييرات لسه ما اتطبقتش — دوس بحث" : "بحث"}>
            <Search className="w-4 h-4" /> بحث
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-full px-4"
            onClick={() => { setDraft(EMPTY_DOCUMENT_FILTERS); p.onReset(); }}
            disabled={!p.hasAnyFilter && !dirty} title="مسح الفلتر" aria-label="مسح الفلتر">
            <X className="w-4 h-4" /> مسح الفلتر
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {p.showSearch !== false && (
          <Field label={p.searchLabel ?? "بحث شامل (رقم المستند، اسم العميل/المورد، التليفون)"} className="md:col-span-2 relative">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input value={draft.q} onChange={(e) => { set({ q: e.target.value }); p.onSearchTyped?.(); }} {...p.searchInputProps}
                placeholder={p.searchPlaceholder ?? "رقم المستند، اسم العميل/المورد، تليفون..."} className="h-10 pr-9 bg-background" />
            </div>
            {p.searchAddon}
          </Field>
        )}
        {p.showDate !== false && (
          <>
            <Field label="من تاريخ"><Input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} className="h-10 bg-background" /></Field>
            <Field label="إلى تاريخ"><Input type="date" value={draft.to} onChange={(e) => set({ to: e.target.value })} className="h-10 bg-background" /></Field>
          </>
        )}

        {p.statusOptions && p.statusOptions.length > 0 && (
          <Field label="الحالة"><OptSelect value={draft.status} options={p.statusOptions} onChange={(s) => set({ status: s })} /></Field>
        )}
        {p.classOptions && p.classOptions.length > 0 && (
          <Field label="التصنيف"><OptSelect value={draft.settleClass} options={p.classOptions} onChange={(s) => set({ settleClass: s })} /></Field>
        )}
        {p.payStateOptions && p.payStateOptions.length > 0 && (
          <Field label="حالة السداد"><OptSelect value={draft.payState} options={p.payStateOptions} onChange={(s) => set({ payState: s })} /></Field>
        )}
        {typeof p.customField === "function" ? p.customField(draft, set) : p.customField}
        {p.paymentOptions && p.paymentOptions.length > 0 && (
          <Field label="طريقة الدفع / الوعاء"><OptSelect value={draft.payment} options={p.paymentOptions} onChange={(s) => set({ payment: s })} ariaLabel="طريقة الدفع / الوعاء" /></Field>
        )}
        {p.showAmount && (
          <Field label="المبلغ من / إلى">
            <div className="flex h-10 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
              <Input type="number" min="0" value={draft.amountMin} onChange={(e) => set({ amountMin: e.target.value })} placeholder="من" aria-label="المبلغ من"
                className="h-full border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-center" />
              <span className="px-1 text-xs text-muted-foreground">—</span>
              <Input type="number" min="0" value={draft.amountMax} onChange={(e) => set({ amountMax: e.target.value })} placeholder="إلى" aria-label="المبلغ إلى"
                className="h-full border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-center" />
            </div>
          </Field>
        )}
        {p.recipientOptions && (
          <Field label={p.recipientLabel ?? "المستلم / البائع"}>
            <OptSelect value={draft.recipient} options={recipientOpts} onChange={(s) => set({ recipient: s })} ariaLabel={p.recipientLabel ?? "المستلم / البائع"} />
          </Field>
        )}
        {p.showNotes && (
          <Field label="بحث الملاحظات">
            <Input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} className="h-10 bg-background" placeholder="نص في الملاحظات" />
          </Field>
        )}
        {typeof p.extraFields === "function" ? p.extraFields(draft, set) : p.extraFields}
      </div>
      {p.footer}
    </form>
  );
}

UnifiedDocumentFilters.Field = Field;
UnifiedDocumentFilters.Select = OptSelect;
