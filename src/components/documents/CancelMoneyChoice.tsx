import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatEGP } from "@/lib/format";
import { AlertCircle, Ban, Banknote, Wallet } from "lucide-react";

/** Server preview of the money on a document before it is cancelled (`document_cancel_preview`, migration 0085). */
export interface CancelPreview {
  is_archive: boolean;
  has_contact: boolean;
  paid_money: number;
  direct: number;
  to_account: number;
  void_payments: { src: string; id: string; amount: number; day: string; method: string; voucher: string | null; block: string | null }[];
  void_total: number;
  can_void: boolean;
  void_block: string | null;
}

/** credit = stays on account, refund = given back today, void = the payments were never real. */
export type MoneyChoice = "credit" | "refund" | "void";

export const REFUND_METHODS = [
  { value: "cash", label: "كاش" },
  { value: "instapay", label: "إنستاباي" },
  { value: "vodafone", label: "فودافون كاش" },
  { value: "bank", label: "تحويل بنكي" },
];

const METHOD_LABEL: Record<string, string> = { cash: "كاش", instapay: "إنستاباي", vodafone: "فودافون كاش", wallet: "محفظة", bank: "بنك" };

interface Props {
  side: "customer" | "supplier";
  /** Money paid ON the document (the question is about it). */
  direct: number;
  /** Money that reached the document from the account (advance / return / general receipt): goes back by itself. */
  toAccount: number;
  preview: CancelPreview | null;
  canCredit: boolean;
  /** Archive purchase invoices: only «credit»; archive sales: refund in cash only. */
  onlyCredit?: boolean;
  cashOnly?: boolean;
  value: MoneyChoice | null;
  method: string;
  onChange: (v: MoneyChoice) => void;
  onMethod: (m: string) => void;
}

/** The one question asked when a sale / purchase invoice is cancelled: what happens to the money paid on it. */
export function CancelMoneyChoice({ side, direct, toAccount, preview, canCredit, onlyCredit, cashOnly, value, method, onChange, onMethod }: Props) {
  const who = side === "customer" ? "العميل" : "المورد";
  const voidList = preview?.void_payments ?? [];
  const voidDisabled = onlyCredit || !preview || !preview.can_void;
  const options: { key: MoneyChoice; icon: any; title: string; hint: string; disabled?: boolean; why?: string | null }[] = [
    {
      key: "credit", icon: Wallet,
      title: side === "customer" ? "تتحط تحت حسابه" : "تفضل تحت حساب المورد",
      hint: side === "customer" ? "الفلوس دخلت فعلاً وهتفضل رصيد له يشتري بيه بعدين" : "الفلوس اندفعت فعلاً وهتفضل رصيد لينا عنده",
      disabled: !canCredit, why: !canCredit ? "مفيش عميل مسجل على الفاتورة" : null,
    },
    {
      key: "refund", icon: Banknote,
      title: side === "customer" ? "يسترد فلوسه" : "المورد رجّع فلوسنا",
      hint: side === "customer" ? "سند صرف «رد» بتاريخ النهارده من الخزنة" : "سند قبض بتاريخ النهارده في الخزنة",
      disabled: onlyCredit || direct <= 0.005, why: onlyCredit ? "فاتورة قبل 2026" : direct <= 0.005 ? "مفيش فلوس مدفوعة على الفاتورة دي نفسها" : null,
    },
    {
      key: "void", icon: Ban,
      title: "الفاتورة غلط ومفيش فلوس اتدفعت",
      hint: "الدفعات تتلغي على يومها الأصلي وسنداتها تروح «الملغاة» — من غير سند جديد",
      disabled: voidDisabled, why: onlyCredit ? "فاتورة قبل 2026" : preview?.void_block ?? null,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-sm font-semibold">
        <AlertCircle className="h-4 w-4 text-warning" /> المدفوع على الفاتورة دي {formatEGP(direct)} — هيحصل فيه إيه؟
      </div>
      {toAccount > 0.005 && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
          {formatEGP(toAccount)} اتخصموا عليها من تحت حساب {who} (رصيد / مرتجع / سداد عام) — هيرجعوا تحت حسابه لوحدهم.
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.key}
              type="button"
              disabled={o.disabled}
              onClick={() => onChange(o.key)}
              className={`rounded-lg border p-3 text-right transition disabled:cursor-not-allowed disabled:opacity-50 ${value === o.key ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2"}`}
            >
              <Icon className="mb-1 h-5 w-5 text-primary" />
              <div className="font-bold">{o.title}</div>
              <div className="text-xs text-muted-foreground">{o.disabled && o.why ? o.why : o.hint}</div>
            </button>
          );
        })}
      </div>
      {value === "refund" && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">طريقة {side === "customer" ? "الرد" : "الاسترداد"}:</span>
          <Select value={method} onValueChange={onMethod}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REFUND_METHODS.filter((m) => !cashOnly || m.value === "cash").map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {value === "void" && voidList.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs space-y-1">
          <div className="font-semibold">الدفعات اللي هتتلغي على يومها:</div>
          {voidList.map((p) => (
            <div key={p.id} className="flex justify-between gap-2">
              <span>{p.voucher ?? "—"} · {p.day} · {METHOD_LABEL[p.method] ?? p.method}</span>
              <b className="tabular-nums">{formatEGP(p.amount)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
