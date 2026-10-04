import type { ReactNode } from "react";
import { TrendingUp, XCircle, ArrowDownCircle, ArrowUpCircle, Clock, Banknote, CreditCard, Smartphone, Landmark, Scale, Users, Truck, Receipt, Wallet } from "lucide-react";
import { MetricCardWithHint } from "@/components/MetricCardWithHint";
import type { DocKind, DocCardKey } from "@/lib/documentMetrics";
import type { DocMetrics } from "@/hooks/useDocumentMetrics";
import type { CollectionBucket } from "@/hooks/useSalesInvoices";

type Tone = "success" | "destructive" | "warning" | "primary";
interface CardDef { key: string; label: string; icon: ReactNode; tone: Tone; meaning: string; formula: string; countWord?: string; filterable?: boolean; value?: (m: DocMetrics) => number }

const SOURCE: Record<DocKind, string> = {
  sale: "فواتير البيع المطابقة لكل الفلاتر الحالية (بتاريخ الفاتورة الفعلي) في هذا الفرع فقط، مع مدفوعاتها غير الملغاة وغير العكسية.",
  purchase: "فواتير الشراء المطابقة لكل الفلاتر (بتاريخ الفاتورة) في هذا الفرع، وسندات سداد الموردين النشطة في نفس الفرع ونفس الفترة.",
  sale_return: "مرتجعات البيع المطابقة لكل الفلاتر (بتاريخ المرتجع) في هذا الفرع، مقسمة حسب طريقة رد المبلغ.",
  purchase_return: "مرتجعات الشراء المطابقة لكل الفلاتر (بتاريخ المرتجع) في هذا الفرع، مقسمة حسب طريقة الاسترداد.",
  income: "سندات القبض المطابقة لكل الفلاتر (بتاريخ السند) في هذا الفرع.",
  expense: "سندات الصرف المطابقة لكل الفلاتر (بتاريخ السند) في هذا الفرع، شاملة كل ما خرج من الخزينة.",
};

