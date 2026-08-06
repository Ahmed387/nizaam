import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CsvImportPanel, ValidationOutput, ImportOutput } from "@/components/CsvImportPanel";
import { CsvColumn, ParsedCsvRow, findDuplicates } from "@/lib/csvImport";
import { ShieldAlert, ListOrdered, Info } from "lucide-react";

const key = (s: any) => String(s ?? "").trim().toLowerCase();
const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAYMENT_KEYS: Record<string, string> = {
  "كاش": "cash", "نقدي": "cash", "نقدى": "cash", "cash": "cash",
  "محفظة": "vodafone", "فودافون كاش": "vodafone", "محفظة الكترونية": "vodafone", "vodafone": "vodafone", "wallet": "vodafone",
  "انستاباي": "instapay", "instapay": "instapay",
  "بنك": "bank", "تحويل بنكي": "bank", "حساب بنكي": "bank", "bank": "bank",
};

const ROLE_KEYS: Record<string, string> = {
  "كاشير": "cashier", "cashier": "cashier",
  "مدير فرع": "branch_manager", "branch_manager": "branch_manager",
  "امين مخزن": "warehouse", "أمين مخزن": "warehouse", "warehouse": "warehouse",
  "محاسب": "accountant", "accountant": "accountant",
  "ملاحظ": "supervisor", "supervisor": "supervisor",
  "عامل": "worker", "worker": "worker",
  "سواق": "driver", "driver": "driver",
};

type Ref = {
  branches: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
  contacts: { id: string; name: string; phone: string | null }[];
  products: { id: string; sku: string; name: string; branch_id: string }[];
};

