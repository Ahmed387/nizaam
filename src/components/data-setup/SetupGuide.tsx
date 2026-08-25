import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ListOrdered, Wallet, Lock, Lightbulb, AlertTriangle, Target, TableProperties, Sparkles,
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

function ExampleTable({ example }: { example: Record<string, string> }) {
  const keys = Object.keys(example);
  return (
    <div className="rounded-xl border border-border/60 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>{keys.map((k) => <th key={k} className="px-3 py-2 whitespace-nowrap text-center font-semibold">{k}</th>)}</tr>
        </thead>
        <tbody>
          <tr>{keys.map((k) => <td key={k} className="px-3 py-2 whitespace-nowrap text-center border-t">{example[k] || "—"}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

export function SheetGuideList({ sheets, defaultOpen }: { sheets: SheetGuide[]; defaultOpen?: string }) {
  return (
    <Card className="mb-4 animate-fade-in">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-accent" />
          <h4 className="font-bold text-sm">شكل الشيتات المطلوبة — دوس على أي واحد وشوف الأعمدة بالترتيب ومثال جاهز</h4>
        </div>
        <Accordion type="single" collapsible defaultValue={defaultOpen} className="space-y-2">
          {sheets.map((s) => (
            <AccordionItem
              key={s.id}
              value={s.id}
              className="border border-border/60 rounded-xl px-3 overflow-hidden transition-colors hover:border-primary/40 data-[state=open]:border-primary/50 data-[state=open]:bg-primary/[0.03]"
            >
              <AccordionTrigger className="hover:no-underline py-3">
                <div className="flex items-center gap-2 text-right">
                  <Badge className="bg-primary/15 text-primary border-primary/30 shrink-0">{s.order}</Badge>
                  <span className="font-semibold text-sm">{s.title}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <div className="rounded-xl bg-muted/40 border border-border/50 p-3 text-sm flex gap-2">
                  <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
                  <span><b>ليه بترفعه؟</b> {s.why}</span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <TableProperties className="w-4 h-4 text-primary" /> ترتيب الأعمدة في الشيت
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {s.cols.map((c, i) => (
                      <div key={c.name} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm transition-all hover:-translate-y-0.5 hover:shadow-sm">
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

                <div className="space-y-2">
                  <div className="text-sm font-semibold">مثال لصف واحد صحيح</div>
                  <ExampleTable example={s.example} />
                </div>

                <Mistakes items={s.mistakes} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
