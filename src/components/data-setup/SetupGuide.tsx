import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ListOrdered, Wallet, Lock, Lightbulb, AlertTriangle, Target, TableProperties, Sparkles,
  FileSpreadsheet, Rocket, CheckCircle2,
} from "lucide-react";


/* ============================================================
   دليل الاستخدام بالعامية لشاشة «تأسيس وترحيل البيانات»
   ============================================================ */

export type SheetGuide = {
  id: string;
  order: string;
  title: string;
  why: string;
  cols: { name: string; must?: boolean; hint?: string }[];
  example: Record<string, string>;
  mistakes: { wrong: string; avoid: string }[];
};

export const CORE_SHEETS: SheetGuide[] = [
  {
    id: "branches",
    order: "1",
    title: "الفروع",
    why: "دي أول حاجة خالص. كل صنف وكل خزنة وكل موظف لازم يبقى تابع لفرع، فلو الفروع مش موجودة كل الملفات اللي بعدها هتترفض.",
    cols: [
      { name: "كود الفرع", must: true, hint: "حروف/أرقام قصيرة زي B01 — هتستخدمه في كل الملفات بعد كده" },
      { name: "اسم الفرع", must: true },
      { name: "العنوان" },
      { name: "التليفون" },
      { name: "تارجت المبيعات الشهري", hint: "لو فاضي = 0" },
      { name: "حد تنبيه الخزنة", hint: "لو فاضي = 0" },
    ],
    example: {
      "كود الفرع": "B01",
      "اسم الفرع": "الفرع الرئيسي",
      "العنوان": "شارع الجمهورية - طنطا",
      "التليفون": "0403300000",
      "تارجت المبيعات الشهري": "500000",
      "حد تنبيه الخزنة": "5000",
    },
    mistakes: [
      { wrong: "بتكتب اسم الفرع في خانة الكود (مثلاً «الفرع الرئيسي» في عمود الكود).", avoid: "خلي الكود قصير وثابت (B01/B02) واسم الفرع في عموده لوحده." },
      { wrong: "بتكرر نفس الكود لفرعين.", avoid: "راجع عمود الكود قبل الرفع — الكود مينفعش يتكرر خالص." },
      { wrong: "بتغيّر الكود بعد ما ترفع المنتجات.", avoid: "استقر على الأكواد من أول مرة، لأن كل الملفات بعدها بتشاور عليها." },
    ],
  },
  {
    id: "categories",
    order: "2",
    title: "التصنيفات (نوع ← صنف)",
    why: "التصنيفات هي شجرة منتجاتك (مثلاً: تكييفات ← سبليت). لازم ترفعها قبل المنتجات عشان المنتج يلاقي تصنيفه.",
    cols: [
      { name: "اسم التصنيف", must: true },
      { name: "التصنيف الأب", hint: "سيبه فاضي لو ده تصنيف رئيسي" },
    ],
    example: { "اسم التصنيف": "سبليت", "التصنيف الأب": "تكييفات" },
    mistakes: [
      { wrong: "بتحط التصنيف الابن قبل الأب في الملف.", avoid: "رتّب الملف: الأب فوق، وبعده أبناءه." },
      { wrong: "بتكتب الأب بشكل مختلف (تكييفات / التكييفات).", avoid: "انسخ اسم الأب بالحرف زي ما كتبته فوق." },
      { wrong: "بتعمل شجرة 3 مستويات.", avoid: "النظام مستويين بس: نوع ← صنف." },
    ],
  },
  {
    id: "products",
    order: "3",
    title: "المنتجات",
    why: "كارت الصنف نفسه: الكود والاسم والأسعار والفرع. الكود/الباركود ده اللي الكاشير هيدور بيه.",
    cols: [
      { name: "كود الصنف/الباركود", must: true, hint: "هو نفسه الباركود — مفيش عمود تاني للباركود" },
      { name: "اسم الصنف", must: true },
      { name: "كود الفرع", must: true, hint: "لازم يكون فرع مرفوع في خطوة 1" },
      { name: "التصنيف", hint: "لازم يكون مرفوع في خطوة 2" },
      { name: "سعر التكلفة" },
      { name: "سعر البيع" },
      { name: "سعر السوق" },
      { name: "الماركة / الموديل / اللون / المقاس / السعة" },
      { name: "حد التنبيه", hint: "لو فاضي = 5" },
      { name: "الكود في النظام القديم" },
    ],
    example: {
      "كود الصنف/الباركود": "622000112233",
      "اسم الصنف": "تكييف توشيبا 1.5 حصان",
      "كود الفرع": "B01",
      "التصنيف": "سبليت",
      "سعر التكلفة": "3000",
      "سعر البيع": "3550",
      "الماركة": "توشيبا",
      "الموديل": "RAS-18",
    },
    mistakes: [
      { wrong: "بترفع المنتج وكود الفرع غلط أو فاضي.", avoid: "اعمل عمود كود الفرع لكل صف — مفيش صنف بيتعلق في الهوا." },
      { wrong: "بتسيب سعر التكلفة صفر وتعتمد عليه بعدين في الربح.", avoid: "التكلفة الحقيقية بتتحدد من «المخزون الافتتاحي» في خطوة 4، فمتقلقش، بس الأفضل تكتبها." },
      { wrong: "بتكرر نفس الكود في نفس الفرع.", avoid: "الكود فريد لكل فرع — لو نفس الصنف في فرعين اعمل صفين بنفس الكود بفرعين مختلفين." },
    ],
  },
  {
    id: "stock",
    order: "4",
    title: "المخزون الافتتاحي",
    why: "الكميات اللي فعلاً موجودة عندك في المخزن يوم بداية التشغيل + تكلفة الوحدة. ده أساس الـ FIFO وحساب الربح بعد كده.",
    cols: [
      { name: "كود الفرع", must: true },
      { name: "كود الصنف/الباركود", must: true, hint: "لازم المنتج مرفوع في نفس الفرع" },
      { name: "الكمية", must: true },
      { name: "تكلفة الوحدة", must: true, hint: "أهم عمود — عليه بيتحسب الربح" },
    ],
    example: { "كود الفرع": "B01", "كود الصنف/الباركود": "622000112233", "الكمية": "12", "تكلفة الوحدة": "3000" },
    mistakes: [
      { wrong: "بتكتب سعر البيع في خانة تكلفة الوحدة.", avoid: "دي تكلفة الشراء الحقيقية — لو حطيت البيع الربح هيطلع صفر أو خسارة وهمية." },
      { wrong: "بترفع مخزون افتتاحي وكمان فواتير شراء تاريخية لنفس الأصناف.", avoid: "اختار واحدة بس: يا رصيد افتتاحي يا فواتير تاريخية، وإلا الكمية هتتحسب مرتين." },
      { wrong: "بتحط كميات بالسالب.", avoid: "الرصيد الافتتاحي كميات موجبة بس؛ النقص بيتسجل بجرد بعدين." },
    ],
  },
  {
    id: "contacts",
    order: "5",
    title: "العملاء والموردين",
    why: "دفتر أسماء الحسابات. لازم يترفع قبل أرصدة الذمم وقبل أي فاتورة تاريخية.",
    cols: [
      { name: "الاسم", must: true, hint: "ممنوع التكرار" },
      { name: "النوع", must: true, hint: "عميل / مورد / الاتنين" },
      { name: "التليفون", hint: "لو مكرر الصف هيترفض" },
      { name: "الإيميل / الشخص المسؤول / العنوان / ملاحظات" },
      { name: "كود الفرع", hint: "فاضي = على مستوى الشركة كلها" },
    ],
    example: { "الاسم": "توشيبا للتجارة", "النوع": "مورد", "التليفون": "01001234567", "كود الفرع": "" },
    mistakes: [
      { wrong: "بتكتب نفس العميل مرتين بكتابة مختلفة (أحمد علي / احمد على).", avoid: "وحّد الأسماء في الإكسل الأول بفلتر، لأن أي اختلاف = حساب جديد ورصيد متفرق." },
      { wrong: "بتحدد النوع «عميل» لحد إنت بتشتري منه كمان.", avoid: "لو بتبيع وتشتري من نفس الشخص اكتب «الاتنين»." },
    ],
  },
  {
    id: "arap",
    order: "6",
    title: "أرصدة العملاء/الموردين الافتتاحية (الديون القديمة)",
    why: "الديون اللي معلّقة قبل ما تشتغل على النظام، كرقم واحد مجمّع لكل حساب.",
    cols: [
      { name: "اسم العميل/المورد", must: true, hint: "لازم يكون مرفوع في خطوة 5 بنفس الاسم" },
      { name: "التليفون", hint: "للتفرقة بين الأسماء المتشابهة" },
      { name: "الرصيد الافتتاحي", must: true, hint: "موجب = ليك عند العميل، سالب = عليك للمورد" },
    ],
    example: { "اسم العميل/المورد": "محمد أحمد", "التليفون": "01001234567", "الرصيد الافتتاحي": "4500" },
    mistakes: [
      { wrong: "بتكتب دين المورد بالموجب.", avoid: "اللي إنت مدين له اكتبه بالسالب (‎-12000‎)، واللي مدين لك بالموجب." },
      { wrong: "بترفع رصيد إجمالي لحساب إنت رافعله فواتير تاريخية.", avoid: "النظام هيرفض من نفسه — اختار طريقة واحدة للحساب ده من خطوة 2." },
    ],
  },
  {
    id: "employees",
    order: "7",
    title: "الموظفين",
    why: "بيانات فريق الشغل والفرع اللي كل واحد فيه، وكمان الدور بتاعه لو هيدخل على النظام.",
    cols: [
      { name: "اسم الموظف", must: true },
      { name: "الوظيفة", must: true },
      { name: "كود الفرع", must: true },
      { name: "الدور في النظام", hint: "كاشير/مدير فرع/أمين مخزن/محاسب/ملاحظ/عامل/سواق — فاضي لو مش هيدخل النظام" },
      { name: "التليفون / الإيميل / الرقم القومي" },
      { name: "الراتب الأساسي" },
      { name: "تاريخ التعيين", must: true },
    ],
    example: {
      "اسم الموظف": "محمود سعيد", "الوظيفة": "كاشير", "كود الفرع": "B01",
      "الدور في النظام": "كاشير", "الراتب الأساسي": "6000", "تاريخ التعيين": "2024-05-01",
    },
    mistakes: [
      { wrong: "بتكتب الدور بكلام من دمّك (مثلاً «بياع»).", avoid: "اكتب الأدوار زي ما هي في القائمة بالحرف، وإلا الصف هيترفض." },
      { wrong: "بتفتكر إن رفع الموظف = عمل له حساب دخول.", avoid: "الدخول بيتعمل من شاشة المستخدمين والصلاحيات، الملف ده بيسجّل بياناته بس." },
    ],
  },
  {
    id: "treasury",
    order: "8",
    title: "الخزنة الافتتاحية",
    why: "الفلوس الموجودة فعلاً في كل فرع يوم البداية، مقسّمة على وسائل الدفع.",
    cols: [
      { name: "كود الفرع", must: true },
      { name: "وسيلة الدفع", must: true, hint: "كاش / محفظة / انستاباي / تحويل بنكي" },
      { name: "الرصيد الافتتاحي", must: true },
      { name: "مرجع/ملاحظة" },
    ],
    example: { "كود الفرع": "B01", "وسيلة الدفع": "كاش", "الرصيد الافتتاحي": "25000", "مرجع/ملاحظة": "جرد الخزنة 1 يناير" },
    mistakes: [
      { wrong: "بتجمع كل الوسائل في صف واحد كاش.", avoid: "اعمل صف لكل وسيلة، وإلا مطابقة الخزنة هتفشل بعدين." },
      { wrong: "بتكتب أسماء وسائل مش معروفة (فيزا/كارت).", avoid: "التزم بالأربعة: كاش، محفظة، انستاباي، تحويل بنكي." },
    ],
  },
];