export default function CoreDataImport() {
  const { tenantId, isOwner, isAdmin, user } = useAuth() as any;
  const allowed = Boolean(isOwner || isAdmin);
  const [openingDate, setOpeningDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [treasuryExpected, setTreasuryExpected] = useState("");
  const [branchCount, setBranchCount] = useState<number | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("branches" as any).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
      .then(({ count }) => setBranchCount(count ?? 0));
  }, [tenantId]);

  const loadRef = async (): Promise<Ref> => {
    const [b, c, ct, p] = await Promise.all([
      supabase.from("branches" as any).select("id,code,name").eq("tenant_id", tenantId),
      supabase.from("categories" as any).select("id,name").eq("tenant_id", tenantId),
      supabase.from("contacts" as any).select("id,name,phone").eq("tenant_id", tenantId),
      supabase.from("products" as any).select("id,sku,name,branch_id").eq("tenant_id", tenantId).is("archived_at", null),
    ]);
    return {
      branches: (b.data as any) ?? [], categories: (c.data as any) ?? [],
      contacts: (ct.data as any) ?? [], products: (p.data as any) ?? [],
    };
  };

  /** ترحيل الأرصدة الافتتاحية: بيدمج المستورد مع اللي متسجل قبل كده وبيعيد النشر مرة واحدة (من غير ازدواج) */
  const postOpening = async (patch: {
    cash?: Record<string, number>;
    contacts?: Record<string, number>;
    inventory?: Record<string, { quantity: number; cost_price: number }>;
  }) => {
    const { data: snap } = await supabase.rpc("get_opening_balances" as any);
    const s: any = snap ?? {};
    const cash: Record<string, number> = {};
    (s.cash ?? []).forEach((r: any) => { if (r.branch_id) cash[r.branch_id] = Number(r.amount) || 0; });
    const contacts: Record<string, number> = {};
    (s.contacts ?? []).forEach((r: any) => { contacts[r.contact_id] = Number(r.amount) || 0; });
    const inventory: Record<string, { quantity: number; cost_price: number }> = {};
    (s.inventory ?? []).forEach((r: any) => {
      inventory[r.product_id] = { quantity: Number(r.quantity) || 0, cost_price: Number(r.cost_price) || 0 };
    });
    Object.assign(cash, patch.cash ?? {});
    Object.assign(contacts, patch.contacts ?? {});
    Object.assign(inventory, patch.inventory ?? {});

    const { data, error } = await supabase.rpc("post_opening_balances" as any, {
      p_date: openingDate,
      p_cash: Object.entries(cash).filter(([, v]) => v !== 0).map(([branch_id, amount]) => ({ branch_id, amount })),
      p_contacts: Object.entries(contacts).filter(([, v]) => v !== 0).map(([contact_id, amount]) => ({ contact_id, amount })),
      p_inventory: Object.entries(inventory).filter(([, v]) => v.quantity > 0)
        .map(([product_id, v]) => ({ product_id, quantity: v.quantity, cost_price: v.cost_price })),
    });
    if (error) throw error;
    return data as any;
  };

  const insertRows = async (
    table: string,
    rows: ParsedCsvRow[],
    build: (d: any) => any,
  ): Promise<ImportOutput> => {
    let inserted = 0;
    const failed: { index: number; error: string }[] = [];
    for (const r of rows) {
      const { error } = await supabase.from(table as any).insert(build(r.data));
      if (error) failed.push({ index: r.index, error: error.message });
      else inserted++;
    }
    return { inserted, failed };
  };

  if (!allowed) {
    return (
      <AdminLayout>
        <PageHeader title="استيراد البيانات الأساسية" />
        <Card className="border-destructive/40">
          <CardContent className="p-8 text-center space-y-2">
            <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
            <p className="font-semibold">الشاشة دي للمالك أو المدير بس.</p>
          </CardContent>
        </Card>
      </AdminLayout>
    );
  }

  /* ───────────────────────── 1) الفروع ───────────────────────── */
  const branchCols: CsvColumn[] = [
    { key: "code", ar: "كود الفرع", en: "Branch Code", required: true, note: "فريد داخل الشركة — ممنوع التكرار" },
    { key: "name", ar: "اسم الفرع", en: "Branch Name", required: true },
    { key: "address", ar: "العنوان", en: "Address" },
    { key: "phone", ar: "التليفون", en: "Phone" },
    { key: "monthly_sales_target", ar: "تارجت المبيعات الشهري", en: "Monthly Sales Target", type: "number", note: "افتراضي 0" },
    { key: "low_balance_threshold", ar: "حد تنبيه الخزنة", en: "Low Balance Threshold", type: "number", note: "افتراضي 0" },
  ];

  /* ───────────────────────── 2) التصنيفات ───────────────────────── */
  const categoryCols: CsvColumn[] = [
    { key: "name", ar: "اسم التصنيف", en: "Category Name", required: true },
    { key: "parent", ar: "التصنيف الأب", en: "Parent Category", note: "اسم تصنيف موجود أو موجود في نفس الملف قبله" },
  ];

  /* ───────────────────────── 3) المنتجات ───────────────────────── */
  const productCols: CsvColumn[] = [
    { key: "sku", ar: "كود الصنف/الباركود", en: "SKU / Barcode", required: true, note: "الكود ده هو نفسه الباركود — مفيش خانة تانية للباركود. فريد لكل فرع" },
    { key: "name", ar: "اسم الصنف", en: "Product Name", required: true },
    { key: "branch_code", ar: "كود الفرع", en: "Branch Code", required: true, note: "لازم الفرع يترفع الأول" },
    { key: "category", ar: "التصنيف", en: "Category", note: "لازم يكون موجود في جدول التصنيفات" },
    { key: "cost_price", ar: "سعر التكلفة", en: "Cost Price", type: "number", note: "افتراضي 0" },
    { key: "selling_price", ar: "سعر البيع", en: "Selling Price", type: "number", note: "افتراضي 0" },
    { key: "market_price", ar: "سعر السوق", en: "Market Price", type: "number", note: "افتراضي 0" },
    { key: "brand", ar: "الماركة", en: "Brand" },
    { key: "model", ar: "الموديل", en: "Model" },
    { key: "color", ar: "اللون", en: "Color" },
    { key: "size", ar: "المقاس", en: "Size" },
    { key: "capacity", ar: "السعة", en: "Capacity" },
    { key: "min_stock_level", ar: "حد التنبيه", en: "Low Stock Alert", type: "number", note: "افتراضي 5" },
    { key: "legacy_code", ar: "الكود في النظام القديم", en: "Legacy Code" },
  ];

  /* ───────────────── 4) أرصدة المخزون الافتتاحية ───────────────── */
  const stockCols: CsvColumn[] = [
    { key: "branch_code", ar: "كود الفرع", en: "Branch Code", required: true },
    { key: "sku", ar: "كود الصنف/الباركود", en: "SKU / Barcode", required: true, note: "نفس الباركود — لازم المنتج يكون مرفوع في نفس الفرع" },
    { key: "quantity", ar: "الكمية", en: "Quantity", required: true, type: "number" },
    { key: "unit_cost", ar: "تكلفة الوحدة", en: "Unit Cost", required: true, type: "number", note: "أساس الـ FIFO — مهم جدًا" },
  ];

  /* ───────────────── 5) العملاء والموردين ───────────────── */
  const contactCols: CsvColumn[] = [
    { key: "name", ar: "الاسم", en: "Name", required: true, note: "ممنوع التكرار" },
    { key: "type", ar: "النوع", en: "Type", required: true, note: "عميل / مورد / الاتنين — customer/supplier/both" },
    { key: "phone", ar: "التليفون", en: "Phone", note: "لو مكرر هيترفض الصف" },
    { key: "email", ar: "الإيميل", en: "Email", note: "اختياري — لإرسال الفواتير وكشف الحساب" },
    { key: "contact_person", ar: "الشخص المسؤول", en: "Contact Person" },
    { key: "address", ar: "العنوان", en: "Address" },
    { key: "branch_code", ar: "كود الفرع", en: "Branch Code", note: "اختياري — لو فاضي بيبقى على مستوى الشركة" },
    { key: "notes", ar: "ملاحظات", en: "Notes" },
  ];

  /* ───────────────── 6) أرصدة العملاء/الموردين الافتتاحية ───────────────── */
  const arApCols: CsvColumn[] = [
    { key: "name", ar: "اسم العميل/المورد", en: "Contact Name", required: true, note: "لازم يكون مرفوع قبل كده" },
    { key: "phone", ar: "التليفون", en: "Phone", note: "للتفرقة لو فيه أسماء متشابهة" },
    { key: "amount", ar: "الرصيد الافتتاحي", en: "Opening Balance", required: true, type: "number", note: "موجب = العميل مدين لنا، سالب = إحنا مدينين للمورد" },
  ];

  /* ───────────────── 7) الموظفين ───────────────── */
  const employeeCols: CsvColumn[] = [
    { key: "name", ar: "اسم الموظف", en: "Employee Name", required: true },
    { key: "job_title", ar: "الوظيفة", en: "Job Title", required: true },
    { key: "branch_code", ar: "كود الفرع", en: "Branch Code", required: true },
    { key: "role", ar: "الدور في النظام", en: "System Role", note: "كاشير/مدير فرع/أمين مخزن/محاسب/ملاحظ/عامل/سواق — سيبه فاضي لو الموظف مش هيدخل النظام" },
    { key: "phone", ar: "التليفون", en: "Phone" },
    { key: "email", ar: "الإيميل", en: "Email" },
    { key: "base_salary", ar: "الراتب الأساسي", en: "Base Salary", type: "number", note: "افتراضي 0" },
    { key: "hire_date", ar: "تاريخ التعيين", en: "Hire Date", required: true, type: "date" },
    { key: "national_id", ar: "الرقم القومي", en: "National ID" },
  ];

  /* ───────────────── 8) أرصدة الخزنة الافتتاحية ───────────────── */
  const treasuryCols: CsvColumn[] = [
    { key: "branch_code", ar: "كود الفرع", en: "Branch Code", required: true },
    { key: "method", ar: "وسيلة الدفع", en: "Payment Method", required: true, note: "كاش / محفظة / انستاباي / تحويل بنكي" },
    { key: "amount", ar: "الرصيد الافتتاحي", en: "Opening Amount", required: true, type: "number" },
    { key: "reference", ar: "مرجع/ملاحظة", en: "Reference" },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="استيراد البيانات الأساسية (ترحيل من نظام قديم)"
        subtitle="ارفع بيانات نظامك القديم بالترتيب الصح — كل شاشة بتفحص الملف الأول وترفض الصف الغلط وتقوللك السبب."
      />

      <Card className="mb-4 border-primary/40 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ListOrdered className="h-4 w-4" /> الترتيب الإجباري للرفع
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="flex flex-wrap gap-1">
            {["1 الفروع", "2 التصنيفات", "3 المنتجات", "4 مخزون افتتاحي", "5 عملاء وموردين", "6 أرصدة ذمم افتتاحية", "7 الموظفين", "8 خزنة افتتاحية"]
              .map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
          </div>
          <p className="text-muted-foreground">
            أي جدول بيشاور على جدول تاني (زي المنتج اللي بيشاور على الفرع والتصنيف) مش هيترفع غير لما الجدول الأصلي يترفع الأول.
            {branchCount !== null && ` — عندك دلوقتي ${branchCount} فرع مسجل.`}
          </p>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>تاريخ بداية التشغيل على النظام</Label>
            <Input type="date" className="w-48" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground max-w-xl flex gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            كل الأرصدة الافتتاحية (مخزون / ذمم / خزنة) بتتسجل بالتاريخ ده كقيد «رصيد افتتاحي» منفصل تمامًا عن أي فاتورة جديدة.
            أي إعادة رفع بتلغي الترحيل الافتتاحي السابق وتكتبه من جديد — يعني مفيش ازدواج مهما رفعت.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="branches">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="branches">1 الفروع</TabsTrigger>
          <TabsTrigger value="categories">2 التصنيفات</TabsTrigger>
          <TabsTrigger value="products">3 المنتجات</TabsTrigger>
          <TabsTrigger value="stock">4 مخزون افتتاحي</TabsTrigger>
          <TabsTrigger value="contacts">5 عملاء وموردين</TabsTrigger>
          <TabsTrigger value="arap">6 أرصدة الذمم</TabsTrigger>
          <TabsTrigger value="employees">7 الموظفين</TabsTrigger>
          <TabsTrigger value="treasury">8 الخزنة الافتتاحية</TabsTrigger>
        </TabsList>

        {/* 1) الفروع */}
        <TabsContent value="branches">
          <CsvImportPanel
            title="الفروع / Branches"
            description="أول جدول لازم يترفع. كود الفرع فريد وبيتستخدم كمرجع في كل الملفات اللي بعده."
            templateName="01-branches"
            columns={branchCols}
            sample={{ code: "B01", name: "الفرع الرئيسي", address: "شارع الجمهورية - طنطا", phone: "0403300000", monthly_sales_target: 500000, low_balance_threshold: 5000 }}
            validate={async (rows) => {
              const ref = await loadRef();
              const existing = new Set(ref.branches.map((b) => key(b.code)));
              const dups = new Map(findDuplicates(rows, (d) => d.code));
              const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
              rows.forEach((r) => {
                const e = [...r.errors];
                if (r.data.code && existing.has(key(r.data.code))) e.push(`كود الفرع «${r.data.code}» موجود بالفعل في النظام`);
                if (r.data.code && dups.has(key(r.data.code))) e.push("كود الفرع مكرر داخل نفس الملف");
                e.length ? bad.push({ index: r.index, errors: e }) : ok.push(r);
              });
              return { ok, bad };
            }}
            onImport={(rows) => insertRows("branches", rows, (d) => ({
              tenant_id: tenantId, code: d.code, name: d.name, address: d.address, phone: d.phone,
              monthly_sales_target: d.monthly_sales_target ?? 0, low_balance_threshold: d.low_balance_threshold ?? 0,
            }))}
          />
        </TabsContent>

        {/* 2) التصنيفات */}
        <TabsContent value="categories">
          <CsvImportPanel
            title="التصنيفات / Categories"
            description="لازم قبل المنتجات. التصنيف الأب لازم يكون موجود أو مكتوب في صف أعلى في نفس الملف."
            templateName="02-categories"
            columns={categoryCols}
            sample={{ name: "تكييفات", parent: "" }}
            validate={async (rows) => {
              const ref = await loadRef();
              const existing = new Set(ref.categories.map((c) => key(c.name)));
              const dups = new Map(findDuplicates(rows, (d) => d.name));
              const seen = new Set<string>();
              const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
              rows.forEach((r) => {
                const e = [...r.errors];
                if (r.data.name && existing.has(key(r.data.name))) e.push(`التصنيف «${r.data.name}» موجود بالفعل`);
                if (r.data.name && dups.has(key(r.data.name))) e.push("اسم التصنيف مكرر داخل الملف");
                if (r.data.parent && !existing.has(key(r.data.parent)) && !seen.has(key(r.data.parent)))
                  e.push(`التصنيف الأب «${r.data.parent}» مش موجود — ارفعه الأول`);
                if (!e.length) { seen.add(key(r.data.name)); ok.push(r); } else bad.push({ index: r.index, errors: e });
              });
              return { ok, bad };
            }}
            onImport={async (rows) => {
              const ref = await loadRef();
              const map = new Map(ref.categories.map((c) => [key(c.name), c.id]));
              let inserted = 0; const failed: any[] = [];
              for (const r of rows) {
                const parent_id = r.data.parent ? map.get(key(r.data.parent)) ?? null : null;
                const { data, error } = await supabase.from("categories" as any)
                  .insert({ tenant_id: tenantId, name: r.data.name, parent_id }).select("id").single();
                if (error) failed.push({ index: r.index, error: error.message });
                else { inserted++; map.set(key(r.data.name), (data as any).id); }
              }
              return { inserted, failed };
            }}
          />
        </TabsContent>

        {/* 3) المنتجات */}
        <TabsContent value="products">
          <CsvImportPanel
            title="المنتجات / Products"
            description="كل منتج بيتسجل على فرع معيّن. الكمية بتتحدد من ملف «المخزون الافتتاحي» مش من هنا."
            templateName="03-products"
            columns={productCols}
            sample={{
              sku: "P-1001", name: "تكييف توشيبا 1.5 حصان", branch_code: "B01", category: "تكييفات",
              cost_price: 15000, selling_price: 18000, market_price: 18500, brand: "توشيبا", model: "RAS-18",
              color: "أبيض", size: "", capacity: "1.5 حصان", min_stock_level: 3, legacy_code: "OLD-991",
            }}
            validate={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              const cats = new Set(ref.categories.map((c) => key(c.name)));
              const existing = new Set(ref.products.map((p) => `${p.branch_id}|${key(p.sku)}`));
              const dups = new Map(findDuplicates(rows, (d) => `${key(d.branch_code)}|${key(d.sku)}`));
              const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
              rows.forEach((r) => {
                const e = [...r.errors];
                const bid = branches.get(key(r.data.branch_code));
                if (r.data.branch_code && !bid) e.push(`كود الفرع «${r.data.branch_code}» مش موجود — ارفع الفروع الأول`);
                if (r.data.category && !cats.has(key(r.data.category))) e.push(`التصنيف «${r.data.category}» مش موجود — ارفع التصنيفات الأول`);
                if (bid && existing.has(`${bid}|${key(r.data.sku)}`)) e.push(`الكود «${r.data.sku}» متسجل قبل كده في نفس الفرع`);
                if (dups.has(`${key(r.data.branch_code)}|${key(r.data.sku)}`)) e.push("الكود مكرر مع نفس الفرع داخل الملف");
                e.length ? bad.push({ index: r.index, errors: e }) : ok.push(r);
              });
              return { ok, bad };
            }}
            onImport={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              const cats = new Map(ref.categories.map((c) => [key(c.name), c.id]));
              return insertRows("products", rows, (d) => ({
                tenant_id: tenantId, sku: d.sku, name: d.name,
                branch_id: branches.get(key(d.branch_code)),
                category_id: d.category ? cats.get(key(d.category)) ?? null : null,
                cost_price: d.cost_price ?? 0, selling_price: d.selling_price ?? 0, market_price: d.market_price ?? 0,
                brand: d.brand, model: d.model, color: d.color, size: d.size, capacity: d.capacity,
                min_stock_level: d.min_stock_level ?? 5, low_stock_alert: d.min_stock_level ?? 5,
                quantity: 0, is_migrated: true, legacy_code: d.legacy_code,
              }));
            }}
          />
        </TabsContent>

        {/* 4) المخزون الافتتاحي */}
        <TabsContent value="stock">
          <CsvImportPanel
            title="أرصدة المخزون الافتتاحية / Opening Stock"
            description="بيعمل دفعة FIFO افتتاحية بتكلفة الوحدة اللي هتدخلها + قيد «رصيد افتتاحي — مخزون» بتاريخ بداية التشغيل."
            templateName="04-opening-stock"
            columns={stockCols}
            sample={{ branch_code: "B01", sku: "P-1001", quantity: 12, unit_cost: 15000 }}
            validate={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              const prod = new Map(ref.products.map((p) => [`${p.branch_id}|${key(p.sku)}`, p.id]));
              const dups = new Map(findDuplicates(rows, (d) => `${key(d.branch_code)}|${key(d.sku)}`));
              const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
              let total = 0;
              rows.forEach((r) => {
                const e = [...r.errors];
                const bid = branches.get(key(r.data.branch_code));
                if (!bid) e.push(`كود الفرع «${r.data.branch_code}» مش موجود`);
                else if (!prod.has(`${bid}|${key(r.data.sku)}`)) e.push(`الصنف «${r.data.sku}» مش موجود في الفرع ده — ارفع المنتجات الأول`);
                if (Number(r.data.quantity) < 0) e.push("الكمية مينفعش تكون بالسالب");
                if (Number(r.data.unit_cost) <= 0) e.push("تكلفة الوحدة لازم تكون أكبر من صفر عشان الـ FIFO يبدأ صح");
                if (dups.has(`${key(r.data.branch_code)}|${key(r.data.sku)}`)) e.push("الصنف مكرر لنفس الفرع في الملف");
                if (e.length) bad.push({ index: r.index, errors: e });
                else { ok.push(r); total += Number(r.data.quantity) * Number(r.data.unit_cost); }
              });
              return { ok, bad, notes: [`قيمة المخزون الافتتاحي في الملف: ${fmt(total)} جنيه`] };
            }}
            onImport={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              const prod = new Map(ref.products.map((p) => [`${p.branch_id}|${key(p.sku)}`, p.id]));
              const inventory: Record<string, { quantity: number; cost_price: number }> = {};
              rows.forEach((r) => {
                const bid = branches.get(key(r.data.branch_code))!;
                const pid = prod.get(`${bid}|${key(r.data.sku)}`)!;
                inventory[pid] = { quantity: Number(r.data.quantity), cost_price: Number(r.data.unit_cost) };
              });
              const res = await postOpening({ inventory });
              return {
                inserted: rows.length,
                notes: [`إجمالي قيمة المخزون بعد الترحيل: ${fmt(res?.inventory_total ?? 0)} جنيه — عدد القيود: ${res?.entries ?? 0}`],
              };
            }}
          />
        </TabsContent>

        {/* 5) العملاء والموردين */}
        <TabsContent value="contacts">
          <CsvImportPanel
            title="العملاء والموردين / Customers & Suppliers"
            description="الأرصدة مش بتتدخل هنا — دي في التبويب اللي بعده عشان الترحيل يفضل نظيف."
            templateName="05-contacts"
            columns={contactCols}
            sample={{ name: "محمد السيد", type: "عميل", phone: "01000000000", email: "customer@example.com", contact_person: "", address: "طنطا", branch_code: "B01", notes: "" }}
            validate={async (rows) => {
              const ref = await loadRef();
              const names = new Set(ref.contacts.map((c) => key(c.name)));
              const phones = new Set(ref.contacts.filter((c) => c.phone).map((c) => key(c.phone)));
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              const dupNames = new Map(findDuplicates(rows, (d) => d.name));
              const dupPhones = new Map(findDuplicates(rows, (d) => d.phone));
              const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
              rows.forEach((r) => {
                const e = [...r.errors];
                const t = key(r.data.type);
                const mapped = ["عميل", "customer"].includes(t) ? "customer"
                  : ["مورد", "supplier"].includes(t) ? "supplier"
                    : ["both", "الاتنين", "عميل ومورد"].includes(t) ? "both" : null;
                if (!mapped) e.push(`النوع «${r.data.type}» مش مفهوم — اكتب: عميل أو مورد أو الاتنين`);
                else r.data._type = mapped;
                if (names.has(key(r.data.name))) e.push(`الاسم «${r.data.name}» موجود بالفعل`);
                if (dupNames.has(key(r.data.name))) e.push("الاسم مكرر داخل الملف");
                if (r.data.phone && phones.has(key(r.data.phone))) e.push(`رقم التليفون «${r.data.phone}» متسجل لحساب تاني`);
                if (r.data.phone && dupPhones.has(key(r.data.phone))) e.push("رقم التليفون مكرر داخل الملف");
                if (r.data.branch_code && !branches.get(key(r.data.branch_code))) e.push(`كود الفرع «${r.data.branch_code}» مش موجود`);
                if (r.data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(r.data.email).trim())) e.push(`الإيميل «${r.data.email}» شكله غلط`);
                e.length ? bad.push({ index: r.index, errors: e }) : ok.push(r);
              });
              return { ok, bad };
            }}
            onImport={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              return insertRows("contacts", rows, (d) => ({
                tenant_id: tenantId, name: d.name, type: d._type, phone: d.phone,
                email: d.email ? String(d.email).trim().toLowerCase() : null,
                contact_person: d.contact_person, address: d.address, notes: d.notes,
                branch_id: d.branch_code ? branches.get(key(d.branch_code)) ?? null : null,
                is_migrated: true,
              }));
            }}
          />
        </TabsContent>

        {/* 6) أرصدة الذمم */}
        <TabsContent value="arap">
          <CsvImportPanel
            title="الأرصدة الافتتاحية للعملاء والموردين / Opening AR & AP"
            description="الدين القديم بيتسجل كـ «رصيد افتتاحي» رقم واحد على الحساب. لو عايز الدين يتقسّم فواتير بأرقامها وتواريخها (عشان تقرير أعمار الديون يبقى مظبوط) استخدم تبويب «ترحيل الديون كفواتير» في صفحة ترحيل الفواتير القديمة."
            templateName="06-opening-ar-ap"
            columns={arApCols}
            sample={{ name: "محمد السيد", phone: "01000000000", amount: 5000 }}
            validate={async (rows) => {
              const ref = await loadRef();
              const byName = new Map<string, string[]>();
              ref.contacts.forEach((c) => byName.set(key(c.name), [...(byName.get(key(c.name)) ?? []), c.id]));
              const byPhone = new Map(ref.contacts.filter((c) => c.phone).map((c) => [key(c.phone), c.id]));
              const dups = new Map(findDuplicates(rows, (d) => d.name));
              const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
              let ar = 0, ap = 0;
              rows.forEach((r) => {
                const e = [...r.errors];
                let id = r.data.phone ? byPhone.get(key(r.data.phone)) : undefined;
                if (!id) {
                  const hits = byName.get(key(r.data.name)) ?? [];
                  if (!hits.length) e.push(`«${r.data.name}» مش موجود في العملاء/الموردين — ارفعه الأول`);
                  else if (hits.length > 1) e.push("فيه أكتر من حساب بنفس الاسم — حدّد التليفون");
                  else id = hits[0];
                }
                if (dups.has(key(r.data.name))) e.push("الاسم متكرر في الملف — اجمع الرصيد في صف واحد");
                if (!Number(r.data.amount)) e.push("الرصيد صفر — الصف ملوش لازمة");
                if (e.length) bad.push({ index: r.index, errors: e });
                else { r.data._id = id; ok.push(r); Number(r.data.amount) > 0 ? ar += Number(r.data.amount) : ap += -Number(r.data.amount); }
              });
              return { ok, bad, notes: [`مديونية عملاء: ${fmt(ar)} • مستحقات موردين: ${fmt(ap)}`] };
            }}
            onImport={async (rows) => {
              const contacts: Record<string, number> = {};
              rows.forEach((r) => { contacts[r.data._id] = Number(r.data.amount); });
              const res = await postOpening({ contacts });
              return {
                inserted: rows.length,
                notes: [`تم النشر بتاريخ ${openingDate} — عملاء ${fmt(res?.receivables_total ?? 0)} • موردين ${fmt(res?.payables_total ?? 0)}`],
              };
            }}
          />
        </TabsContent>

        {/* 7) الموظفين */}
        <TabsContent value="employees">
          <CsvImportPanel
            title="الموظفين / Employees"
            description="بيتسجل بيانات الموظف وربطه بالفرع. حساب الدخول (يوزر وباسورد) بيتعمل من شاشة الموظفين بعد كده."
            templateName="07-employees"
            columns={employeeCols}
            sample={{
              name: "أحمد محمد", job_title: "كاشير", branch_code: "B01", role: "كاشير", phone: "01111111111",
              email: "ahmed@example.com", base_salary: 6000, hire_date: "2024-01-15", national_id: "29001011234567",
            }}
            validate={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              const dupPhones = new Map(findDuplicates(rows, (d) => d.phone));
              const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
              rows.forEach((r) => {
                const e = [...r.errors];
                if (!branches.get(key(r.data.branch_code))) e.push(`كود الفرع «${r.data.branch_code}» مش موجود`);
                if (r.data.role) {
                  const mapped = ROLE_KEYS[key(r.data.role)];
                  if (!mapped) e.push(`الدور «${r.data.role}» مش مفهوم`);
                  else r.data._role = mapped;
                }
                if (r.data.phone && dupPhones.has(key(r.data.phone))) e.push("رقم التليفون مكرر داخل الملف");
                e.length ? bad.push({ index: r.index, errors: e }) : ok.push(r);
              });
              return { ok, bad, notes: ["الموظف بيترفع من غير صلاحية دخول — فعّلها من شاشة الموظفين لما تحب."] };
            }}
            onImport={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              return insertRows("employees", rows, (d) => ({
                tenant_id: tenantId, name: d.name, job_title: d.job_title,
                branch_id: branches.get(key(d.branch_code)),
                role: d._role ?? null, phone: d.phone, email: d.email, national_id: d.national_id,
                base_salary: d.base_salary ?? 0, hire_date: d.hire_date, has_system_access: false,
              }));
            }}
          />
        </TabsContent>

        {/* 8) الخزنة الافتتاحية */}
        <TabsContent value="treasury">
          <CsvImportPanel
            title="أرصدة الخزنة الافتتاحية / Opening Treasury"
            description="صف لكل فرع × وسيلة دفع. بيتسجل حركة خزنة افتتاحية لكل محفظة + قيد نقدية افتتاحي مجمّع لكل فرع."
            templateName="08-opening-treasury"
            columns={treasuryCols}
            sample={{ branch_code: "B01", method: "كاش", amount: 25000, reference: "جرد الخزنة 31/12" }}
            extra={
              <div className="space-y-1 max-w-xs">
                <Label>الإجمالي التأكيدي لكل الخزن (إجباري)</Label>
                <Input type="number" step="0.01" placeholder="مثال: 63500" value={treasuryExpected}
                  onChange={(e) => setTreasuryExpected(e.target.value)} />
                <p className="text-xs text-muted-foreground">لازم يطابق مجموع الملف بالظبط، وإلا الاستيراد هيتقفل.</p>
              </div>
            }
            validate={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              const dups = new Map(findDuplicates(rows, (d) => `${key(d.branch_code)}|${key(d.method)}`));
              const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
              let sum = 0;
              rows.forEach((r) => {
                const e = [...r.errors];
                if (!branches.get(key(r.data.branch_code))) e.push(`كود الفرع «${r.data.branch_code}» مش موجود`);
                const m = PAYMENT_KEYS[key(r.data.method)];
                if (!m) e.push(`وسيلة الدفع «${r.data.method}» مش مفهومة — اكتب: كاش أو محفظة أو انستاباي أو تحويل بنكي`);
                else r.data._method = m;
                if (Number(r.data.amount) < 0) e.push("الرصيد الافتتاحي مينفعش يكون بالسالب");
                if (dups.has(`${key(r.data.branch_code)}|${key(r.data.method)}`)) e.push("نفس الفرع ونفس الوسيلة متكررين — اجمعهم في صف واحد");
                if (e.length) bad.push({ index: r.index, errors: e });
                else { ok.push(r); sum += Number(r.data.amount); }
              });
              const expected = Number(treasuryExpected);
              const notes = [`مجموع الملف: ${fmt(sum)} جنيه`];
              let blocked: string | null = null;
              if (!treasuryExpected) blocked = "اكتب الإجمالي التأكيدي الأول عشان نقارنه بمجموع الملف.";
              else if (Math.abs(expected - sum) > 0.01)
                blocked = `مجموع الملف ${fmt(sum)} مش مطابق للإجمالي اللي كتبته ${fmt(expected)} — الفرق ${fmt(Math.abs(expected - sum))}.`;
              return { ok, bad, notes, blocked };
            }}
            onImport={async (rows) => {
              const ref = await loadRef();
              const branches = new Map(ref.branches.map((b) => [key(b.code), b.id]));
              // امسح أي أرصدة خزنة افتتاحية سابقة عشان مايحصلش ازدواج
              await supabase.from("treasury" as any).delete()
                .eq("tenant_id", tenantId).eq("category", "رصيد افتتاحي");
              let inserted = 0; const failed: any[] = [];
              const cash: Record<string, number> = {};
              for (const r of rows) {
                const bid = branches.get(key(r.data.branch_code))!;
                const amount = Number(r.data.amount);
                cash[bid] = (cash[bid] ?? 0) + amount;
                if (amount === 0) { inserted++; continue; }
                const { error } = await supabase.from("treasury" as any).insert({
                  tenant_id: tenantId, branch_id: bid, type: "income", category: "رصيد افتتاحي",
                  amount, payment_method: r.data._method, created_by: user?.id,
                  description: `رصيد افتتاحي بتاريخ ${openingDate}${r.data.reference ? ` — ${r.data.reference}` : ""}`,
                  created_at: new Date(`${openingDate}T00:00:00`).toISOString(),
                });
                if (error) failed.push({ index: r.index, error: error.message }); else inserted++;
              }
              const res = await postOpening({ cash });
              return {
                inserted,
                failed,
                notes: [`قيد النقدية الافتتاحي اتنشر بتاريخ ${openingDate} بإجمالي ${fmt(res?.cash_total ?? 0)} جنيه.`],
              };
            }}
          />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