const TOP: Record<DocKind, CardDef[]> = {
  sale: [
    { key: "active", label: "المبيعات النشطة", icon: <TrendingUp />, tone: "primary", countWord: "فاتورة نشطة", meaning: "عدد وقيمة فواتير البيع النشطة فقط.", formula: "Σ الإجمالي حيث الحالة = نشطة" },
    { key: "cancelled", label: "فواتير ملغاة", icon: <XCircle />, tone: "destructive", countWord: "فاتورة ملغاة", meaning: "الفواتير الملغاة، منفصلة عن المبيعات النشطة.", formula: "Σ الإجمالي حيث الحالة = ملغاة" },
    { key: "collected", label: "المحصل الفعلي (+)", icon: <ArrowDownCircle />, tone: "success", meaning: "المسدد من الفواتير المعروضة وفق كشف حساب العميل في الفرع: كل التحصيلات (دفعات الفاتورة، سندات القبض اليدوية والمربوطة، الجزء الدائن من المرتجعات) تُوزَّع على الأقدم أولًا بدءًا بالرصيد الافتتاحي، حتى نهاية الفترة. العميل النقدي بلا جهة: دفعات الفاتورة المباشرة.", formula: "Σ min(إجمالي الفاتورة، رصيد التحصيلات المتبقي بعد الرصيد الافتتاحي والفواتير الأقدم)" },
    { key: "remaining", label: "المتبقي / الآجل مدين (-)", icon: <Clock />, tone: "warning", meaning: "المبالغ الآجلة المتبقية على العملاء.", formula: "Σ max(0, الإجمالي − المسدد الموزع من كشف الحساب) لكل فاتورة نشطة" },
  ],
  purchase: [
    { key: "active", label: "إجمالي المشتريات", icon: <TrendingUp />, tone: "primary", countWord: "فاتورة شراء", meaning: "قيمة فواتير الشراء المطابقة.", formula: "Σ إجمالي التكلفة" },
    { key: "cancelled", label: "مشتريات ملغاة", icon: <XCircle />, tone: "destructive", countWord: "فاتورة", meaning: "فواتير الشراء لا تُلغى في النظام (تُحذف بسجل تدقيق)، لذلك القيمة صفر دائمًا.", formula: "Σ فواتير الشراء الملغاة = 0" },
    { key: "supplierPaid", label: "المسدد للموردين (-)", icon: <ArrowUpCircle />, tone: "success", countWord: "فاتورة مسددة بالكامل", value: (m) => m.supplierPaid ?? 0, meaning: "المسدد من فواتير الشراء المعروضة وفق كشف حساب المورد في الفرع: مدفوعات الموردين وسندات الصرف والجزء المخصوم من مرتجعات الشراء (ناقص سندات القبض من المورد) تُوزَّع على الأقدم أولًا بدءًا بالرصيد الافتتاحي، حتى نهاية الفترة. النقر يعرض الفواتير المسددة بالكامل (المتبقي = 0).", formula: "Σ المسدد لكل فاتورة = min(إجمالي الفاتورة، رصيد السداد المتبقي بعد الرصيد الافتتاحي والفواتير الأقدم)" },
    { key: "supplierDue", label: "المستحق للموردين / الآجل دائن (+)", icon: <Clock />, tone: "warning", countWord: "فاتورة عليها متبقي", value: (m) => m.supplierDue ?? 0, meaning: "المتبقي للموردين على فواتير الشراء المعروضة بعد توزيع سداداتهم. النقر يعرض الفواتير التي عليها متبقي (> 0).", formula: "Σ max(0, إجمالي الفاتورة − المسدد الموزع عليها)" },
  ],
  sale_return: [
    { key: "active", label: "إجمالي المرتجع", icon: <TrendingUp />, tone: "primary", countWord: "مرتجع نشط", meaning: "قيمة مرتجعات البيع النشطة.", formula: "Σ قيمة المرتجع حيث الحالة = نشط" },
    { key: "cancelled", label: "مرتجع ملغي", icon: <XCircle />, tone: "destructive", countWord: "مرتجع ملغي", meaning: "المرتجعات الملغاة، خارج باقي الكروت.", formula: "Σ قيمة المرتجع حيث الحالة = ملغي" },
    { key: "paidOut", label: "المنصرف نقداً للعميل (-)", icon: <ArrowUpCircle />, tone: "destructive", countWord: "مرتجع", meaning: "ما رُدّ للعملاء نقدًا أو تحويلًا من الخزينة.", formula: "Σ (الجزء النقدي + الجزء المحوّل) للمرتجعات النشطة" },
    { key: "credit", label: "المضاف كرصيد دائن للعميل", icon: <Wallet />, tone: "warning", countWord: "مرتجع", meaning: "ما أُضيف لرصيد العميل بدل رده نقدًا — لا يحرك الخزينة.", formula: "Σ الجزء المضاف للرصيد للمرتجعات النشطة" },
  ],
  purchase_return: [
    { key: "active", label: "إجمالي المرتجع", icon: <TrendingUp />, tone: "primary", countWord: "مرتجع نشط", meaning: "قيمة مرتجعات الشراء النشطة.", formula: "Σ قيمة المرتجع حيث الحالة = نشط" },
    { key: "cancelled", label: "مرتجع ملغي", icon: <XCircle />, tone: "destructive", countWord: "مرتجع ملغي", meaning: "المرتجعات الملغاة، خارج باقي الكروت.", formula: "Σ قيمة المرتجع حيث الحالة = ملغي" },
    { key: "refunded", label: "المسترد نقداً للخزينة (+)", icon: <ArrowDownCircle />, tone: "success", countWord: "مرتجع", meaning: "ما استرده الفرع من الموردين نقدًا أو تحويلًا.", formula: "Σ (الجزء النقدي + الجزء المحوّل) للمرتجعات النشطة" },
    { key: "deducted", label: "المخصوم من مديونية المورد", icon: <Scale />, tone: "warning", countWord: "مرتجع", meaning: "ما خُصم من حساب المورد بدل استرداده نقدًا — لا يحرك الخزينة.", formula: "Σ الجزء المخصوم من الرصيد للمرتجعات النشطة" },
  ],
  income: [
    { key: "active", label: "إجمالي المقبوضات", icon: <TrendingUp />, tone: "success", countWord: "سند نشط", meaning: "قيمة سندات القبض النشطة.", formula: "Σ المبلغ حيث الحالة = نشط" },
    { key: "cancelled", label: "سندات ملغاة", icon: <XCircle />, tone: "destructive", countWord: "سند ملغي", meaning: "السندات الملغاة، خارج باقي الكروت.", formula: "Σ المبلغ حيث الحالة = ملغي" },
    { key: "customers", label: "مقبوض من عملاء", icon: <Users />, tone: "primary", countWord: "سند", meaning: "سندات القبض التي طرفها عميل.", formula: "Σ المبلغ حيث نوع الطرف = عميل" },
    { key: "otherIncome", label: "إيرادات أخرى", icon: <Receipt />, tone: "warning", countWord: "سند", meaning: "باقي سندات القبض (بدون طرف عميل).", formula: "إجمالي المقبوضات − مقبوض من عملاء" },
  ],
  expense: [
    { key: "active", label: "إجمالي المدفوعات", icon: <TrendingUp />, tone: "destructive", countWord: "سند نشط", meaning: "قيمة سندات الصرف النشطة.", formula: "Σ المبلغ حيث الحالة = نشط" },
    { key: "cancelled", label: "سندات ملغاة", icon: <XCircle />, tone: "warning", countWord: "سند ملغي", meaning: "السندات الملغاة، خارج باقي الكروت.", formula: "Σ المبلغ حيث الحالة = ملغي" },
    { key: "suppliers", label: "سداد موردين", icon: <Truck />, tone: "primary", countWord: "سند", meaning: "سندات الصرف لطرف مورد أو بتصنيف سداد مورد.", formula: "Σ المبلغ حيث الطرف = مورد" },
    { key: "operating", label: "مصاريف تشغيلية وإدارية", icon: <Receipt />, tone: "destructive", countWord: "سند", meaning: "المصاريف التشغيلية والإدارية الفعلية فقط (إيجارات، مرتبات، كهرباء، صيانة، ضيافة...).", formula: "إجمالي المدفوعات − سداد موردين − تحويلات داخلية ومرتجع وسلف" },
    { key: "internal", label: "تحويلات داخلية ومرتجع وسلف", icon: <ArrowUpCircle />, tone: "warning", countWord: "سند", meaning: "تحويلات بين الخزن/الفروع، مرتجعات ومدفوعات للعملاء، وسلف الموظفين (ذمة تُسترد) — خرجت من الخزينة لكنها ليست مصروفًا تشغيليًا.", formula: "Σ المبلغ حيث التصنيف = مرتجع عميل أو تحويل (خزينة/فرع) أو سلف موظفين، أو الطرف = عميل" },
  ],
};

