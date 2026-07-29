import { useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, Database, Trash2, Sparkles } from "lucide-react";

const SAMPLE_CATEGORIES = ["إلكترونيات", "ملابس", "مواد غذائية", "أدوات منزلية", "مستلزمات مكتبية"];

const SAMPLE_PRODUCTS = [
  { name: "هاتف ذكي سامسونج A54", cost: 8500, sell: 11000, market: 12500, qty: 15, cat: "إلكترونيات" },
  { name: "سماعات بلوتوث JBL", cost: 1200, sell: 1800, market: 2000, qty: 30, cat: "إلكترونيات" },
  { name: "شاحن سريع 65W", cost: 350, sell: 600, market: 700, qty: 50, cat: "إلكترونيات" },
  { name: "تيشيرت قطن رجالي", cost: 180, sell: 320, market: 400, qty: 80, cat: "ملابس" },
  { name: "بنطلون جينز", cost: 420, sell: 750, market: 900, qty: 45, cat: "ملابس" },
  { name: "حذاء رياضي", cost: 850, sell: 1400, market: 1700, qty: 25, cat: "ملابس" },
  { name: "أرز مصري 5 كجم", cost: 280, sell: 360, market: 400, qty: 100, cat: "مواد غذائية" },
  { name: "زيت عباد الشمس 1.8 لتر", cost: 95, sell: 130, market: 150, qty: 60, cat: "مواد غذائية" },
  { name: "سكر أبيض 1 كجم", cost: 32, sell: 45, market: 50, qty: 200, cat: "مواد غذائية" },
  { name: "مقلاة تيفال 28سم", cost: 480, sell: 780, market: 950, qty: 12, cat: "أدوات منزلية" },
  { name: "طقم كاسات زجاج", cost: 120, sell: 220, market: 280, qty: 35, cat: "أدوات منزلية" },
  { name: "دفتر A4 100 ورقة", cost: 25, sell: 45, market: 55, qty: 150, cat: "مستلزمات مكتبية" },
  { name: "قلم جاف أزرق", cost: 3, sell: 8, market: 10, qty: 500, cat: "مستلزمات مكتبية" },
  { name: "ملف بلاستيك", cost: 18, sell: 35, market: 45, qty: 80, cat: "مستلزمات مكتبية" },
];

const SAMPLE_CUSTOMERS = [
  { name: "أحمد محمد علي", phone: "01012345678", address: "المعادي، القاهرة" },
  { name: "فاطمة حسن", phone: "01198765432", address: "المهندسين، الجيزة" },
  { name: "محمود إبراهيم", phone: "01234567890", address: "مدينة نصر، القاهرة" },
  { name: "سارة عبدالله", phone: "01556789012", address: "الزمالك، القاهرة" },
  { name: "خالد السيد", phone: "01087654321", address: "الإسكندرية" },
];

const SAMPLE_SUPPLIERS = [
  { name: "شركة النور للإلكترونيات", contact_person: "م. أحمد فاروق", phone: "01000111222", address: "وسط البلد، القاهرة" },
  { name: "مصنع الأمل للملابس", contact_person: "أ. سمير عبدالعزيز", phone: "01000333444", address: "شبرا الخيمة" },
  { name: "موزع المواد الغذائية", contact_person: "أ. ياسر علي", phone: "01000555666", address: "العبور" },
];

