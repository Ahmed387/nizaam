import type { ReactNode } from "react";
import { TrendingUp, XCircle, ArrowDownCircle, ArrowUpCircle, Clock, Banknote, CreditCard, Smartphone, Landmark, Scale, Users, Truck, Receipt, Wallet } from "lucide-react";
import { MetricCardWithHint } from "@/components/MetricCardWithHint";
import type { DocKind, DocCardKey } from "@/lib/documentMetrics";
import type { DocMetrics } from "@/hooks/useDocumentMetrics";
import type { CollectionBucket } from "@/hooks/useSalesInvoices";

type Tone = "success" | "destructive" | "warning" | "primary";
interface CardDef { key: string; label: string; icon: ReactNode; tone: Tone; meaning: string; formula: string; countWord?: string; filterable?: boolean; value?: (m: DocMetrics) => number; split?: "cash" | "credit" }

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
    { key: "active", label: "إجمالي المبيعات", icon: <TrendingUp />, tone: "primary", countWord: "فاتورة", meaning: "قيمة فواتير البيع النشطة المعروضة وعددها (الملغاة في تبويب «الملغاة» لوحدها).", formula: "Σ إجمالي الفاتورة للفواتير النشطة" },
    { key: "cashDocs", label: "مبيعات نقدية (اتدفعت بالكامل)", icon: <Banknote />, tone: "success", countWord: "فاتورة", split: "cash", meaning: "الفواتير اللي مفيش عليها ولا جنيه النهارده: اتدفعت كلها (وقت البيع أو بعده). تحت الكارت: اتدفعت إزاي.", formula: "Σ إجمالي الفواتير اللي الباقي عليها = 0" },
    { key: "creditDocs", label: "مبيعات آجلة (لسه عليها فلوس)", icon: <Clock />, tone: "warning", countWord: "فاتورة", split: "credit", meaning: "الفواتير اللي لسه عليها باقي النهارده. تحت الكارت: اللي اتدفع منها إزاي، والباقي على العملاء.", formula: "Σ إجمالي الفواتير اللي الباقي عليها > 0" },
  ],
  purchase: [
    { key: "active", label: "إجمالي المشتريات", icon: <TrendingUp />, tone: "primary", countWord: "فاتورة شراء", meaning: "قيمة فواتير الشراء المطابقة وعددها.", formula: "Σ إجمالي التكلفة" },
    { key: "cashDocs", label: "مشتريات نقدية (اتسددت بالكامل)", icon: <Banknote />, tone: "success", countWord: "فاتورة شراء", split: "cash", meaning: "فواتير الشراء اللي مفيش علينا فيها حاجة النهارده. تحت الكارت: اتسددت إزاي.", formula: "Σ إجمالي الفواتير اللي الباقي عليها = 0" },
    { key: "creditDocs", label: "مشتريات آجلة (لسه علينا فلوس)", icon: <Clock />, tone: "warning", countWord: "فاتورة شراء", split: "credit", meaning: "فواتير الشراء اللي لسه علينا فيها باقي للمورد النهارده. تحت الكارت: اللي اتسدد منها إزاي، والباقي للموردين.", formula: "Σ إجمالي الفواتير اللي الباقي عليها > 0" },
  ],
  sale_return: [
    { key: "active", label: "إجمالي المرتجع", icon: <TrendingUp />, tone: "primary", countWord: "مرتجع نشط", meaning: "قيمة مرتجعات البيع النشطة.", formula: "Σ قيمة المرتجع حيث الحالة = نشط" },
    { key: "paidOut", label: "اترد للعميل فلوس", icon: <ArrowUpCircle />, tone: "destructive", countWord: "مرتجع", meaning: "ما رُدّ للعملاء نقدًا أو تحويلًا من الخزينة.", formula: "Σ (الجزء النقدي + الجزء المحوّل) للمرتجعات النشطة" },
    { key: "credit", label: "اتخصم من حساب العميل (بدون فلوس)", icon: <Wallet />, tone: "warning", countWord: "مرتجع", meaning: "ما أُضيف لرصيد العميل بدل رده نقدًا — لا يحرك الخزينة.", formula: "Σ الجزء المضاف للرصيد للمرتجعات النشطة" },
  ],
  purchase_return: [
    { key: "active", label: "إجمالي المرتجع", icon: <TrendingUp />, tone: "primary", countWord: "مرتجع نشط", meaning: "قيمة مرتجعات الشراء النشطة.", formula: "Σ قيمة المرتجع حيث الحالة = نشط" },
    { key: "refunded", label: "رجع لنا فلوس من المورد", icon: <ArrowDownCircle />, tone: "success", countWord: "مرتجع", meaning: "ما استرده الفرع من الموردين نقدًا أو تحويلًا.", formula: "Σ (الجزء النقدي + الجزء المحوّل) للمرتجعات النشطة" },
    { key: "deducted", label: "اتخصم من حساب المورد (بدون فلوس)", icon: <Scale />, tone: "warning", countWord: "مرتجع", meaning: "ما خُصم من حساب المورد بدل استرداده نقدًا — لا يحرك الخزينة.", formula: "Σ الجزء المخصوم من الرصيد للمرتجعات النشطة" },
  ],
  income: [
    { key: "active", label: "إجمالي حركة سندات القبض", icon: <TrendingUp />, tone: "success", countWord: "سند نشط", meaning: "قيمة سندات القبض النشطة.", formula: "Σ المبلغ حيث الحالة = نشط" },
    { key: "customers", label: "قبض من العملاء", icon: <Users />, tone: "primary", countWord: "سند", meaning: "سندات القبض اللي فلوسها من عملاء: سند على عميل، تحصيل من ملف العميل أو قسط، مبيعات نقدية، إيداع تحت الحساب — حتى لو السند اتعمل تلقائي من الخزنة.", formula: "Σ المبلغ حيث تصنيف الفلوس = عميل" },
    { key: "otherIncome", label: "قبض تاني (إيرادات وتحويلات)", icon: <Receipt />, tone: "warning", countWord: "سند", meaning: "باقي سندات القبض: إيرادات أخرى وتحويلات داخلة ومرتجعات من موردين.", formula: "إجمالي المقبوضات − مقبوض من عملاء" },
  ],
  expense: [
    { key: "active", label: "إجمالي حركة سندات الصرف", icon: <TrendingUp />, tone: "destructive", countWord: "سند نشط", meaning: "قيمة سندات الصرف النشطة.", formula: "Σ المبلغ حيث الحالة = نشط" },
    { key: "suppliers", label: "اتدفع للموردين", icon: <Truck />, tone: "primary", countWord: "سند", meaning: "سندات الصرف اللي فلوسها لموردين: سند على مورد، سداد من ملف المورد، أقساط خطط الشراء، الدفع عند الشراء.", formula: "Σ المبلغ حيث تصنيف الفلوس = مورد" },
    { key: "operating", label: "مصاريف تشغيل فعلية", icon: <Receipt />, tone: "destructive", countWord: "سند", meaning: "المصاريف التشغيلية والإدارية الفعلية فقط (إيجارات، مرتبات، كهرباء، صيانة، ضيافة...).", formula: "إجمالي المدفوعات − سداد موردين − تحويلات داخلية ومرتجع وسلف" },
    { key: "internal", label: "تحويلات وسلف ومرتجعات (مش مصاريف)", icon: <ArrowUpCircle />, tone: "warning", countWord: "سند", meaning: "تحويلات بين الخزن/الفروع، مرتجعات ومدفوعات للعملاء، وسلف الموظفين (ذمة تُسترد) — خرجت من الخزينة لكنها ليست مصروفًا تشغيليًا.", formula: "Σ المبلغ حيث التصنيف = مرتجع عميل أو تحويل (خزينة/فرع) أو سلف موظفين، أو الطرف = عميل" },
  ],
};