const BUCKET_DEFS: { key: CollectionBucket; label: string; icon: ReactNode }[] = [
  { key: "cash", label: "نقدي", icon: <Banknote /> },
  { key: "instapay", label: "انستاباي", icon: <CreditCard /> },
  { key: "wallet", label: "محفظة", icon: <Smartphone /> },
  { key: "bank", label: "بنكي", icon: <Landmark /> },
  { key: "other", label: "رصيد مسبق", icon: <Scale /> },
];
/** Vouchers always move a real treasury, so they have no prepaid-balance bucket. */
const BUCKETS_FOR: Record<DocKind, CollectionBucket[]> = {
  sale: ["cash", "instapay", "wallet", "bank", "other"],
  purchase: ["cash", "instapay", "wallet", "bank", "other"],
  sale_return: ["cash", "instapay", "wallet", "bank", "other"],
  purchase_return: ["cash", "instapay", "wallet", "bank", "other"],
  income: ["cash", "instapay", "wallet", "bank"],
  expense: ["cash", "instapay", "wallet", "bank"],
};
const BUCKET_VERB: Record<DocKind, string> = {
  sale: "حُصّل", purchase: "سُدد للموردين", sale_return: "رُدّ للعملاء", purchase_return: "استُرد", income: "قُبض", expense: "صُرف",
};

interface Props { kind: DocKind; metrics: DocMetrics | null; loading: boolean; selected: DocCardKey | null; onSelect: (k: DocCardKey | null) => void }