export const LEGACY_SHEET: SheetGuide = {
  id: "legacy",
  order: "★",
  title: "شيت الفواتير التاريخية (بيع / شراء / مرتجع بيع / مرتجع شراء)",
  why: "لو عاوز تاريخك بالتفصيل — كل فاتورة بتاريخها وأصنافها وطريقة دفعها — بترفعها من هنا. النظام بيسجّل أثرها الكامل على المخزون والخزنة والقيود.",
  cols: [
    { name: "التاريخ + الوقت", must: true, hint: "لو فاضي بياخد تاريخ النهاردة وده غلط" },
    { name: "رقم الفاتورة", must: true, hint: "بيمنع ترحيل نفس الفاتورة مرتين" },
    { name: "الفاتورة المرتجعة", hint: "للمرتجعات بس — رقم الفاتورة الأصلية" },
    { name: "المخزن", must: true, hint: "الفرع" },
    { name: "الحساب", must: true, hint: "اسم العميل أو المورد" },
    { name: "كاش / انستاباي / فودافون كاش / PayMob", hint: "المدفوع بكل وسيلة" },
    { name: "الآجل", hint: "المتبقي على الحساب" },
    { name: "خصم الفاتورة / الضريبة" },
    { name: "التكلفة", hint: "مهم في فواتير البيع لحساب الربح" },
    { name: "سعر السوق", hint: "مهم في فواتير الشراء" },
    { name: "الماركة / الموديل / التصنيف / الوحدة / الباركود" },
    { name: "خصم % / الخصم", hint: "خصم السطر" },
  ],
  example: {
    "التاريخ": "2025-03-14", "الوقت": "13:20", "رقم الفاتورة": "1024", "المخزن": "الفرع الرئيسي",
    "الحساب": "توشيبا للتجارة", "كاش": "5000", "الآجل": "2000", "الإجمالي": "7000",
    "الصنف": "تكييف توشيبا 1.5 حصان", "الكمية": "2", "سعر الوحدة": "3550", "التكلفة": "3000",
  },
  mistakes: [
    { wrong: "بترفع فواتير تاريخية لحساب إنت مسجّل له رصيد إجمالي.", avoid: "امسح الرصيد الإجمالي الأول من خطوة 2، وإلا الدين هيتحسب مرتين والنظام هيرفض." },
    { wrong: "بتسيب عمود التاريخ فاضي.", avoid: "لازم تاريخ كل فاتورة، لأن التقارير والربح الشهري بيتحسبوا على التاريخ." },
    { wrong: "المدفوع + الآجل مش بيساوي الإجمالي.", avoid: "راجع الأعمدة في الإكسل بمعادلة جمع قبل الرفع." },
    { wrong: "بتعيد رفع نفس الملف مرتين.", avoid: "خلي رقم الفاتورة موجود دايمًا — هو اللي بيمنع التكرار، ولو غلطت استخدم «تراجع عن الترحيل»." },
  ],
};

