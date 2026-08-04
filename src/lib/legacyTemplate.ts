import * as XLSX from "xlsx";
import type { LegacyKind } from "@/lib/legacySheetParser";
import { LEGACY_KIND_LABEL } from "@/lib/legacySheetParser";

/**
 * قالب Nizam الموحّد لترحيل الفواتير القديمة.
 * كل الأعمدة اللي النظام محتاجها عشان الفاتورة تتسجل مظبوطة وتشبك على المخزن
 * والخزنة وحساب العميل/المورد من غير أي نقص.
 */

/** أعمدة الهيدر (سطر الفاتورة) */
export const DOC_COLUMNS = [
  "التاريخ",
  "الوقت",
  "رقم الفاتورة",
  "الفاتورة المرتجعة",
  "المخزن",
  "الحساب",
  "طريقة السداد",
  "كاش",
  "انستاباي",
  "فودافون كاش",
  "PayMob",
  "الآجل",
  "خصم الفاتورة",
  "الضريبة",
  "النهائى",
  "البائع",
  "ملاحظات",
] as const;

/** أعمدة الأصناف (سطر الصنف) */
export const ITEM_COLUMNS = [
  "رقم الصنف",
  "الباركود",
  "اسم الصنف",
  "الماركة",
  "الموديل",
  "التصنيف",
  "وحدة",
  "كمية",
  "السعر",
  "التكلفة",
  "سعر السوق",
  "خصم %",
  "الخصم",
  "النهائى",
] as const;

export type ColumnKey =
  | "date" | "number" | "original" | "warehouse" | "account"
  | "payments" | "credit" | "headerDiscount" | "cost" | "marketPrice"
  | "productInfo" | "lineDiscount";

type Kind = "sale" | "purchase" | "sale_return" | "purchase_return" | "";

export interface ColumnInfo {
  key: ColumnKey;
  col: string;
  what: string;
  need: string;
  /** الأنواع اللي العمود ده مطلوب فيها فعليًا (فاضي = كل الأنواع) */
  requiredFor?: Exclude<Kind, "">[];
  /** الأنواع اللي العمود ده ملوش لازمة فيها خالص */
  skipFor?: Exclude<Kind, "">[];
  /** القيمة اللي النظام بيحطها لو العمود مش موجود */
  fallback: string;
}

export const COLUMN_HELP: ColumnInfo[] = [
  { key: "date", col: "التاريخ + الوقت", what: "تاريخ ووقت الفاتورة", need: "بيتسجل زي ما هو في النظام", fallback: "تاريخ النهاردة — لازم تظبطه بإيدك" },
  { key: "number", col: "رقم الفاتورة", what: "الرقم القديم", need: "بيمنع تكرار الترحيل", fallback: "رقم تلقائي حسب ترتيب المستند في الملف" },
  { key: "original", col: "الفاتورة المرتجعة", what: "رقم الفاتورة الأصلية", need: "للمرتجعات بس — بتربط المرتجع بأصله", requiredFor: ["sale_return", "purchase_return"], skipFor: ["sale", "purchase"], fallback: "فاضي → المرتجع بيتسجل حر من غير ربط بأصله" },
  { key: "warehouse", col: "المخزن", what: "الفرع اللي اتعمل فيه المستند", need: "بيربط الحركة بالفرع الصح", fallback: "فاضي → بياخد الفرع الافتراضي اللي هتختاره" },
  { key: "account", col: "الحساب", what: "اسم العميل أو المورد", need: "بيربط الرصيد بالحساب", fallback: "فاضي → بياخد الحساب الافتراضي اللي هتختاره" },
  { key: "payments", col: "كاش / انستاباي / فودافون كاش / PayMob", what: "المدفوع بكل وسيلة", need: "بيحدد الخزنة اللي هتدخل فيها الفلوس", fallback: "المدفوع كله بيتحسب كاش" },
  { key: "credit", col: "الآجل", what: "المتبقي على الحساب", need: "بيتحوّل لرصيد آجل على العميل/المورد", fallback: "٠ — يعني الفاتورة مدفوعة بالكامل" },
  { key: "headerDiscount", col: "خصم الفاتورة / الضريبة", what: "خصم وضريبة على مستوى الفاتورة", need: "عشان الإجمالي يطلع مضبوط", requiredFor: [], fallback: "٠" },
  { key: "cost", col: "التكلفة", what: "سعر تكلفة الصنف", need: "مهم في فواتير البيع لحساب الربح", requiredFor: ["sale", "sale_return"], skipFor: ["purchase", "purchase_return"], fallback: "٠ → النظام بياخد آخر تكلفة للمنتج، عدّلها من عمود «التكلفة»" },
  { key: "marketPrice", col: "سعر السوق", what: "سعر البيع المعلن", need: "بيتحط على كارت المنتج", requiredFor: ["purchase"], fallback: "٠ → المنتج هيتسجل من غير سعر بيع معلن" },
  { key: "productInfo", col: "الماركة / الموديل / التصنيف / الوحدة / الباركود", what: "بيانات المنتج", need: "بتتسجل على المنتج الجديد بدل «غير محدد»", requiredFor: [], fallback: "«غير محدد» / وحدة = قطعة" },
  { key: "lineDiscount", col: "خصم % / الخصم", what: "خصم السطر بالنسبة أو بالجنيه", need: "أي واحد فيهم بيكفي", requiredFor: [], fallback: "٠" },
];