const BUCKET_DEFS: { key: CollectionBucket; label: string; icon: ReactNode; where: string }[] = [
  { key: "cash", label: "كاش (درج الخزنة)", icon: <Banknote />, where: "درج خزنة الفرع النقدية — رصيد الخزنة بيتحرك فوراً" },
  { key: "instapay", label: "انستاباي", icon: <CreditCard />, where: "الحساب البنكي المربوط بانستاباي المختار في المستند — مش في درج الكاش" },
  { key: "wallet", label: "محفظة (فودافون كاش وغيرها)", icon: <Smartphone />, where: "المحفظة المختارة في المستند (فودافون كاش وغيرها) — مش في درج الكاش" },
  { key: "bank", label: "تحويل / إيداع بنكي", icon: <Landmark />, where: "الحساب البنكي المختار في المستند — مش في درج الكاش" },
  { key: "other", label: "خصم من الرصيد (من غير فلوس)", icon: <Scale />, where: "مفيش فلوس اتحركت: اتخصم من رصيد/مقدم الطرف عندنا" },
];
/** Vouchers always move a real treasury, so they have no prepaid-balance bucket. */
const BUCKETS_FOR: Record<DocKind, CollectionBucket[]> = {
  sale: ["cash", "instapay", "wallet", "bank", "other"],
  purchase: ["cash", "instapay", "wallet", "bank", "other"],
  // the top card «اتخصم من حساب العميل/المورد» already shows the non-cash part — no duplicate box under it
  sale_return: ["cash", "instapay", "wallet", "bank"],
  purchase_return: ["cash", "instapay", "wallet", "bank"],
  income: ["cash", "instapay", "wallet", "bank"],
  expense: ["cash", "instapay", "wallet", "bank"],
};
const BUCKET_TITLE: Record<DocKind, string> = {
  sale: "الفلوس اللي دخلت الفرع من العملاء في الفترة — حسب مكان استلامها (تشمل تحصيل مديونيات قديمة ومقدمات، مش بس الفواتير المعروضة)",
  purchase: "الفلوس اللي خرجت من الفرع للموردين في الفترة — حسب المكان اللي اتدفعت منه (تشمل سداد مديونيات قديمة ومقدمات)",
  sale_return: "رد قيمة المرتجعات — حسب المكان اللي خرجت منه الفلوس",
  purchase_return: "استرداد قيمة مرتجعات الشراء — حسب المكان اللي دخلت فيه الفلوس",
  income: "حركة سندات القبض — الفلوس دخلت فين بالظبط (كاش ولا انستاباي ولا محفظة ولا بنك)",
  expense: "حركة سندات الصرف — الفلوس خرجت منين بالظبط (كاش ولا انستاباي ولا محفظة ولا بنك)",
};
const BUCKET_VERB: Record<DocKind, string> = {
  sale: "دخل من العملاء", purchase: "اتدفع للموردين", sale_return: "اترد للعملاء", purchase_return: "رجع من الموردين", income: "اتقبض", expense: "اتصرف",
};

