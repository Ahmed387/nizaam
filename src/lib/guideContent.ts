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
} from "lucide-react";

export type GuideStep = {
  title: string;
  desc: string;
  /** Deep link builder — branchId متاح لو اليوزر مربوط بفرع */
  to?: (branchId?: string | null) => string | null;
  /** مفتاح صلاحية الخطوة (اختياري) */
  perm?: string;
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

export const GUIDE_SECTIONS: GuideSection[] = [
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
      },
      {
        title: "آخر 5 حركات",
        desc: "بتوريلك آخر الفواتير والشحنات اللي اتعملت. دوس على أي سطر يوديك على المستند نفسه على طول.",
        to: b("/dashboard"),
      },
      {
        title: "التنبيهات",
        desc: "لو ظهرلك شريط أحمر أو أصفر فوق، ده معناه في حاجة محتاجة تدخل منك: شيفت مفتوح، جرد متأخر، أو فاتورة مستحقة.",
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
        desc: "كل الشاشات على يمين الشاشة مقسمة مجموعات. على الموبايل دوس على أيقونة الخطوط الـ3 فوق عشان تفتحها.",
      },
      {
        title: "تبديل الفرع",
        desc: "لو مربوط بأكتر من فرع، من الشاشة الرئيسية للإدارة اختار الفرع اللي عايز تشتغل عليه — كل الأرقام بعدها بتخص الفرع ده لوحده.",
      },
      {
        title: "إنت داخل بإيه؟",
        desc: "اسمك ودورك (كاشير / مدير فرع / محاسب…) ظاهرين تحت في القايمة. الدور ده هو اللي بيحدد الشاشات اللي تشوفها.",
        to: () => "/profile",
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
        desc: "من المبيعات → فاتورة بيع جديدة. الصفحة مقسمة أقسام: بيانات العميل، الأصناف، طريقة الدفع، والملخص.",
        to: b("/sales/new"),
        perm: "sales.create",
      },
      {
        title: "اختار العميل",
        desc: "دوّر على العميل بالاسم أو الموبايل، ولو جديد دوس على زرار الإضافة السريعة جنب الخانة.",
      },
      {
        title: "ضيف الأصناف",
        desc: "اكتب اسم المنتج أو الكود، اختار الصنف، حدد الكمية والسعر. تقدر تحط خصم على الصنف بالجنيه أو بالنسبة.",
      },
      {
        title: "الدفع والخصم النهائي",
        desc: "اختار نقدي / محفظة / انستاباي / تحويل بنكي أو أجل، وتقدر تحط خصم على إجمالي الفاتورة قبل ما تحفظ.",
      },
      {
        title: "تعديل فاتورة موجودة",
        desc: "من سجل المبيعات افتح الفاتورة ودوس تعديل — نفس شاشة الإنشاء بس مليانة ببياناتها. بعد الحفظ هتشوف كشف بالتعديلات اللي حصلت بالظبط.",
        to: b("/sales-history"),
        perm: "sales.view",
      },
      {
        title: "التعديل المالي",
        desc: "تغيير المدفوعات أو طريقة الدفع بيتم من داخل الفاتورة نفسها من قسم المدفوعات، وأي تعديل بيتسجل في سجل العمليات.",
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
        desc: "من الشحنات → شحنة جديدة. اختار المورد، وضيف الأصناف بالكميات وسعر الشراء.",
        to: b("/shipments/new"),
        perm: "shipments.create",
      },
      {
        title: "المصاريف والخصم",
        desc: "ضيف الشحن والجمارك ومصاريف إضافية، وتقدر تحط خصم على الفاتورة كلها بالجنيه أو بالنسبة — السيستم بيوزعه على تكلفة القطعة.",
      },
      {
        title: "الدفع للمورد",
        desc: "حدد المدفوع دلوقتي والباقي أجل. لو الخزنة مفيهاش فلوس السيستم هيمنعك من الدفع النقدي ويقولك المتاح.",
      },
      {
        title: "تعديل الشحنة",
        desc: "افتح الشحنة من القايمة ودوس تعديل. تقدر كمان تعدّل الدفعات من قسم المدفوعات جوه صفحة الشحنة نفسها.",
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
    anyPerm: ["sales.create", "shipments.create"],
    steps: [
      {
        title: "مرتجع بيع",
        desc: "من الفواتير → مرتجع بيع جديد. اختار فاتورة العميل وحدد الأصناف الراجعة والكميات، والسيستم بيرجّع المخزون ويظبط الفلوس.",
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
        title: "التعديل على المرتجع",
        desc: "افتح المرتجع من قايمة الفواتير، ولو محتاج تلغيه أو تعدله وده محتاج موافقة، هيتبعت طلب للأدمن.",
        to: b("/invoices"),
        perm: "invoices.view",
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
        desc: "لما تستلم فلوس من عميل من غير فاتورة، سجّلها سند قبض من شاشة الخزنة — بيزوّد الخزنة ويقلّل مديونية العميل.",
        to: b("/treasury"),
        perm: "receipt_vouchers.view",
      },
      {
        title: "سند صرف",
        desc: "أي فلوس بتخرج (دفعة لمورد، مصاريف) تتسجل سند صرف من نفس الشاشة.",
        to: b("/treasury"),
        perm: "payment_vouchers.view",
      },
      {
        title: "ذمة عميل أو مورد",
        desc: "من جهات التواصل افتح العميل/المورد وهتلاقي كشف حساب كامل: ليه وعليه، والخصومات اللي أخدتها.",
        to: b("/contacts"),
        perm: "customers.view",
      },
      {
        title: "ذمة الشركاء",
        desc: "الذمة المالية للشركاء وتوزيع الأرباح بتلاقيها في قسم المالية بلوحة الإدارة.",
        to: () => "/admin/financial-position",
        perm: "admin_financial_position.view",
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
        desc: "شاشة الخزنة بتوريلك رصيد الفرع الحالي وكل حركة دخل وخرج منه بالتاريخ.",
        to: b("/treasury"),
        perm: "treasury.view",
      },
      {
        title: "مخزون الفرع",
        desc: "شاشة المخزون بتعرض أصناف الفرع ده بس، بالكمية المتاحة وسعر البيع وصورة المنتج.",
        to: b("/inventory"),
        perm: "inventory.view",
      },
      {
        title: "مخزون كل الفروع",
        desc: "لو صلاحيتك بتسمح، من الفروع والمخزون في لوحة الإدارة تقدر تقارن مخزون الفروع كلها في شاشة واحدة.",
        to: () => "/admin/catalog?tab=inventory",
        perm: "admin_catalog.view",
      },
    ],
  },
  {
    key: "payments",
    title: "وسائل الدفع",
    hint: "محفظة، نقدي، انستاباي، تحويل بنكي",
    icon: CreditCard,
    anyPerm: ["treasury.view", "reports.view"],
    steps: [
      {
        title: "اختيار الوسيلة",
        desc: "وقت الفاتورة تقدر تقسّم المبلغ على أكتر من وسيلة: جزء كاش وجزء محفظة مثلًا.",
      },
      {
        title: "متابعة الفلوس",
        desc: "شاشة الخزنة بتفصّل الفلوس حسب الوسيلة، فتعرف كام كاش في الدرج وكام على المحفظة أو البنك.",
        to: b("/treasury"),
        perm: "treasury.view",
      },
      {
        title: "رسوم التحويل",
        desc: "لو في نسبة رسوم على المحفظة أو انستاباي، بتتظبط من الإعدادات والسيستم بيحسبها لوحده.",
        to: () => "/admin/settings",
        perm: "admin_settings.view",
      },
    ],
  },
  {
    key: "employees",
    title: "الموظفين والشيفت",
    hint: "فتح وقفل الشيفت والحضور",
    icon: Users,
    anyPerm: ["employees.view", "attendance.view", "sales.create"],
    steps: [
      {
        title: "افتح الشيفت",
        desc: "قبل ما تبدأ بيع، افتح الشيفت وسجّل رصيد الدرج الافتتاحي.",
        to: b("/shifts/open"),
        perm: "sales.create",
      },
      {
        title: "اقفل الشيفت",
        desc: "آخر اليوم اقفل الشيفت واكتب اللي في الدرج فعليًا، والسيستم هيقارنه بالمفروض ويوريك الفرق.",
        to: b("/shifts/close"),
        perm: "sales.create",
      },
      {
        title: "الحضور والانصراف",
        desc: "من شاشة الحضور سجّل حضور وانصراف الموظفين، والسجل بيتحسب في المرتبات.",
        to: b("/attendance"),
        perm: "attendance.view",
      },
      {
        title: "ملف الموظف",
        desc: "بيانات الموظف ومرتبه وسلفه كلها في ملفه من شاشة الموظفين.",
        to: b("/employees"),
        perm: "employees.view",
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
        desc: "من الجرد → جلسة جديدة، السيستم بياخد صورة (snapshot) للمخزون في اللحظة دي.",
        to: b("/inventory-count/new"),
        perm: "inventory.view",
      },
      {
        title: "العد",
        desc: "افتح ورقة العد واكتب الكمية الفعلية لكل صنف — تقدر تستخدم الباركود عشان يبقى أسرع.",
        to: b("/inventory-count"),
        perm: "inventory.view",
      },
      {
        title: "المراجعة والاعتماد",
        desc: "هتشوف الفروقات (زيادة/عجز) قبل الاعتماد، وبعد الاعتماد المخزون بيتظبط ويتسجل في التقارير.",
        to: b("/inventory-count"),
        perm: "inventory.view",
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
        desc: "من لوحة الإدارة → التقارير هتلاقي كل التقارير مجمعة: عمليات، ربحية، سجل عمليات، وسجل أسعار.",
        to: () => "/admin/reports-hub",
        perm: "admin_reports_hub.view",
      },
      {
        title: "الفلترة",
        desc: "فوق أي تقرير في فلتر بالتاريخ وبالفرع — غيّرهم وهتلاقي الأرقام اتحدثت على طول، وتقدر تصدّر Excel أو PDF.",
      },
    ],
  },
  {
    key: "settings",
    title: "الإعدادات",
    hint: "أهم حاجات تظبطها من البداية",
    icon: Settings,
    anyPerm: ["admin_settings.view"],
    steps: [
      {
        title: "بيانات الشركة",
        desc: "الاسم واللوجو والعنوان — دول بيظهروا على الفواتير المطبوعة.",
        to: () => "/admin/settings",
        perm: "admin_settings.view",
      },
      {
        title: "الفروع والمستخدمين",
        desc: "ضيف فروعك، وضيف الموظفين واربطهم بالفروع من فورم واحدة.",
        to: () => "/admin/catalog?tab=branches",
        perm: "admin_catalog.view",
      },
      {
        title: "الصلاحيات",
        desc: "من الإعدادات تحدد كل دور يشوف إيه بالظبط، وتقدر تدي صلاحية إضافية ليوزر معيّن لوحده.",
        to: () => "/admin/settings",
        perm: "admin_settings.view",
      },
      {
        title: "سياسات الخصم والمرتجع",
        desc: "حدد أقصى خصم مسموح للكاشير ومدة السماح بالمرتجع، وأي تجاوز هيحتاج موافقة الأدمن.",
        to: () => "/admin/settings",
        perm: "admin_settings.view",
      },
    ],
  },
];
