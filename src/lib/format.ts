// كل الأرقام في النظام بتتكتب بالأرقام الإنجليزية (1,234.56) عشان تبقى واضحة ومقروءة
const AR = "ar-EG-u-nu-latn";

/** Removes only the legacy payment-plan UUID tag from displayed text; stored data is untouched. */
export const sanitizeOperationalDescription = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/دفعة خطة\s*#[0-9a-f]{8}(?:-[0-9a-f-]{27})?/gi, "دفعة خطة سداد")
    .replace(/\s+—\s+/g, " — ")
    .trim();

const OPERATION_REFERENCE_PATTERNS = [
  /\b(?:INV|IN|RET|TR|VOU|VCH|REC|PAY|PUR|SAL)[-_]?\d+[\w-]*\b/i,
  /(?:فاتورة|سند|مرتجع|تحويل|عملية)(?:\s+(?:رقم|شراء|بيع|قبض|صرف))?\s*[:#№-]?\s*([\p{L}\d][\p{L}\d/_-]*)/u,
] as const;

/** Resolves a readable operation number from structured data first, then legacy descriptions. */
export const extractOperationReference = (
  referenceNumber?: string | null,
  description?: string | null,
  installmentReference?: string | null,
): string => {
  const direct = String(referenceNumber ?? "").trim();
  if (direct) return direct;
  const text = String(description ?? "");
  for (const pattern of OPERATION_REFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return String(match[1] ?? match[0]).trim();
  }
  return String(installmentReference ?? "").trim() || "—";
};

/** Uses official document numbers before the movement's external reference. */
export const resolveTreasuryOperationNumber = (
  voucherNumber?: string | null,
  invoiceNumber?: string | null,
  referenceNumber?: string | null,
): string =>
  String(voucherNumber ?? "").trim()
  || String(invoiceNumber ?? "").trim()
  || String(referenceNumber ?? "").trim()
  || "—";

const TREASURY_CATEGORY_LABELS: Record<string, string> = {
  payment_out: "صرف دفعة",
  payment_in: "تحصيل دفعة",
  credit_deposit: "إيداع تحت الحساب",
  sales: "مبيعات نقدية",
  sale: "مبيعات نقدية",
  cash_sale: "مبيعات نقدية",
  supplier_payment: "سداد مورد",
  customer_payment: "تحصيل من عميل",
  installment: "تحصيل قسط",
  return: "مرتجع",
  customer_return: "رد قيمة مرتجع عميل",
  partner_contribution: "مساهمة رأس مال شريك",
  partner_capital: "مساهمة رأس مال شريك",
  partner_withdrawal: "مسحوبات شريك",
  branch_transfer_in: "تحويل وارد من فرع",
  branch_transfer_out: "تحويل صادر إلى فرع",
  capital_allocation_in: "تمويل وارد للفرع",
  capital_allocation_out: "تمويل صادر للفرع",
  transfer_fee: "عمولة تحويل",
  salary: "راتب",
  advance: "سلفة",
  advance_repayment: "سداد سلفة",
  rent: "إيجار",
  utilities: "مرافق",
  maintenance: "صيانة",
  shipping: "شحن",
  expense: "مصروف",
  other_receipt: "قبض آخر",
  other_payment: "صرف آخر",
};

/** Keeps existing Arabic descriptions and translates known stored category keys. */
export const treasuryCategoryLabel = (category?: string | null): string => {
  const value = String(category ?? "").trim();
  return TREASURY_CATEGORY_LABELS[value] ?? (value || "—");
};

export const formatEGP = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  const txt = new Intl.NumberFormat(AR, {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
  return `${txt} ج.م`;
};

export const formatNumber = (n: number | string | null | undefined) =>
  new Intl.NumberFormat(AR, { maximumFractionDigits: 2 }).format(Number(n ?? 0));

export const formatDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(AR, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
};

export const formatDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(AR, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};


export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Unified balance label.
 * Convention (matches `contacts.balance` usage across the app):
 *   balance > 0 → لينا رصيد عند الطرف الآخر (we are owed / credit in our favor)
 *   balance < 0 → علينا للطرف الآخر (we owe them)
 *   balance = 0 → لا توجد مديونية
 */
export const balanceLabel = (
  balance: number | null | undefined,
): { label: string; amount: number; tone: "good" | "bad" | "neutral" } => {
  const v = Number(balance ?? 0);
  if (v > 0) return { label: "ليك رصيد عنده", amount: Math.abs(v), tone: "good" };
  if (v < 0) return { label: "عليك له", amount: Math.abs(v), tone: "bad" };
  return { label: "لا توجد مديونية", amount: 0, tone: "neutral" };
};