/** بيفحص الشيت المرفوع فعليًا ويرجّع الأعمدة الموجودة والناقصة (مطلوبة/اختيارية) حسب نوع الفاتورة */
export function auditSheetColumns(docs: any[], kind?: string) {
  const k = (kind ?? "") as Kind;
  const items = docs.flatMap((d) => d.items ?? []);
  const someDoc = (fn: (d: any) => boolean) => docs.some(fn);
  const someItem = (fn: (i: any) => boolean) => items.some(fn);

  const present: Record<ColumnKey, boolean> = {
    date: someDoc((d) => !!d.dateISO),
    number: someDoc((d) => !!String(d.legacyNumber || "").trim()),
    original: someDoc((d) => !!d.originalNumber),
    warehouse: someDoc((d) => !!String(d.warehouse || "").trim()),
    account: someDoc((d) => !!String(d.account || "").trim()),
    payments: someDoc((d) => (d.payments ?? []).some((p: any) => Number(p.amount) > 0)),
    credit: someDoc((d) => Number(d.credit) > 0 || Number(d.due) > 0),
    headerDiscount: someDoc((d) => Number(d.headerDiscount) > 0 || Number(d.tax) > 0),
    cost: someItem((i) => Number(i.cost) > 0),
    marketPrice: someItem((i) => Number(i.marketPrice) > 0),
    productInfo: someItem((i) => !!(i.brand || i.model || i.category || i.unit || i.barcode)),
    lineDiscount: someItem((i) => Number(i.discount) > 0 || Number(i.discountPercent) > 0),
  };

  const relevant = COLUMN_HELP.filter((c) => !(k && c.skipFor?.includes(k as any)));
  const isRequired = (c: ColumnInfo) =>
    c.requiredFor === undefined ? true : !k ? c.requiredFor.length > 0 : c.requiredFor.includes(k as any);

  const missingAll = relevant.filter((c) => !present[c.key]);

  return {
    kind: k,
    total: relevant.length,
    present: relevant.filter((c) => present[c.key]),
    missing: missingAll,
    missingKeys: missingAll.map((c) => c.key),
    missingRequired: missingAll.filter(isRequired),
    missingOptional: missingAll.filter((c) => !isRequired(c)),
    isRequired,
  };
}



const EXAMPLE_DOC = [
  "2025-03-14", "13:20", "1024", "", "المخزن الرئيسي", "توشيبا للتجارة", "كاش + آجل",
  5000, 0, 0, 0, 2000, 100, 0, 7000, "محمد أحمد", "فاتورة مرحّلة",
];

const EXAMPLE_ITEM = [
  "P-1001", "622000112233", "تكييف توشيبا 1.5 حصان", "توشيبا", "RAS-18", "تكييفات", "قطعة",
  2, 3550, 3000, 3700, 0, 100, 7000,
];

export function downloadLegacyTemplate(kind: LegacyKind | "" = "") {
  const title = kind ? LEGACY_KIND_LABEL[kind] : "فواتير بيع";
  const rows: any[][] = [
    [title],
    [],
    [...DOC_COLUMNS],
    EXAMPLE_DOC,
    [...ITEM_COLUMNS],
    EXAMPLE_ITEM,
    [],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = new Array(Math.max(DOC_COLUMNS.length, ITEM_COLUMNS.length)).fill({ wch: 16 });

  const help = XLSX.utils.json_to_sheet(
    COLUMN_HELP.map((c) => ({ "العمود": c.col, "معناه إيه": c.what, "بيفيد في إيه": c.need })),
  );
  help["!cols"] = [{ wch: 34 }, { wch: 30 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الفواتير");
  XLSX.utils.book_append_sheet(wb, help, "شرح الأعمدة");
  XLSX.writeFile(wb, `قالب-نظام-${title}.xlsx`);
}