interface Props { kind: DocKind; metrics: DocMetrics | null; loading: boolean; selected: DocCardKey | null; onSelect: (k: DocCardKey | null) => void; view?: "active" | "cancelled" }

const moneyIn = (m: DocMetrics | null) => m ? (m.byBucket.cash ?? 0) + (m.byBucket.instapay ?? 0) + (m.byBucket.wallet ?? 0) + (m.byBucket.bank ?? 0) : 0;

/** Click-to-filter accounting cards whose meaning adapts to the document type. Cancelled documents have their own tab. */
export function UnifiedDocumentMetrics({ kind, metrics, loading, selected, onSelect, view = "active" }: Props) {
  const source = SOURCE[kind];
  const sel = (key: string, filterable = true) => filterable ? { active: selected === key, onClick: () => onSelect(selected === key ? null : key) } : {};
  const buckets = BUCKETS_FOR[kind];
  const verb = BUCKET_VERB[kind];

  if (view === "cancelled") {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        <MetricCardWithHint label="قيمة المستندات الملغاة" value={metrics?.values.cancelled ?? 0} icon={<XCircle />} tone="destructive"
          footer={<span className="tabular-nums">{(metrics?.counts.cancelled ?? 0).toLocaleString("en-US")} مستند ملغي</span>}
          metricHint={{ meaning: "المستندات الملغاة بس. أثرها على المخزون والخزنة والحسابات اتعكس بالكامل وقت الإلغاء، ومش داخلة في أي رقم تاني في السيستم.", source, formula: "Σ قيمة المستند حيث الحالة = ملغي" }} />
      </div>
    );
  }

  const top = TOP[kind];
  const extra: CardDef | null = kind === "sale"
    ? { key: "__moneyIn", label: "إجمالي الفلوس اللي دخلت من العملاء", icon: <Wallet />, tone: "success", filterable: false, value: moneyIn,
        meaning: "كل الفلوس اللي دخلت الفرع فعلاً من العملاء في الفترة (نقدي + بنكي + محفظة + انستاباي)، سواء على فواتير الفترة أو تحصيل مديونية قديمة أو مقدم. عشان كده ممكن تكون أكبر من «المحصّل من الفواتير دي».",
        formula: "Σ (فلوس داخلة − فلوس مردودة) من الدفتر الموحد لحساب العملاء، في الفرع والفترة" }
    : kind === "purchase"
    ? { key: "__moneyOut", label: "إجمالي الفلوس اللي اتدفعت للموردين", icon: <Wallet />, tone: "destructive", filterable: false, value: moneyIn,
        meaning: "كل الفلوس اللي خرجت من الفرع للموردين في الفترة، سواء على فواتير الفترة أو سداد مديونية قديمة أو مقدم.",
        formula: "Σ (فلوس خارجة − فلوس مستردة) من الدفتر الموحد لحساب الموردين، في الفرع والفترة" }
    : null;
  const cards = extra ? [...top, extra] : top;
  return (
    <div className={`space-y-3 mb-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className={`grid grid-cols-2 gap-3 ${cards.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {cards.map((c) => {
          const sp = c.split ? metrics?.split?.[c.split] : undefined;
          const value = sp ? sp.total : c.value ? (metrics ? c.value(metrics) : 0) : (metrics?.values[c.key] ?? 0);
          const count = sp ? sp.count : metrics?.counts[c.key];
          const countLine = c.countWord && count !== undefined ? <span className="tabular-nums">{count.toLocaleString("en-US")} {c.countWord}</span> : undefined;
          return (
            <MetricCardWithHint key={c.key} label={c.label} value={value} icon={c.icon} tone={c.tone} {...sel(c.key, c.filterable !== false)}
              footer={c.split ? <SplitLines kind={kind} split={sp} side={c.split} countLine={countLine} /> : countLine}
              metricHint={{ meaning: c.meaning, source, formula: c.formula }} />
          );
        })}
      </div>
      <div className="text-xs font-semibold text-muted-foreground pt-1">{BUCKET_TITLE[kind]}</div>
      <div className={`grid grid-cols-2 gap-3 ${buckets.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {BUCKET_DEFS.filter((b) => buckets.includes(b.key)).map((b) => (
          <MetricCardWithHint key={b.key} label={b.key === "other" ? b.label : `${verb} ${b.label}`} value={metrics?.byBucket[b.key] ?? 0} icon={b.icon} tone={b.key === "other" ? "warning" : "success"}
            {...sel(b.key, kind !== "purchase" && kind !== "sale")}
            metricHint={{
              meaning: `${verb} عن طريق «${b.label}». المكان: ${b.where}.`,
              source,
              formula: `Σ مبالغ «${b.label}» للمستندات النشطة`,
            }} />
        ))}
      </div>
    </div>
  );
}

const SPLIT_METHODS: { key: "cash" | "instapay" | "wallet" | "bank" | "other"; label: string }[] = [
  { key: "cash", label: "كاش" }, { key: "instapay", label: "انستاباي" }, { key: "wallet", label: "محفظة" },
  { key: "bank", label: "تحويل بنكي" }, { key: "other", label: "رصيد مرتجعات (مش فلوس)" },
];

/** Under «نقدي» / «آجل»: how the money of those documents came, and (آجل) what is still open. */
function SplitLines({ kind, split, side, countLine }: { kind: DocKind; split?: import("@/hooks/useDocumentMetrics").PaySplit; side: "cash" | "credit"; countLine?: ReactNode }) {
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const rows = SPLIT_METHODS.filter((m) => m.key !== "other" || (split?.byBucket.other ?? 0) > 0.01);
  return (
    <div className="space-y-1">
      {countLine}
      <div className="mt-1 border-t border-border/60 pt-1 space-y-0.5">
        {rows.map((m) => (
          <div key={m.key} className="flex justify-between gap-2"><span>{m.label}</span><span className="tabular-nums font-semibold text-foreground">{fmt(split?.byBucket[m.key] ?? 0)}</span></div>
        ))}
        {side === "credit" && (
          <div className="flex justify-between gap-2 border-t border-border/60 pt-0.5">
            <span>{kind === "sale" ? "الباقي على العملاء" : "الباقي للموردين"}</span>
            <span className="tabular-nums font-bold text-warning">{fmt(split?.remaining ?? 0)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
