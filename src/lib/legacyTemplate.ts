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

export const COLUMN_HELP: { col: string; what: string; need: string }[] = [
  { col: "التاريخ + الوقت", what: "تاريخ ووقت الفاتورة", need: "بيتسجل زي ما هو في النظام" },
  { col: "رقم الفاتورة", what: "الرقم القديم", need: "بيمنع تكرار الترحيل" },
  { col: "الفاتورة المرتجعة", what: "رقم الفاتورة الأصلية", need: "للمرتجعات بس — بتربط المرتجع بأصله" },
  { col: "المخزن", what: "الفرع اللي اتعمل فيه المستند", need: "بيربط الحركة بالفرع الصح" },
  { col: "الحساب", what: "اسم العميل أو المورد", need: "بيربط الرصيد بالحساب" },
  { col: "كاش / انستاباي / فودافون كاش / PayMob", what: "المدفوع بكل وسيلة", need: "بيحدد الخزنة اللي هتدخل فيها الفلوس" },
  { col: "الآجل", what: "المتبقي على الحساب", need: "بيتحوّل لرصيد آجل على العميل/المورد" },
  { col: "خصم الفاتورة / الضريبة", what: "خصم وضريبة على مستوى الفاتورة", need: "عشان الإجمالي يطلع مضبوط" },
  { col: "التكلفة", what: "سعر تكلفة الصنف", need: "مهم في فواتير البيع لحساب الربح — لو فاضي بيتحط صفر وتعدّله قبل الاعتماد" },
  { col: "سعر السوق", what: "سعر البيع المعلن", need: "بيتحط على كارت المنتج" },
  { col: "الماركة / الموديل / التصنيف / الوحدة / الباركود", what: "بيانات المنتج", need: "بتتسجل على المنتج الجديد بدل «غير محدد»" },
  { col: "خصم % / الخصم", what: "خصم السطر بالنسبة أو بالجنيه", need: "أي واحد فيهم بيكفي" },
];

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