/* ───────────────── مقدمة كل خطوة ───────────────── */

const STEP_INTRO: Record<1 | 2 | 3, {
  icon: any; title: string; job: string; bullets: string[];
  tone: string; ring: string;
}> = {
  1: {
    icon: ListOrdered,
    title: "خطوة 1 — القوائم الأساسية: إنت بتبني هيكل الشركة",
    job: "هنا بترفع بياناتك الثابتة اللي النظام كله هيقف عليها: الفروع، التصنيفات، الأصناف، مخزونك، عملاءك ومورديك، موظفينك، وفلوس الخزنة يوم البداية.",
    bullets: [
      "ارفع الملفات بالترتيب من 1 لـ 8 — كل ملف بيعتمد على اللي قبله.",
      "كل تبويب فيه زرار «حمّل القالب» — نزّله واملا فيه بدل ما تعمل شيت من عندك.",
      "قبل أي رفع النظام بيفحص الملف ويوريك الصفوف الغلط وسببها، ومش بيرفع غير الصح.",
    ],
    tone: "from-primary/12 via-primary/5 to-transparent",
    ring: "border-primary/30",
  },
  2: {
    icon: Wallet,
    title: "خطوة 2 — الأرصدة الافتتاحية: إنت بتقول للنظام مين مدين لمين",
    job: "لكل عميل/مورد تختار طريقة واحدة بس لتسجيل ديونه القديمة: رقم مجمّع واحد، أو فواتيره القديمة بالتفصيل.",
    bullets: [
      "«رصيد إجمالي» = أسرع وأبسط: رقم واحد. موجب = ليك عنده، سالب = عليك له.",
      "«فواتير تاريخية مفصّلة» = أدق: كل فاتورة بتاريخها وأصنافها ودفعها، وبتأثر على المخزون كمان.",
      "لو مش محتاج تاريخ تفصيلي، الرصيد الإجمالي بيكفيك تمامًا.",
    ],
    tone: "from-success/12 via-success/5 to-transparent",
    ring: "border-success/30",
  },
  3: {
    icon: Lock,
    title: "خطوة 3 — القفل التلقائي: النظام بيحميك من الحساب المزدوج",
    job: "مش مطلوب منك تعمل حاجة هنا — دي شاشة مراجعة. بتوريك كل حساب اتسجّل بأي طريقة، وإن التانية مقفولة عليه أوتوماتيك.",
    bullets: [
      "أي حساب له فواتير تاريخية → مينفعش تضيف له رصيد إجمالي.",
      "أي حساب له رصيد إجمالي → مينفعش ترحّل له فواتير تاريخية غير لما تمسح الرصيد.",
      "المنع بيحصل من قاعدة البيانات نفسها، مش مجرد رسالة على الشاشة.",
    ],
    tone: "from-warning/12 via-warning/5 to-transparent",
    ring: "border-warning/30",
  },
};