export default function SeedData() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog((l) => [...l, msg]);

  const seed = async () => {
    setLoading(true);
    setLog([]);
    try {
      // 1) Categories
      addLog("→ إنشاء التصنيفات...");
      const { data: existingCats } = await supabase.from("categories").select("name");
      const existingNames = new Set((existingCats ?? []).map((c) => c.name));
      const newCats = SAMPLE_CATEGORIES.filter((n) => !existingNames.has(n)).map((name) => ({ name }));
      if (newCats.length) await supabase.from("categories").insert(newCats);
      const { data: cats } = await supabase.from("categories").select("*");
      addLog(`✓ ${cats?.length ?? 0} تصنيف`);

      // 2) Branches
      const { data: branches } = await supabase.from("branches").select("*").eq("is_active", true).neq("code", "PARTNER-CASH");
      if (!branches || branches.length === 0) {
        addLog("⚠️ لا توجد فروع — أضف فرعاً أولاً من 'إدارة الفروع'");
        setLoading(false);
        return;
      }
      addLog(`→ التعبئة في ${branches.length} فرع...`);

      // 3) Suppliers (global)
      const { data: existingSup } = await supabase.from("contacts").select("name");
      const supNames = new Set((existingSup ?? []).map((s) => s.name));
      const newSups = SAMPLE_SUPPLIERS.filter((s) => !supNames.has(s.name));
      if (newSups.length) await supabase.from("contacts").insert(newSups);
      addLog(`✓ ${SAMPLE_SUPPLIERS.length} مورد`);

      // 4) For each branch: products, customers, employees, expenses
      for (const branch of branches) {
        addLog(`  ⮕ ${branch.name}`);

        // Products
        const productsToInsert = [];
        for (const p of SAMPLE_PRODUCTS) {
          const cat = cats?.find((c) => c.name === p.cat);
          const { data: skuRes } = await supabase.rpc("next_sku");
          productsToInsert.push({
            name: p.name, sku: skuRes as string, branch_id: branch.id,
            category_id: cat?.id ?? null,
            cost_price: p.cost, selling_price: p.sell, market_price: p.market,
            quantity: p.qty, low_stock_alert: 5,
          });
        }
        await supabase.from("products").insert(productsToInsert);
        addLog(`    ✓ ${productsToInsert.length} منتج`);

        // Customers
        const customersToInsert = SAMPLE_CUSTOMERS.map((c) => ({ ...c, branch_id: branch.id }));
        await supabase.from("contacts").insert(customersToInsert);
        addLog(`    ✓ ${customersToInsert.length} عميل`);

        // Employees
        const employees = [
          { name: "محمد عبدالرحمن", job_title: "مدير الفرع", base_salary: 8000, phone: "01001112222" },
          { name: "أمينة سعيد", job_title: "كاشير", base_salary: 4500, phone: "01003334444" },
          { name: "حسام أبو زيد", job_title: "أمين مخزن", base_salary: 5000, phone: "01005556666" },
        ];
        await supabase.from("employees").insert(
          employees.map((e) => ({ ...e, branch_id: branch.id, hire_date: new Date().toISOString().slice(0, 10) }))
        );
        addLog(`    ✓ ${employees.length} موظف`);

        // (Expenses seeded via vouchers/treasury — see opening balance below)

        // Treasury opening balance
        await supabase.from("treasury").insert({
          branch_id: branch.id, type: "income", category: "رصيد افتتاحي",
          amount: 20000, description: "رصيد افتتاحي للخزنة",
          created_by: user!.id,
        });
        addLog(`    ✓ رصيد افتتاحي 20,000 ج.م`);
      }

      addLog("✅ تم إنشاء البيانات التجريبية بنجاح!");
      toast.success("تم إنشاء البيانات التجريبية");
    } catch (e: any) {
      addLog(`❌ خطأ: ${e.message}`);
      toast.error(e.message);
    }
    setLoading(false);
  };

  const clearAll = async () => {
    if (!confirm("سيتم حذف كل البيانات التشغيلية (المنتجات، الفواتير، العملاء...). هل أنت متأكد؟")) return;
    setClearing(true);
    setLog([]);
    try {
      addLog("→ حذف البيانات...");
      // Order matters due to FKs / refs
      await supabase.from("return_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("returns").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("invoice_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("invoices").update({ status: "cancelled" as any }).neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("shipment_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("shipments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("stock_transfers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("treasury_transfers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("treasury").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      
      await supabase.from("advance_payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("advances").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("salaries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("employees").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("products").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("contacts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      addLog("✅ تم الحذف");
      toast.success("تم حذف البيانات التشغيلية");
    } catch (e: any) {
      addLog(`❌ ${e.message}`);
      toast.error(e.message);
    }
    setClearing(false);
  };

  return (
    <AdminLayout>
      <PageHeader title="البيانات التجريبية" subtitle="إنشاء بيانات وهمية لاختبار النظام" />

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-primary/10 text-primary"><Sparkles className="w-6 h-6" /></div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2">إنشاء بيانات تجريبية</h3>
              <p className="text-sm text-muted-foreground mb-4">
                سيتم إضافة تصنيفات، 14 منتج، 5 عملاء، 3 موظفين، مصروفات، وموردين لكل فرع نشط.
              </p>
              <Button onClick={seed} disabled={loading} className="btn-gradient">
                {loading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Database className="w-4 h-4 ml-2" />}
                إنشاء البيانات
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-destructive/30">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive"><Trash2 className="w-6 h-6" /></div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2">حذف البيانات التشغيلية</h3>
              <p className="text-sm text-muted-foreground mb-4">
                حذف كل المنتجات، العملاء، الفواتير، الشحنات، والموظفين. لن يتم حذف الفروع أو المستخدمين.
              </p>
              <Button onClick={clearAll} disabled={clearing} variant="destructive">
                {clearing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Trash2 className="w-4 h-4 ml-2" />}
                حذف الكل
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {log.length > 0 && (
        <Card className="p-4">
          <h4 className="font-semibold mb-3">سجل التنفيذ</h4>
          <div className="bg-muted/50 rounded p-3 font-mono text-xs max-h-96 overflow-auto space-y-1">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </Card>
      )}
    </AdminLayout>
  );
}
