import type { ReactNode, InputHTMLAttributes } from "react";
import { Search, RotateCcw, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDaysDay, cairoTodayDay, monthStartDay } from "@/lib/cairoDate";
import { cn } from "@/lib/utils";

export type DocumentFilters = {
  q: string; from: string; to: string; status: string; amountMin: string; amountMax: string; payment: string;
  categoryId: string; fromBranch: string; toBranch: string; partyId: string; recipient: string; notes: string;
};
export const EMPTY_DOCUMENT_FILTERS: DocumentFilters = { q: "", from: "", to: "", status: "", amountMin: "", amountMax: "", payment: "", categoryId: "", fromBranch: "", toBranch: "", partyId: "", recipient: "", notes: "" };

export interface Opt { value: string; label: string }

type QuickKey = "today" | "yesterday" | "7d" | "thisMonth" | "lastMonth";
const QUICK: { key: QuickKey; label: string }[] = [
  { key: "today", label: "النهاردة" }, { key: "yesterday", label: "امبارح" }, { key: "7d", label: "آخر 7 أيام" },
  { key: "thisMonth", label: "الشهر ده" }, { key: "lastMonth", label: "الشهر اللي فات" },
];
/** Cairo-day presets (never the device clock's timezone). */
function quickRange(k: QuickKey): { from: string; to: string } {
  const today = cairoTodayDay();
  switch (k) {
    case "today": return { from: today, to: today };
    case "yesterday": { const y = addDaysDay(today, -1); return { from: y, to: y }; }
    case "7d": return { from: addDaysDay(today, -6), to: today };
    case "thisMonth": return { from: monthStartDay(today), to: today };
    case "lastMonth": return { from: monthStartDay(today, -1), to: addDaysDay(monthStartDay(today), -1) };
  }
}

interface Props {
  title: string;
  shown: { from: number; to: number; total: number };
  value: DocumentFilters;
  onChange: (next: DocumentFilters) => void;
  onReset: () => void;
  hasAnyFilter: boolean;
  showSearch?: boolean;
  showDate?: boolean;
  showAmount?: boolean;
  searchPlaceholder?: string;
  searchInputProps?: Pick<InputHTMLAttributes<HTMLInputElement>, "onFocus" | "onBlur" | "onKeyDown">;
  onSearchTyped?: () => void;
  /** Rendered under the search box (e.g. autocomplete). */
  searchAddon?: ReactNode;
  statusOptions?: Opt[];
  paymentOptions?: Opt[];
  /** Screen-specific field in the 4th slot of the second row. */
  customField?: ReactNode;
  /** Any further screen-specific fields (party, notes, branches...). */
  extraFields?: ReactNode;
  footer?: ReactNode;
}

const Field = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <div className={cn("space-y-1.5 min-w-0", className)}>
    <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
    {children}
  </div>
);

function OptSelect({ value, options, onChange }: { value: string; options: Opt[]; onChange: (v: string) => void }) {
  return (
    <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="h-10 bg-background"><SelectValue placeholder="الكل" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">الكل</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Shared search + filter panel for every document screen. */
export function UnifiedDocumentFilters(p: Props) {
  const v = p.value;
  const set = (patch: Partial<DocumentFilters>) => p.onChange({ ...v, ...patch });
  const activeQuick = QUICK.find((q) => { const r = quickRange(q.key); return r.from === v.from && r.to === v.to; })?.key;
  return (
    <section className="card-elevated p-4 md:p-5 mb-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><Search className="w-4 h-4" /></span>
          <h3 className="font-extrabold text-foreground">فلاتر {p.title}</h3>
          <span className="rounded-full border border-border bg-surface-2 px-3 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums whitespace-nowrap">
            يعرض {p.shown.total ? `${p.shown.from.toLocaleString("en-US")}–${p.shown.to.toLocaleString("en-US")}` : 0} من أصل {p.shown.total.toLocaleString("en-US")} مستند
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {p.showDate !== false && (
            <>
              <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
              {QUICK.map((q) => (
                <button key={q.key} type="button" onClick={() => set(quickRange(q.key))}
                  className={cn("h-8 rounded-full border px-3 text-xs font-semibold transition-colors",
                    activeQuick === q.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-primary/5")}>
                  {q.label}
                </button>
              ))}
            </>
          )}
          <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={p.onReset} disabled={!p.hasAnyFilter}
            title="مسح وإعادة تعيين كل الفلاتر" aria-label="مسح وإعادة تعيين كل الفلاتر">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {p.showSearch !== false && (
          <Field label="بحث شامل (رقم المستند، الاسم، الهاتف، الملاحظات)" className="md:col-span-2 relative">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input value={v.q} onChange={(e) => { set({ q: e.target.value }); p.onSearchTyped?.(); }} {...p.searchInputProps}
                placeholder={p.searchPlaceholder ?? "رقم المستند، اسم العميل/المورد، تليفون..."} className="h-10 pr-9 bg-background" />
            </div>
            {p.searchAddon}
          </Field>
        )}
        {p.showDate !== false && (
          <>
            <Field label="من تاريخ (القاهرة)"><Input type="date" value={v.from} onChange={(e) => set({ from: e.target.value })} className="h-10 bg-background" /></Field>
            <Field label="إلى تاريخ (القاهرة)"><Input type="date" value={v.to} onChange={(e) => set({ to: e.target.value })} className="h-10 bg-background" /></Field>
          </>
        )}

        {p.statusOptions && p.statusOptions.length > 0 && (
          <Field label="الحالة"><OptSelect value={v.status} options={p.statusOptions} onChange={(s) => set({ status: s })} /></Field>
        )}
        {p.paymentOptions && p.paymentOptions.length > 0 && (
          <Field label="طريقة الدفع / الوعاء"><OptSelect value={v.payment} options={p.paymentOptions} onChange={(s) => set({ payment: s })} /></Field>
        )}
        {p.showAmount && (
          <Field label="نطاق المبلغ">
            <div className="flex h-10 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
              <Input type="number" min="0" value={v.amountMin} onChange={(e) => set({ amountMin: e.target.value })} placeholder="من" aria-label="المبلغ من"
                className="h-full border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-center" />
              <span className="px-1 text-xs text-muted-foreground">—</span>
              <Input type="number" min="0" value={v.amountMax} onChange={(e) => set({ amountMax: e.target.value })} placeholder="إلى" aria-label="المبلغ إلى"
                className="h-full border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-center" />
            </div>
          </Field>
        )}
        {p.customField}
        {p.extraFields}
      </div>
      {p.footer}
    </section>
  );
}

UnifiedDocumentFilters.Field = Field;
UnifiedDocumentFilters.Select = OptSelect;