export function StepIntro({ step }: { step: 1 | 2 | 3 }) {
  const s = STEP_INTRO[step];
  const Icon = s.icon;
  return (
    <Card className={`mb-4 overflow-hidden ${s.ring} animate-fade-in`}>
      <div className={`bg-gradient-to-l ${s.tone}`}>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-11 h-11 rounded-2xl bg-background/70 backdrop-blur border border-border/60 flex items-center justify-center shadow-sm animate-pop-in">
              <Icon className="w-5 h-5 text-primary" />
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="font-bold text-base leading-tight">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.job}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {s.bullets.map((b, i) => (
              <div
                key={i}
                style={{ animationDelay: `${80 * i}ms` }}
                className="animate-scale-in rounded-xl border border-border/60 bg-background/70 backdrop-blur px-3 py-2 text-sm flex gap-2 transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <Target className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
                <span>{b}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

/* ───────────────── بطاقة الغلطات ───────────────── */

function Mistakes({ items }: { items: { wrong: string; avoid: string }[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-warning">
        <AlertTriangle className="w-4 h-4" /> غلطات شائعة — اتجنبها
      </div>
      {items.map((m, i) => (
        <div
          key={i}
          style={{ animationDelay: `${60 * i}ms` }}
          className="animate-fade-in rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm space-y-1"
        >
          <p className="flex gap-2"><span className="text-destructive font-bold shrink-0">الغلط:</span><span>{m.wrong}</span></p>
          <p className="flex gap-2"><span className="text-success font-bold shrink-0">اتجنبه:</span><span className="text-muted-foreground">{m.avoid}</span></p>
        </div>
      ))}
    </div>
  );
}

/* ───────────────── شكل الشيت نفسه (زي إكسل) ───────────────── */

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function expandCols(cols: SheetGuide["cols"]) {
  const out: { name: string; must?: boolean }[] = [];
  cols.forEach((c) => {
    c.name.split(" / ").forEach((n) => out.push({ name: n.trim(), must: c.must }));
  });
  return out;
}

function SheetMock({ sheet }: { sheet: SheetGuide }) {
  const cols = expandCols(sheet.cols);
  const row1 = cols.map((c) => sheet.example[c.name] ?? "");
  return (
    <div className="rounded-xl border-2 border-emerald-500/30 overflow-hidden animate-fade-in">
      <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-2 border-b border-emerald-500/20">
        <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
          {sheet.title}.xlsx — الصف الأول عناوين، ومن الصف التاني بياناتك
        </span>
      </div>
      <div className="overflow-x-auto bg-background">
        <table className="w-full text-xs border-collapse" dir="rtl">
          <thead>
            <tr className="bg-muted/60 text-muted-foreground">
              <th className="w-8 px-2 py-1 border border-border/60"> </th>
              {cols.map((c, i) => (
                <th key={i} className="px-3 py-1 border border-border/60 font-mono font-normal text-center">
                  {COL_LETTERS[i] ?? i + 1}
                </th>
              ))}
            </tr>
            <tr>
              <th className="px-2 py-2 border border-border/60 bg-muted/60 text-muted-foreground font-mono">1</th>
              {cols.map((c, i) => (
                <th
                  key={i}
                  className={`px-3 py-2 border border-border/60 whitespace-nowrap text-center font-bold ${
                    c.must
                      ? "bg-primary/15 text-primary"
                      : "bg-muted/40 text-foreground/80"
                  }`}
                >
                  {c.name}
                  {c.must && <span className="text-destructive"> *</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-emerald-500/5">
              <td className="px-2 py-2 border border-border/60 bg-muted/60 text-muted-foreground font-mono text-center">2</td>
              {row1.map((v, i) => (
                <td key={i} className="px-3 py-2 border border-border/60 whitespace-nowrap text-center">
                  {v || <span className="text-muted-foreground/60">(سيبه فاضي)</span>}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-2 border border-border/60 bg-muted/60 text-muted-foreground font-mono text-center">3</td>
              {row1.map((_, i) => (
                <td key={i} className="px-3 py-2 border border-border/60 text-center text-muted-foreground/50">…</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 px-3 py-2 bg-muted/30 border-t border-border/60 text-[11px]">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-primary/25 border border-primary/40" /> عمود إجباري (*)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted border border-border" /> عمود اختياري</span>
        <span className="text-muted-foreground">اكتب العناوين بالحرف زي ما هي، ومتغيّرش ترتيبها.</span>
      </div>
    </div>
  );
}

/* ───────────────── الغرض من التابة كلها ───────────────── */

export function TabPurpose() {
  return (
    <Card className="mb-4 overflow-hidden border-primary/30 animate-fade-in">
      <div className="bg-gradient-to-l from-primary/15 via-accent/5 to-transparent">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-11 h-11 rounded-2xl bg-background/70 backdrop-blur border border-primary/30 flex items-center justify-center shadow-sm animate-pop-in">
              <Rocket className="w-5 h-5 text-primary" />
            </span>
            <div className="space-y-1 min-w-0">
              <h3 className="font-bold text-base">التابة دي بتعمل إيه؟ — «تأسيس وترحيل البيانات»</h3>
              <p className="text-sm text-muted-foreground">
                دي شاشة البداية بتاعة الشركة. هدفها إنك تنقل شغلك القديم (اللي في الإكسل أو الدفاتر) جوه النظام
                <b> مرة واحدة صح</b>، فتقدر تبدأ تبيع وتشتري وتطلّع تقارير من أول يوم وتلاقي أرقامك مظبوطة.
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {[
              {
                icon: ListOrdered,
                head: "1) القوائم الأساسية",
                body: "بترفع 8 شيتات: الفروع، التصنيفات، المنتجات، المخزون، العملاء/الموردين، أرصدتهم، الموظفين، الخزنة.",
                cls: "border-primary/30 bg-primary/5 text-primary",
              },
              {
                icon: Wallet,
                head: "2) الأرصدة الافتتاحية",
                body: "بتحدد لكل عميل/مورد ديونه القديمة: رقم مجمّع واحد، أو فواتيره القديمة بالتفصيل.",
                cls: "border-success/30 bg-success/5 text-success",
              },
              {
                icon: Lock,
                head: "3) القفل التلقائي",
                body: "مراجعة بس: النظام بيقفل الطريقة التانية لكل حساب عشان الدين ميتحسبش مرتين.",
                cls: "border-warning/30 bg-warning/5 text-warning",
              },
            ].map((c, i) => {
              const I = c.icon;
              return (
                <div key={i} style={{ animationDelay: `${80 * i}ms` }}
                  className={`animate-scale-in rounded-xl border p-3 space-y-1 transition-all hover:-translate-y-0.5 hover:shadow-md ${c.cls}`}>
                  <div className="flex items-center gap-2 font-bold text-sm"><I className="w-4 h-4" /> {c.head}</div>
                  <p className="text-xs text-foreground/80">{c.body}</p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm space-y-1">
              <div className="font-bold flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> اللي هيترتب على الشاشة دي
              </div>
              <p className="text-xs text-muted-foreground">
                مخزونك وتكلفته تبدأ صح (يعني الربح صح)، ديون العملاء والموردين تبقى ظاهرة، الخزنة تبدأ بأرقامها الحقيقية،
                والتقارير (الأرباح، الأعمار، المركز المالي) تطلع مطابقة للواقع.
              </p>
            </div>
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-1">
              <div className="font-bold flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-4 h-4" /> هل لازم بالترتيب؟
              </div>
              <p className="text-xs text-muted-foreground">
                أيوه — <b>الترتيب إجباري</b>: خطوة 1 قبل 2، وجوه خطوة 1 الشيتات من 1 لـ 8 بالترتيب (المنتج مش هيترفع
                من غير فرع وتصنيف). خطوة 3 مراجعة بس، تفتحها في أي وقت. ينفع ترجع لأي خطوة بعدين وتزوّد، بس ابدأ بالترتيب.
              </p>
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

/* ───────────────── تبويبات الشيتات ───────────────── */

const HOW_TO = [
  "نزّل القالب من تبويب الشيت في الجدول اللي تحت.",
  "املا بياناتك في القالب من غير ما تغيّر عناوين الأعمدة.",
  "ارفع الملف — النظام هيفحصه ويوريك الصفوف الغلط وسببها.",
  "صلّح الغلط وارفع تاني — بيتم رفع الصح بس.",
];

export function SheetGuideList({ sheets, defaultOpen }: { sheets: SheetGuide[]; defaultOpen?: string }) {
  const [active, setActive] = useState(defaultOpen ?? sheets[0]?.id);
  const s = sheets.find((x) => x.id === active) ?? sheets[0];
  if (!s) return null;

  return (
    <Card className="mb-4 animate-fade-in border-accent/30">
      <CardContent className="p-3 sm:p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <h4 className="font-bold text-sm">اختار الشيت من هنا وشوف شكله بالظبط قبل ما ترفعه</h4>
        </div>

        {sheets.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {sheets.map((x, i) => {
              const on = x.id === s.id;
              return (
                <button
                  key={x.id}
                  onClick={() => setActive(x.id)}
                  style={{ animationDelay: `${40 * i}ms` }}
                  className={`animate-scale-in flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all hover:-translate-y-0.5 ${
                    on
                      ? "bg-primary text-primary-foreground border-primary shadow-md scale-105"
                      : "bg-background border-border/70 hover:border-primary/50 hover:bg-primary/5"
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    on ? "bg-primary-foreground/20" : "bg-primary/15 text-primary"
                  }`}>{x.order}</span>
                  {x.title}
                </button>
              );
            })}
          </div>
        )}

        <div key={s.id} className="space-y-4 animate-fade-in">
          <div className="rounded-xl bg-warning/5 border border-warning/30 p-3 text-sm flex gap-2">
            <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
            <span><b>ليه بترفعه؟</b> {s.why}</span>
          </div>

          <SheetMock sheet={s} />

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <TableProperties className="w-4 h-4 text-primary" /> تفاصيل الأعمدة
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {s.cols.map((c, i) => (
                <div key={c.name} className={`rounded-xl border px-3 py-2 text-sm transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                  c.must ? "border-primary/30 bg-primary/5" : "border-border/60 bg-background"
                }`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">عمود {i + 1}</span>
                    <span className="font-medium">{c.name}</span>
                    {c.must
                      ? <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-[10px]">إجباري</Badge>
                      : <Badge variant="outline" className="text-[10px]">اختياري</Badge>}
                  </div>
                  {c.hint && <p className="text-xs text-muted-foreground mt-1">{c.hint}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
            <div className="text-sm font-bold text-sky-700 dark:text-sky-400 flex items-center gap-2">
              <Target className="w-4 h-4" /> الخطوات اللي هتعملها للشيت ده
            </div>
            <ol className="space-y-1">
              {HOW_TO.map((h, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="w-5 h-5 shrink-0 rounded-full bg-sky-500/20 text-sky-700 dark:text-sky-300 flex items-center justify-center font-bold">{i + 1}</span>
                  <span className="text-muted-foreground">{h}</span>
                </li>
              ))}
            </ol>
          </div>

          <Mistakes items={s.mistakes} />
        </div>
      </CardContent>
    </Card>
  );
}

