import {
  LayoutDashboard,
  Compass,
  ReceiptText,
  Truck,
  Undo2,
  Wallet,
  Landmark,
  CreditCard,
  Users,
  ClipboardList,
  BarChart3,
  Settings,
  Package,
  ArrowLeftRight,
  UserSquare2,
  CalendarClock,
  ShieldCheck,
  Sparkles,
  Paperclip,
  PiggyBank,
} from "lucide-react";

export type GuideStep = {
  title: string;
  desc: string;
  /** Deep link builder — branchId متاح لو اليوزر مربوط بفرع */
  to?: (branchId?: string | null) => string | null;
  /** مفتاح صلاحية الخطوة (اختياري) */
  perm?: string;
  /** نصايح سريعة تظهر تحت الشرح */
  tips?: string[];
};

export type GuideSection = {
  key: string;
  title: string;
  hint: string;
  icon: typeof LayoutDashboard;
  /** الصلاحية اللي لازم اليوزر يملكها عشان يشوف القسم (أي واحدة منهم) */
  anyPerm?: string[];
  steps: GuideStep[];
};

const b = (path: string) => (branchId?: string | null) => (branchId ? `/branch/${branchId}${path}` : null);
const a = (path: string) => () => path;

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    key: "basics",
    title: "أول يوم ليك على النظام",
    hint: "أهم 4 حاجات تعرفها قبل ما تبدأ",
    icon: Sparkles,
    steps: [
      {
        title: "النظام بيشتغل إزاي؟",
        desc: "كل حاجة في النظام مربوطة بفرع وبخزنة. أي فاتورة بتعملها بتحرّك 3 حاجات مع بعض: المخزون، الخزنة، وحساب العميل أو المورد. عشان كده مفيش رقم بيتغير لوحده.",
      },
      {
        title: "إنت شايف إيه بالظبط؟",
        desc: "الشاشات اللي في القايمة عندك مش نفس اللي عند زميلك — المالك هو اللي بيحدد كل دور يفتح إيه. لو محتاج شاشة مش ظاهرة، اطلبها من المالك وهتظهرلك على طول من غير ما تعمل تسجيل خروج.",
        to: a("/profile"),
      },
      {
        title: "الدليل ده بيتغير معاك",
        desc: "الأقسام اللي تحت دي متفلترة على صلاحياتك إنت. أول ما المالك يزوّد أو يقلّل صلاحياتك، الأقسام هنا بتزيد أو تقل لحظيًا.",
      },
      {
        title: "لو غلطت؟",
        desc: "مفيش حاجة بتتمسح خالص. الإلغاء والتعديل بيتسجلوا في سجل العمليات، وبعض الحاجات محتاجة موافقة الأدمن قبل ما تتنفذ.",
      },
    ],
  },
  {
    key: "dashboard",
    title: "الشاشة الرئيسية",
    hint: "تقرا الأرقام اللي قدامك إزاي",
    icon: LayoutDashboard,
    anyPerm: ["dashboard.view", "admin_home.view"],
    steps: [
      {
        title: "الكروت اللي فوق",
        desc: "دي ملخص يومك: مبيعات النهاردة، عدد الفواتير، رصيد الخزنة، والمتأخرات. الرقم الكبير هو القيمة، والسطر الصغير تحته بيقارنها بالفترة اللي فاتت.",
        to: b("/dashboard"),
        perm: "dashboard.view",
      },
      {
        title: "آخر 5 حركات",
        desc: "بتوريلك آخر الفواتير والشحنات اللي اتعملت في السيستم كله (بيع وشرا). دوس على أي سطر يوديك على المستند نفسه على طول.",
        to: b("/dashboard"),
        perm: "dashboard.view",
      },
      {
        title: "التنبيهات",
        desc: "لو ظهرلك شريط أحمر أو أصفر فوق، ده معناه في حاجة محتاجة تدخل منك: شيفت مفتوح، جرد متأخر، أو فاتورة مستحقة. اضغط عليه يوديك للشاشة المطلوبة.",
      },
      {
        title: "لوحة الإدارة",
        desc: "لو معاك صلاحية إدارة، فيه لوحة تانية بتجمّع كل الفروع في مكان واحد: مبيعات كل فرع، ملخص الخزائن، والربحية.",
        to: a("/admin"),
        perm: "admin_home.view",
      },
      {
        title: "لوحة المالك",
        desc: "شاشة مختصرة جدًا للمالك: كاش داخل وخارج، صافي الربح، وأهم الانحرافات في الفترة.",
        to: a("/admin/reports-hub?tab=owner"),
        perm: "admin_cockpit.view",
      },
    ],
  },
  {
    key: "navigation",
    title: "التنقل الأساسي",
    hint: "القوايم، تبديل الفروع، وصلاحيتك",
    icon: Compass,
    steps: [
      {
        title: "القايمة الجانبية",
        desc: "كل الشاشات على يمين الشاشة مقسمة مجموعات. على الموبايل دوس على أيقونة الخطوط الـ3 فوق عشان تفتحها. وقت ما تفتح فاتورة جديدة القايمة بتتقفل لوحدها عشان تاخد مساحة أوسع.",
      },
      {
        title: "تبديل الفرع",
        desc: "لو مربوط بأكتر من فرع، من الشاشة الرئيسية للإدارة اختار الفرع اللي عايز تشتغل عليه — كل الأرقام بعدها بتخص الفرع ده لوحده.",
      },
      {
        title: "البحث السريع",
        desc: "في أغلب الشاشات فيه خانة بحث فوق — تقدر تكتب اسم عميل، رقم فاتورة، أو كود منتج وتوصل على طول.",
      },
      {
        title: "الجرس والإشعارات",
        desc: "جرس فوق في الهيدر بيجيبلك الطلبات المستنية موافقتك، تنبيهات المخزون، والفواتير المستحقة.",
      },
      {
        title: "إنت داخل بإيه؟",
        desc: "اسمك ودورك (كاشير / مدير فرع / محاسب…) ظاهرين تحت في القايمة. الدور ده هو اللي بيحدد الشاشات اللي تشوفها. من صفحتك تقدر تغيّر باسوردك وبياناتك.",
        to: a("/profile"),
      },
    ],
  },
  {
    key: "products",
    title: "المنتجات والأصناف",
    hint: "تضيف صنف وتظبط سعره وصورته",
    icon: Package,
    anyPerm: ["inventory.view", "admin_catalog.view", "admin_product_attributes.view"],
    steps: [
      {
        title: "ضيف صنف جديد",
        desc: "من المخزون → إضافة صنف. اكتب الاسم والكود (SKU) وسعر الشرا وسعر البيع، وتقدر ترفع صورة وهي بتتضغط لوحدها عشان متتقلش على النظام.",
        to: b("/inventory"),
        perm: "inventory.create",
      },
      {
        title: "الخصائص (ماركة، موديل، مقاس، لون)",
        desc: "الأصناف ممكن يكون ليها خصائص. ظبّط القوائم دي مرة واحدة من شاشة خصائص المنتجات وبعدين اختار منها وقت إضافة الصنف.",
        to: a("/admin/product-attributes"),
        perm: "admin_product_attributes.view",
      },
      {
        title: "التصنيفات",
        desc: "قسّم أصنافك تصنيفات (مثلًا: أجهزة، إكسسوار) عشان التقارير تطلعلك مفصّلة ومفيدة.",
        to: a("/admin/catalog?tab=categories"),
        perm: "admin_catalog.view",
      },
      {
        title: "قائمة الأسعار",
        desc: "شاشة واحدة تشوف فيها أسعار كل الأصناف وتعدّل عليها. تقدر تعمل دبل كليك على اسم الشركة تغيّره، أو تزوّد/تقلل أسعار مجموعة كاملة بنسبة مرة واحدة.",
        to: a("/admin/price-list"),
        perm: "admin_catalog.view",
      },
      {
        title: "طباعة الباركود",
        desc: "اختار الأصناف واطبع لها ملصقات باركود بمقاسات مختلفة عشان تسهّل البيع بالماسح.",
        to: b("/print-barcodes"),
        perm: "inventory.view",
      },
    ],
  },
  {
    key: "contacts",
    title: "العملاء والموردين",
    hint: "تضيفهم وتتابع اللي ليهم واللي عليهم",
    icon: UserSquare2,
    anyPerm: ["customers.view", "suppliers.view", "admin_contacts.view"],
    steps: [
      {
        title: "إضافة عميل أو مورد",
        desc: "من جهات التواصل ضيف الاسم والموبايل والعنوان. وتقدر كمان تضيفه بسرعة وإنت جوه الفاتورة من زرار (+) جنب خانة الاختيار.",
        to: b("/contacts"),
        perm: "customers.view",
      },
      {
        title: "كشف حساب",
        desc: "افتح أي عميل أو مورد وهتلاقي كل فواتيره ودفعاته بالتاريخ، والرصيد النهائي: ليه ولا عليه.",
        to: b("/contacts"),
        perm: "customers.view",
      },
      {
        title: "ملف المورد",
        desc: "فيه تبويب خاص بالخصومات: إجمالي اللي وفّرته معاه، نسبته من مشترياتك، وآخر خصم كان إمتى.",
        to: b("/contacts?type=supplier"),
        perm: "suppliers.view",
      },
      {
        title: "المتأخرات",
        desc: "شاشة ذمم العملاء والموردين بتوريلك المستحق مقسّم بالعمر (أقل من 30 يوم، 60، 90…) عشان تعرف تلاحق مين الأول.",
        to: a("/admin/receivables"),
        perm: "admin_finance_receivables.view",
      },
    ],
  },
  {
    key: "sales",
    title: "فاتورة البيع",
    hint: "تعمل فاتورة بيع وتعدّل عليها",
    icon: ReceiptText,
    anyPerm: ["sales.view", "sales.create"],
    steps: [
      {
        title: "افتح فاتورة جديدة",
        desc: "من المبيعات → فاتورة بيع جديدة. الصفحة مقسمة أقسام قابلة للطي: بيانات العميل، الأصناف، طريقة الدفع، والملخص.",
        to: b("/sales/new"),
        perm: "sales.create",
      },
      {
        title: "اختار العميل",
        desc: "دوّر على العميل بالاسم أو الموبايل، ولو جديد دوس على زرار الإضافة السريعة جنب الخانة. وتحت الاسم على طول هتلاقي تاريخ الفاتورة.",
        perm: "sales.create",
      },
      {
        title: "ضيف الأصناف",
        desc: "اكتب اسم المنتج أو الكود أو امسح الباركود، اختار الصنف، حدد الكمية والسعر. تقدر تحط خصم على الصنف بالجنيه أو بالنسبة، والسيستم بيمنعك لو الكمية مش متاحة.",
        perm: "sales.create",
      },
      {
        title: "الدفع والخصم النهائي",
        desc: "اختار نقدي / محفظة / انستاباي / تحويل بنكي أو أجل — وتقدر تقسّم المبلغ على أكتر من وسيلة. وفيه خصم على إجمالي الفاتورة قبل ما تحفظ.",
        perm: "sales.create",
      },
      {
        title: "حد الخصم والموافقات",
        desc: "لو الخصم أكبر من المسموح لدورك، السيستم هيبعت طلب موافقة للأدمن والفاتورة تستنى لحد ما تتوافق.",
        perm: "sales.create",
      },
      {
        title: "الطباعة",
        desc: "بعد الحفظ تقدر تطبع فاتورة A4 أو إيصال حراري صغير من نفس شاشة الفاتورة.",
        perm: "sales.view",
      },
      {
        title: "سجل المبيعات",
        desc: "كل فواتيرك بالتاريخ والعميل والحالة (مدفوعة/جزئي/آجل). دوس على السطر يفتحلك الفاتورة على طول.",
        to: b("/sales-history"),
        perm: "sales.view",
      },
      {
        title: "تعديل فاتورة موجودة",
        desc: "افتح الفاتورة ودوس تعديل — نفس شاشة الإنشاء بس مليانة ببياناتها. بعد الحفظ هتشوف كشف بالتعديلات اللي حصلت بالظبط.",
        to: b("/sales-history"),
        perm: "sales.update",
      },
      {
        title: "إلغاء فاتورة",
        desc: "الإلغاء بيرجّع المخزون ويعكس الحركة المالية. حسب الإعدادات ممكن يحتاج موافقة الأدمن قبل ما ينفذ.",
        perm: "sales.delete",
      },
    ],
  },
  {
    key: "quotes_preorders",
    title: "عروض الأسعار والحجوزات",
    hint: "قبل ما الفاتورة تتعمل",
    icon: CalendarClock,
    anyPerm: ["sales.create", "preorders.view"],
    steps: [
      {
        title: "عرض سعر",
        desc: "لو العميل لسه بيسأل، اعملّه عرض سعر بالأصناف والأسعار — والمخزون مش بيتأثر. وقت ما يوافق تحوّله لفاتورة بضغطة.",
        to: b("/quotes/new"),
        perm: "sales.create",
      },
      {
        title: "طلب حجز (Pre-order)",
        desc: "لو الصنف مش موجود دلوقتي، اعمل حجز بعربون. الحجز بيحجز الكمية لما توصل، والعربون بيتسجل في الخزنة.",
        to: b("/pre-orders"),
        perm: "preorders.view",
      },
      {
        title: "استلام وإقفال الحجز",
        desc: "أول ما البضاعة تيجي، افتح الحجز واعمله إتمام بيع — الفرق بين العربون والإجمالي بيتحصّل ساعتها.",
        to: b("/pre-orders"),
        perm: "preorders.update",
      },
    ],
  },
  {
    key: "purchases",
    title: "فاتورة الشراء (الشحنات)",
    hint: "تسجّل شحنة من مورد وتعدّل عليها",
    icon: Truck,
    anyPerm: ["shipments.view", "shipments.create"],
    steps: [
      {
        title: "شحنة جديدة",
        desc: "من الشحنات → شحنة جديدة. اختار المورد، وضيف الأصناف بالكميات وسعر الشراء. كل ما تبدأ صنف جديد اللي قبله بيتطوي لوحده.",
        to: b("/shipments/new"),
        perm: "shipments.create",
      },
      {
        title: "المصاريف والخصم",
        desc: "ضيف الشحن والجمارك ومصاريف إضافية، وتقدر تحط خصم على الفاتورة كلها بالجنيه أو بالنسبة — السيستم بيوزعه على تكلفة القطعة بالتناسب ويوريك السعر قبل وبعد الخصم.",
        perm: "shipments.create",
      },
      {
        title: "الدفع للمورد",
        desc: "حدد المدفوع دلوقتي والباقي أجل. لو الخزنة مفيهاش فلوس السيستم هيمنعك من الدفع النقدي ويقولك المتاح كام، ويسيبلك خيار الآجل.",
        perm: "shipments.create",
      },
      {
        title: "تعديل الشحنة والدفعات",
        desc: "افتح الشحنة ودوس تعديل للأصناف والتكاليف. أما الدفعات فبتتحفظ لحظيًا من قسم المدفوعات جوه صفحة الشحنة — مش مستنية زرار الحفظ.",
        to: b("/shipments"),
        perm: "shipments.update",
      },
      {
        title: "تكلفة القطعة الحقيقية",
        desc: "في صفحة الشحنة هتلاقي لكل صنف: السعر قبل الخصم ← نصيبه من الخصم ← السعر بعده ← نصيبه من الشحن ← التكلفة الحقيقية. الرقم الأخير ده هو اللي التقارير بتحسب عليه الربح.",
        to: b("/shipments"),
        perm: "shipments.view",
      },
    ],
  },
  {
    key: "returns",
    title: "المرتجعات",
    hint: "مرتجع بيع ومرتجع شراء",
    icon: Undo2,
    anyPerm: ["sales.create", "shipments.create", "invoices.view"],
    steps: [
      {
        title: "مرتجع بيع",
        desc: "من الفواتير → مرتجع بيع جديد. اختار فاتورة العميل وحدد الأصناف الراجعة والكميات، والسيستم بيرجّع المخزون ويظبط الفلوس أو رصيد العميل.",
        to: b("/sale-returns/new"),
        perm: "sales.create",
      },
      {
        title: "مرتجع شراء",
        desc: "نفس الفكرة بس مع المورد: اختار الشحنة، حدد اللي راجع، والرصيد بيتظبط على حساب المورد.",
        to: b("/purchase-returns/new"),
        perm: "shipments.create",
      },
      {
        title: "مدة السماح",
        desc: "لو عدّت المدة المسموحة للمرتجع (بتتظبط من الإعدادات)، السيستم بيطلب موافقة الأدمن وبيتسجل في تقرير تجاوزات المرتجعات.",
        perm: "invoices.view",
      },
      {
        title: "متابعة المرتجعات",
        desc: "كل المرتجعات موجودة في قايمة الفواتير مع نوع المستند، ومنها تفتح أي مرتجع وتشوف تفاصيله أو تلغيه.",
        to: b("/invoices"),
        perm: "invoices.view",
      },
    ],
  },
  {
    key: "transfers",
    title: "التحويلات بين الفروع",
    hint: "بضاعة وفلوس بين فرع وفرع",
    icon: ArrowLeftRight,
    anyPerm: ["transfers.view", "treasury.view"],
    steps: [
      {
        title: "نقل مخزون",
        desc: "اختار الفرع المستقبل والأصناف والكميات. البضاعة بتخرج من فرعك وتفضل معلّقة لحد ما الفرع التاني يستلم.",
        to: b("/stock-transfers"),
        perm: "transfers.create",
      },
      {
        title: "تأكيد الاستلام",
        desc: "الفرع المستقبل لازم يأكد الاستلام عشان الكمية تدخل مخزونه — ولو في فرق بيتسجل.",
        to: b("/stock-transfers"),
        perm: "transfers.view",
      },
      {
        title: "تحويل فلوس",
        desc: "من الخزنة تقدر تحوّل مبلغ لفرع تاني أو للخزنة الرئيسية، والطرف التاني بيأكد الاستلام.",
        to: b("/treasury"),
        perm: "treasury.view",
      },
    ],
  },
  {
    key: "finance",
    title: "الذمة المالية والسندات",
    hint: "سند قبض/صرف وذمة العملاء والموردين",
    icon: Wallet,
    anyPerm: ["receipt_vouchers.view", "payment_vouchers.view", "treasury.view", "admin_finance.view"],
    steps: [
      {
        title: "سند قبض",
        desc: "لما تستلم فلوس من عميل من غير فاتورة، سجّلها سند قبض — بيزوّد الخزنة ويقلّل مديونية العميل.",
        to: b("/receipt-vouchers"),
        perm: "receipt_vouchers.view",
      },
      {
        title: "سند صرف",
        desc: "أي فلوس بتخرج (دفعة لمورد، مصاريف، سلفة) تتسجل سند صرف، وتقدر تربطها بتصنيف مصروف عشان التقارير.",
        to: b("/payment-vouchers"),
        perm: "payment_vouchers.view",
      },
      {
        title: "مرفقات السند",
        desc: "ارفق صورة الإيصال أو التحويل مع السند عشان يبقى عندك إثبات وقت المراجعة.",
        perm: "attachments.create",
      },
      {
        title: "السندات المركزية",
        desc: "كل سندات كل الفروع في شاشة واحدة مع فلترة بالنوع والتاريخ والفرع.",
        to: a("/admin/vouchers"),
        perm: "admin_finance_vouchers.view",
      },
      {
        title: "ذمة الشركاء",
        desc: "رأس مال كل شريك، مسحوباته، سلفه، ونصيبه من الأرباح — كله في شاشة الذمة المالية للشركاء.",
        to: a("/admin/financial-position"),
        perm: "admin_financial_position.view",
      },
    ],
  },
  {
    key: "accounting",
    title: "المحاسبة والقيود",
    hint: "دليل الحسابات والقوايم المالية",
    icon: PiggyBank,
    anyPerm: ["admin_finance.view", "admin_reports_hub.view"],
    steps: [
      {
        title: "دليل الحسابات",
        desc: "كل حساب في النظام (أصول، خصوم، حقوق ملكية، إيرادات، مصروفات) بكوده. أي فاتورة بتعملها بتتحوّل لقيد على الحسابات دي أوتوماتيك.",
        to: a("/admin/chart-of-accounts"),
        perm: "admin_finance.view",
      },
      {
        title: "القيود اليومية",
        desc: "تقدر تشوف القيد الناتج عن أي مستند، أو تعمل قيد يدوي لحاجة استثنائية — والقيد لازم يكون متوازن (مدين = دائن).",
        to: a("/admin/journal-entries"),
        perm: "admin_finance.view",
      },
      {
        title: "ميزان المراجعة وقائمة الدخل",
        desc: "ميزان المراجعة بيوريك أرصدة كل الحسابات، وقائمة الدخل بتحسب صافي الربح للفترة، والميزانية بتوريلك المركز المالي.",
        to: a("/admin/trial-balance"),
        perm: "admin_finance.view",
      },
      {
        title: "إقفال الفترة",
        desc: "بعد ما تراجع الشهر، اقفله عشان محدش يعدّل فيه بأثر رجعي. أي محاولة تعديل بعد الإقفال هيرفضها النظام.",
        to: a("/admin/fiscal-closing"),
        perm: "admin_finance.view",
      },
    ],
  },
  {
    key: "treasury_inventory",
    title: "الخزنة والمخزون",
    hint: "رصيد كل فرع لوحده",
    icon: Landmark,
    anyPerm: ["treasury.view", "inventory.view"],
    steps: [
      {
        title: "رصيد الخزنة",
        desc: "شاشة الخزنة بتوريلك رصيد الفرع الحالي وكل حركة دخل وخرج منه بالتاريخ والمصدر.",
        to: b("/treasury"),
        perm: "treasury.view",
      },
      {
        title: "ملخص الخزائن",
        desc: "شاشة عرض بس: بتجمّع أرصدة كل الخزائن الحقيقية (الفروع + خزينة الشركاء) في مكان واحد. التحويل الفعلي بيتم من خزنة الفرع أو خزينة الشركاء.",
        to: a("/admin/main-treasury"),
        perm: "admin_main_treasury.view",
      },
      {
        title: "مخزون الفرع",
        desc: "شاشة المخزون بتعرض أصناف الفرع ده بس، بالكمية المتاحة وسعر البيع وصورة المنتج، مع تنبيه للأصناف اللي قربت تخلص.",
        to: b("/inventory"),
        perm: "inventory.view",
      },
      {
        title: "حركة الصنف",
        desc: "تقرير حركة المخزون بيوريلك لكل صنف: دخل منين وخرج فين وبكام، عشان تتأكد من أي فرق.",
        to: b("/stock-movements"),
        perm: "inventory.view",
      },
      {
        title: "تسوية مخزون",
        desc: "لو في تالف أو فرق بسيط، اعمل تسوية بسبب مكتوب — بتتسجل باسمك في سجل العمليات.",
        to: b("/stock-adjustments/new"),
        perm: "inventory.update",
      },
      {
        title: "مخزون كل الفروع",
        desc: "قارن مخزون الفروع كلها في شاشة واحدة، وتعرف الصنف موجود فين قبل ما تعد العميل.",
        to: a("/admin/catalog?tab=inventory"),
        perm: "admin_catalog.view",
      },
    ],
  },
  {
    key: "payments",
    title: "وسائل الدفع وخطط التقسيط",
    hint: "محفظة، نقدي، انستاباي، تحويل بنكي",
    icon: CreditCard,
    anyPerm: ["treasury.view", "sales.create", "admin_settings.view"],
    steps: [
      {
        title: "اختيار الوسيلة",
        desc: "وقت الفاتورة تقدر تقسّم المبلغ على أكتر من وسيلة: جزء كاش وجزء محفظة مثلًا، وكل جزء بيروح لمكانه الصح في الخزنة.",
        perm: "sales.create",
      },
      {
        title: "متابعة الفلوس",
        desc: "شاشة الخزنة بتفصّل الفلوس حسب الوسيلة، فتعرف كام كاش في الدرج وكام على المحفظة أو البنك.",
        to: b("/treasury"),
        perm: "treasury.view",
      },
      {
        title: "رسوم التحويل",
        desc: "لو في نسبة رسوم على المحفظة أو انستاباي، بتتظبط من الإعدادات والسيستم بيحسبها لوحده ويسجلها مصروف.",
        to: a("/admin/settings"),
        perm: "admin_settings.view",
      },
      {
        title: "خطة تقسيط",
        desc: "للفواتير الآجلة تقدر تعمل جدول أقساط بتواريخ، والسيستم بينبهك على المتأخر منها.",
        perm: "sales.create",
      },
    ],
  },
  {
    key: "employees",
    title: "الموظفين والشيفت",
    hint: "فتح وقفل الشيفت والحضور والسلف",
    icon: Users,
    anyPerm: ["employees.view", "attendance.view", "sales.create", "advances.view"],
    steps: [
      {
        title: "افتح الشيفت",
        desc: "قبل ما تبدأ بيع، افتح الشيفت وسجّل رصيد الدرج الافتتاحي. من غير شيفت مفتوح البيع النقدي بيتقفل.",
        to: b("/shifts/open"),
        perm: "sales.create",
      },
      {
        title: "اقفل الشيفت",
        desc: "آخر اليوم اقفل الشيفت واكتب اللي في الدرج فعليًا، والسيستم هيقارنه بالمفروض ويوريك الفرق (زيادة/عجز).",
        to: b("/shifts/close"),
        perm: "sales.create",
      },
      {
        title: "سجل الورديات",
        desc: "المدير يقدر يراجع كل الشيفتات القديمة والفروقات لكل كاشير.",
        to: a("/admin/shifts"),
        perm: "admin_shifts.view",
      },
      {
        title: "الحضور والانصراف",
        desc: "سجّل حضور وانصراف الموظفين، والسجل بيتحسب في المرتبات آخر الشهر.",
        to: b("/attendance"),
        perm: "attendance.view",
      },
      {
        title: "ملف الموظف",
        desc: "بياناته ومرتبه ومرفقاته (بطاقة، عقد) وسلفه كلها في ملف واحد. البيانات الحساسة دي مقفولة على غير المصرح لهم.",
        to: b("/employees"),
        perm: "employees.view",
      },
      {
        title: "السلف",
        desc: "الموظف بيطلب سلفة، مدير الفرع بيرشّح، والأدمن بيوافق ويصرف — والخصم بيتوزع على المرتبات.",
        to: b("/advance-requests"),
        perm: "advances.view",
      },
    ],
  },
  {
    key: "stocktake",
    title: "الجرد",
    hint: "تقارن النظام بالواقع",
    icon: ClipboardList,
    anyPerm: ["inventory.view"],
    steps: [
      {
        title: "ابدأ جلسة جرد",
        desc: "من الجرد → جلسة جديدة، السيستم بياخد صورة (snapshot) للمخزون في اللحظة دي عشان المقارنة تبقى عادلة.",
        to: b("/inventory-count/new"),
        perm: "inventory.view",
      },
      {
        title: "العد",
        desc: "افتح ورقة العد واكتب الكمية الفعلية لكل صنف — تقدر تستخدم الباركود عشان يبقى أسرع، وتقدر تقف وتكمل بعدين.",
        to: b("/inventory-count"),
        perm: "inventory.view",
      },
      {
        title: "المراجعة والاعتماد",
        desc: "هتشوف الفروقات (زيادة/عجز) بالقيمة قبل الاعتماد. بعد الاعتماد المخزون بيتظبط وبيتسجل قيد بالفرق.",
        to: b("/inventory-count"),
        perm: "inventory.update",
      },
      {
        title: "الجرد الدوري الإجباري",
        desc: "لو الإعدادات مفعّلة، السيستم بينبهك إن الفرع متأخر في الجرد وممكن يقفل بعض العمليات لحد ما تعمله.",
        perm: "inventory.view",
      },
    ],
  },
  {
    key: "attachments",
    title: "المرفقات والمستندات",
    hint: "صور الفواتير والإيصالات",
    icon: Paperclip,
    anyPerm: ["attachments.view"],
    steps: [
      {
        title: "ارفع مرفق",
        desc: "من أي فاتورة أو سند دوس على أيقونة المشبك وارفع صورة أو PDF — الصور بتتضغط لوحدها.",
        perm: "attachments.create",
      },
      {
        title: "مركز المرفقات",
        desc: "شاشة بتجمّع كل الملفات المرفوعة في السيستم بفلترة بالنوع والتاريخ، عشان تلاقي أي مستند بسرعة.",
        to: a("/attachments"),
        perm: "attachments.view",
      },
    ],
  },
  {
    key: "approvals",
    title: "الموافقات",
    hint: "إمتى المستند بيستنى موافقة",
    icon: ShieldCheck,
    anyPerm: ["admin_approvals.view", "sales.create", "invoices.update"],
    steps: [
      {
        title: "طلباتي",
        desc: "أي حاجة عملتها ومحتاجة موافقة (خصم زيادة، إلغاء فاتورة، تعديل دفعة) هتلاقيها هنا بحالتها.",
        to: b("/my-approval-requests"),
        perm: "sales.create",
      },
      {
        title: "مركز الموافقات",
        desc: "للأدمن: كل الطلبات المستنية في مكان واحد — خصومات، سلف، إلغاءات — توافق أو ترفض بسبب.",
        to: a("/admin/approvals"),
        perm: "admin_approvals.view",
      },
      {
        title: "طلبات الخصم",
        desc: "لو الكاشير طلب خصم أعلى من حده، الطلب بييجي هنا ومعاه تفاصيل الفاتورة عشان تقرر.",
        to: a("/admin/approvals?tab=discounts"),
        perm: "admin_approvals_discounts.view",
      },
    ],
  },
  {
    key: "reports",
    title: "التقارير",
    hint: "فين كل تقرير وإزاي تفلتره",
    icon: BarChart3,
    anyPerm: ["reports.view", "admin_reports_hub.view"],
    steps: [
      {
        title: "تقارير الفرع",
        desc: "شاشة التقارير في الفرع فيها المبيعات والأرباح وحركة المخزون للفرع ده بس.",
        to: b("/reports"),
        perm: "reports.view",
      },
      {
        title: "التقارير المركزية",
        desc: "كل التقارير مجمعة: عمليات، ربحية، مقارنة فترات، سجل عمليات، وسجل أسعار.",
        to: a("/admin/reports-hub"),
        perm: "admin_reports_hub.view",
      },
      {
        title: "الربحية",
        desc: "بتحسب الربح على تكلفة القطعة الحقيقية (بعد الخصم والشحن)، ومقسّمة بالصنف والتصنيف والفرع.",
        to: a("/admin/profitability"),
        perm: "admin_reports_profitability.view",
      },
      {
        title: "سجل العمليات",
        desc: "مين عمل إيه وإمتى: أي تعديل أو حذف أو تغيير سعر متسجل باسم صاحبه.",
        to: a("/admin/audit-log"),
        perm: "admin_reports_audit.view",
      },
      {
        title: "التقارير المجدولة",
        desc: "ظبّط تقرير يتبعتلك دوريًا من غير ما تفتح النظام.",
        to: a("/admin/scheduled-reports"),
        perm: "admin_reports_scheduled.view",
      },
      {
        title: "الفلترة والتصدير",
        desc: "فوق أي تقرير في فلتر بالتاريخ وبالفرع — غيّرهم وهتلاقي الأرقام اتحدثت على طول، وتقدر تصدّر Excel أو PDF.",
        perm: "reports.view",
      },
    ],
  },
  {
    key: "assistant",
    title: "اسألني (المساعد الذكي)",
    hint: "اسأل بالعربي وهو يجاوبك من داتاك",
    icon: Sparkles,
    anyPerm: ["admin_ask_me.view"],
    steps: [
      {
        title: "اسأل بالعامية",
        desc: "اكتب سؤالك زي ما هو: «مبيعات فرع المعادي الشهر ده كام؟» أو «مين أكتر عميل عليه فلوس؟» والمساعد بيقرأ من داتا شركتك ويجاوب.",
        to: a("/admin/ask-me"),
        perm: "admin_ask_me.view",
      },
      {
        title: "تحليل التقارير",
        desc: "جوه بعض التقارير فيه زرار تحليل ذكي بيلخصلك الأرقام ويقولك إيه اللي محتاج انتباه.",
        perm: "admin_insights.view",
      },
    ],
  },
  {
    key: "settings",
    title: "الإعدادات والصلاحيات",
    hint: "أهم حاجات تظبطها من البداية",
    icon: Settings,
    anyPerm: ["admin_settings.view", "admin_catalog.view"],
    steps: [
      {
        title: "بيانات الشركة",
        desc: "الاسم واللوجو والعنوان والتليفون — دول بيظهروا على الفواتير المطبوعة وفي التقارير.",
        to: a("/admin/settings"),
        perm: "admin_settings.view",
      },
      {
        title: "الفروع",
        desc: "ضيف فروعك ومواعيد شغلها ورأس المال المخصص لكل فرع.",
        to: a("/admin/catalog?tab=branches"),
        perm: "admin_catalog.view",
      },
      {
        title: "المستخدمين",
        desc: "ضيف الموظف واربطه بفروعه وحدد دوره من فورم واحدة، وتقدر تعمله إعادة تعيين باسورد.",
        to: a("/admin/employees"),
        perm: "admin_employees.view",
      },
      {
        title: "الصلاحيات",
        desc: "من الإعدادات تحدد كل دور يشوف إيه بالظبط، وتقدر تدي صلاحية إضافية ليوزر معيّن لوحده. التغيير بيوصله فورًا من غير ما يعمل خروج ودخول — وحتى صفحة الدليل دي بتتغير معاه.",
        to: a("/admin/settings?tab=permissions"),
        perm: "admin_settings.view",
      },
      {
        title: "سياسات الخصم والمرتجع",
        desc: "حدد أقصى خصم مسموح لكل دور ومدة السماح بالمرتجع، وأي تجاوز هيحتاج موافقة الأدمن.",
        to: a("/admin/settings"),
        perm: "admin_settings.view",
      },
      {
        title: "النسخ الاحتياطي وفحص السيستم",
        desc: "خد نسخة احتياطية من داتاك، وشغّل فحص السيستم اللي بيدوّر على أي أرقام غير منطقية أو حركات ناقصة.",
        to: a("/admin/system-health"),
        perm: "admin_system_health.view",
      },
    ],
  },
];