/** Two rows of click-to-filter accounting cards whose meaning adapts to the document type. */
export function UnifiedDocumentMetrics({ kind, metrics, loading, selected, onSelect }: Props) {
  const source = SOURCE[kind];
  const sel = (key: string, filterable = true) => filterable ? { active: selected === key, onClick: () => onSelect(selected === key ? null : key) } : {};
  const buckets = BUCKETS_FOR[kind];
  const verb = BUCKET_VERB[kind];
  return (
    <div className={`space-y-3 mb-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className={`grid grid-cols-2 gap-3 ${TOP[kind].length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {TOP[kind].map((c) => {
          const value = c.value ? (metrics ? c.value(metrics) : 0) : (metrics?.values[c.key] ?? 0);
          const count = metrics?.counts[c.key];
          return (
            <MetricCardWithHint key={c.key} label={c.label} value={value} icon={c.icon} tone={c.tone} {...sel(c.key, c.filterable !== false)}
              footer={c.countWord && count !== undefined ? <span className="tabular-nums">{count.toLocaleString("en-US")} {c.countWord}</span> : undefined}
              metricHint={{ meaning: c.meaning, source, formula: c.formula }} />
          );
        })}
      </div>
      <div className={`grid grid-cols-2 gap-3 ${buckets.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {BUCKET_DEFS.filter((b) => buckets.includes(b.key)).map((b) => {
          const flow = kind === "sale" || kind === "purchase";
          const label = flow
            ? (b.key === "other" ? (kind === "sale" ? "خصم من الرصيد المسبق (بدون نقدية)" : "رصيد مسبق") : `${kind === "sale" ? "إجمالي المحصل" : "إجمالي المسدد"} ${b.label} — فواتير + سندات`)
            : b.label;
          const party = kind === "sale" ? "العملاء" : "الموردين";
          const vName = kind === "sale" ? "سندات القبض من العملاء" : "سندات الصرف للموردين";
          return (
          <MetricCardWithHint key={b.key} label={label} value={metrics?.byBucket[b.key] ?? 0} icon={b.icon} tone={b.key === "other" ? "warning" : "success"}
            {...sel(b.key, !flow)}
            metricHint={flow ? {
              meaning: b.key === "other"
                ? (kind === "sale" ? "ما سُدد من الفواتير بخصم رصيد العميل المسبق — لا يحرك الخزينة." : "سداد الموردين لا يتم بالرصيد المسبق من هذه الشاشة، لذلك القيمة صفر عادةً.")
                : `التدفق الفعلي بطريقة «${b.label}» خلال الفترة: يجمع ${kind === "sale" ? "الدفعات المسجلة على فواتير البيع المعروضة (عند الإنشاء أو بعده)" : "سداد الموردين"} مع كل ${vName} اليدوية والمربوطة بنفس الطريقة، في نفس الفرع والفترة${kind === "sale" ? "" : ""}.`,
              source: `${kind === "sale" ? "دفعات فواتير البيع (invoice_payments) + " : ""}${vName} النشطة — حسب تاريخ السند وفلتر الجهة`,
              formula: b.key === "other"
                ? "Σ دفعات الفواتير بطريقة الرصيد المسبق"
                : `${kind === "sale" ? "Σ دفعات الفواتير «" + b.label + "» + " : ""}Σ ${vName} «${b.label}» في الفترة. قد يختلف المجموع عن كارت ${kind === "sale" ? "المحصل" : "المسدد"} لأن السندات تسدد أيضًا أرصدة افتتاحية وفواتير من فترات أخرى لدى ${party}.`,
            } : {
              meaning: b.key === "other"
                ? `ما ${verb} عن طريق الرصيد المسبق / الحساب، بدون أي حركة نقدية في الخزينة.`
                : `ما ${verb} عن طريق «${b.label}» من المستندات النشطة المطابقة.`,
              source,
              formula: `Σ مبالغ «${b.label}» للمستندات النشطة؛ ومجموع الأوعية = ${kind === "sale_return" ? "المنصرف + المضاف للرصيد" : kind === "purchase_return" ? "المسترد + المخصوم" : "إجمالي السندات النشطة"}`,
            }} />
          );
        })}
      </div>
    </div>
  );
}
