import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2, Wallet, Boxes, Users2, Settings2, Info, ShieldCheck } from "lucide-react";

/** كل بند = خيار مستقل بالكامل بـ state خاص به */
interface ResetItem {
  key: string;
  label: string;
  hint: string;
  /** الأثر المترتب على تنفيذ هذا البند — يظهر في نافذة تحليل الأثر */
  impact: string;
  /** مفاتيح الخيارات التي تُرسل للدالة الخلفية */
  options?: string[];
  /** RPC منفصل (السندات) */
  rpc?: "vouchers";
  /** متاح فقط عند اختيار كل الفروع */
  allBranchesOnly?: boolean;
}

interface ResetCard {
  title: string;
  icon: typeof Wallet;
  items: ResetItem[];
}

const CARDS: ResetCard[] = [
  {
    title: "المعاملات التجارية والمالية",
    icon: Wallet,
    items: [
      { key: "sales", label: "فواتير المبيعات وأقساطها", hint: "يمسح الفواتير والدفعات التابعة لها للفرع فقط.", impact: "هتختفي كل فواتير البيع ودفعاتها وأقساطها من التقارير والأرباح، ومش هينفع ترجعها تاني.", options: ["sales"] },
      { key: "sale_returns", label: "مرتجعات المبيعات", hint: "يمسح فواتير الإرجاع وسنداتها للفرع فقط.", impact: "هتتشال كل عمليات الإرجاع وسنداتها، وأرقام المرتجعات في التقارير هتبقى صفر.", options: ["returns"] },
      { key: "purchases", label: "فواتير الشراء ومدفوعات الموردين", hint: "يمسح شحنات الوارد ودفعات الموردين للفرع فقط.", impact: "هتتمسح شحنات الوارد ودفعات الموردين، وأرصدة المستحق للموردين هتتغير.", options: ["shipments"] },
      { key: "purchase_returns", label: "مرتجعات الشراء", hint: "يمسح مرتجعات البضاعة للموردين للفرع فقط.", impact: "هتختفي كل مرتجعات البضاعة للموردين وتسوياتها المالية.", options: ["purchase_returns"] },
      { key: "treasury", label: "حركات الخزينة والمصروفات التشغيلية", hint: "يمسح حركات الكاش والتحويلات للفرع فقط.", impact: "رصيد الخزينة هيتصفّر وهتبدأ من أول وجديد، وكل حركات الكاش والتحويلات هتتشال.", options: ["treasury"] },
      { key: "vouchers", label: "السندات اليدوية", hint: "يمسح سندات القبض والصرف التابعة للفرع فقط.", impact: "كل سندات القبض والصرف اليدوية هتتمسح ومش هتظهر في كشوف الحسابات.", rpc: "vouchers" },
      { key: "voucher_sequences", label: "تصفير عداد ترقيم السندات", hint: "يُعيد ضبط تسلسل السندات ليبدأ من #1 مجدداً.", impact: "أول سند جديد هياخد رقم 1، فلو فيه سندات قديمة متسابة ممكن تلاقي أرقام مكررة.", options: ["voucher_sequences"] },
    ],
  },
  {
    title: "المخزون والمنتجات",
    icon: Boxes,
    items: [
      { key: "inventory", label: "تصفير كميات المخزون", hint: "يُصفر الأرصدة للفرع المختار فقط مع الإبقاء على كروت المنتجات والباركود والأسعار.", impact: "أرصدة كل المنتجات هتبقى صفر مع بقاء كروت الأصناف والباركود والأسعار زي ما هي، عشان تعمل جرد افتتاحي.", options: ["inventory"] },
      { key: "stock_movements", label: "سجل حركات وبنود الجرد والتحويلات", hint: "يمسح كارت الصنف والتحويلات وجلسات الجرد للفرع فقط.", impact: "كارت الصنف هيبقى فاضي، ومش هتقدر تتبع حركة أي منتج قبل تاريخ المسح.", options: ["stock_movements", "count_moves"] },
      { key: "products", label: "حذف بطاقات المنتجات نهائياً", hint: "متاح فقط عند اختيار «كل الفروع» — يمسح الأصناف ذاتها من النظام.", impact: "الأصناف نفسها هتتشال من النظام بكودها وباركودها وأسعارها، وهتحتاج ترفع الكتالوج من جديد.", options: ["products"], allBranchesOnly: true },
    ],
  },
  {
    title: "الموارد البشرية وجهات التعامل",
    icon: Users2,
    items: [
      { key: "payroll", label: "سجلات الرواتب والسلف والحضور", hint: "يمسح حركات الصرف والحضور مع الإبقاء على حسابات الموظفين.", impact: "سجل الرواتب والسلف والحضور هيتفضّى، بس حسابات الموظفين نفسها هتفضل موجودة.", options: ["payroll"] },
      { key: "employees", label: "مسح ملفات وسجلات الموظفين نهائياً", hint: "يمسح ملفات وحسابات الموظفين المعينين على الفرع المختار.", impact: "الحسابات الوظيفية هتتمسح، والموظفين هيحتاجوا ملفات جديدة وبيانات دخول جديدة.", options: ["employees"] },
      { key: "customer_balances", label: "أرصدة وسجلات ديون العملاء", hint: "يُصفر الرصيد وسجل الائتمان مع الحفاظ على اسم وبيانات العميل.", impact: "ديون العملاء هتبقى صفر وسجل الائتمان هيتفضّى، بس اسم العميل وبياناته هتفضل.", options: ["customer_balances"] },
      { key: "all_contacts", label: "مسح حسابات وجهات العملاء والموردين نهائياً", hint: "يمسح كروت العملاء والموردين والجهات المشتركة. أي جهة مرتبطة بمستندات مسجلة بتتخطى تلقائياً.", impact: "بيانات الاتصال وكشوف الحسابات هتتمسح نهائياً ومش ممكن استرجاعها، وأي جهة عليها مستندات مسجلة هتتساب زي ما هي لحماية الفواتير.", options: ["all_contacts"] },
      { key: "orphan_contacts", label: "جهات الاتصال غير المرتبطة بحركات", hint: "يمسح العملاء/الموردين اللي ملهمش أي فواتير أو سندات مسجلة.", impact: "الجهات الفاضية بس هي اللي هتتشال، والجهات اللي عليها حركات مش هتتأثر.", options: ["orphan_contacts"] },
      { key: "partners", label: "مسح الشركاء وحصصهم في رأس المال", hint: "متاح فقط عند اختيار «كل الفروع» — يمسح الشركاء وحركاتهم وسلفهم وتوزيعات الأرباح.", impact: "جدول الشركاء هيتفضّى بالكامل، وهتحتاج تسجّل الشركاء ونسبهم وحصص رأس المال من جديد.", options: ["partners"], allBranchesOnly: true },
    ],
  },
  {
    title: "النظام والتشغيل الإداري",
    icon: Settings2,
    items: [
      { key: "shifts", label: "الورديات وسجلات أدراج الكاشير العالقة", hint: "يمسح سجلات الورديات المفتوحة وتسليم العهد للفرع فقط.", impact: "أدراج الكاشير المعلقة هتتصفّر، والكاشير هيقدر يفتح وردية جديدة أول يوم من غير رسائل «فيه وردية مفتوحة».", options: ["shifts"] },
      { key: "fiscal_periods", label: "فترات الإغلاق السابقة", hint: "يحذف إقفالات الشهور والفروع لمنع أخطاء الحظر.", impact: "الشهور المقفولة هتتفتح تاني، فهيبقى ممكن تسجّل حركات في أي تاريخ من غير منع.", options: ["fiscal_periods"] },
      { key: "attachments", label: "المرفقات والملفات اليتيمة", hint: "ينظف المرفقات التالفة غير المرتبطة بأي مستند.", impact: "المرفقات اللي مش مرتبطة بأي مستند هتتشال، والمرفقات السليمة مش هتتأثر.", options: ["attachments"] },
      { key: "logs", label: "سجل العمليات والإشعارات", hint: "يُفرغ سجل العمليات والإشعارات وطلبات الاعتماد التابعة للفرع.", impact: "سجل المتابعة والإشعارات وطلبات الاعتماد هتتفضّى، ومش هتقدر تراجع مين عمل إيه قبل كده.", options: ["audit_log", "notifications", "approvals"] },
    ],
  },
];


const ALL_ITEMS = CARDS.flatMap((c) => c.items);

export function DataManagementTab() {
  const { branches } = useAuth();
  const [branchId, setBranchId] = useState<string>("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);

  const isAllBranches = branchId === "__all__";

  const effectiveChecked = useMemo(
    () => ALL_ITEMS.filter((i) => checked[i.key] && (!i.allBranchesOnly || isAllBranches)),
    [checked, isAllBranches],
  );

  const branchLabel = !branchId
    ? "—"
    : isAllBranches
    ? "كل الفروع"
    : branches.find((b) => b.id === branchId)?.name ?? "—";

  const run = async () => {
    if (!branchId || effectiveChecked.length === 0 || confirmWord.trim() !== "تأكيد") {
      toast.error("اختر الفرع والبنود واكتب كلمة التأكيد أولاً");
      return;
    }
    setBusy(true);
    try {
      const p_branch_id = isAllBranches ? null : branchId;
      const options: Record<string, boolean> = {};
      let wantsVouchers = false;
      for (const item of effectiveChecked) {
        if (item.rpc === "vouchers") wantsVouchers = true;
        (item.options ?? []).forEach((k) => { options[k] = true; });
      }

      if (Object.keys(options).length > 0) {
        const { error } = await supabase.rpc("admin_reset_branch_data", { p_branch_id, p_options: options } as any);
        if (error) throw error;
      }
      if (wantsVouchers) {
        const { error } = await supabase.rpc("admin_reset_vouchers", { p_branch_id } as any);
        if (error) throw error;
      }

      toast.success("تم مسح البيانات المحددة");
      setOpen(false);
      setChecked({});
      setConfirmWord("");
    } catch (e: any) {
      toast.error(e?.message || "خطأ في تنفيذ المسح");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 max-w-5xl mx-auto">
        <div className="card-elevated p-6 space-y-4 border border-destructive/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-bold text-destructive">مسح البيانات التجريبية / إعادة تشغيل بيانات الفروع</h2>
              <p className="text-sm text-muted-foreground mt-1">
                الإجراء يحذف نهائيًا البنود المحددة من الفرع المختار فقط ولا يمكن التراجع عنه.
                الأرشيف التاريخي والمصاريف/الإيداعات الشخصية للمالك لا تُمس نهائياً.
              </p>
            </div>
          </div>

          <div className="max-w-sm">
            <Label>الفرع</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر فرع" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">كل الفروع</SelectItem>
                {branches.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="card-elevated p-5 space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Icon className="w-5 h-5 text-primary" />
                  <h3 className="font-bold">{card.title}</h3>
                </div>
                <div className="space-y-2">
                  {card.items.map((item) => {
                    const disabled = !!item.allBranchesOnly && !isAllBranches;
                    const row = (
                      <label
                        className={`flex items-start gap-2 p-2 rounded border transition-colors ${
                          disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"
                        }`}
                      >
                        <Checkbox
                          className="mt-0.5"
                          disabled={disabled}
                          checked={!!checked[item.key] && !disabled}
                          onCheckedChange={(v) => setChecked((s) => ({ ...s, [item.key]: !!v }))}
                        />
                        <span className="text-sm">
                          <span className="font-semibold">{item.label}</span>
                          <span className="block text-xs text-muted-foreground mt-0.5">{item.hint}</span>
                        </span>
                        {disabled && <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
                      </label>
                    );
                    return disabled ? (
                      <Tooltip key={item.key}>
                        <TooltipTrigger asChild><div>{row}</div></TooltipTrigger>
                        <TooltipContent>مسح الأصناف متاح فقط عند اختيار «كل الفروع»</TooltipContent>
                      </Tooltip>
                    ) : (
                      <div key={item.key}>{row}</div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={!branchId || effectiveChecked.length === 0}
            onClick={() => { setConfirmWord(""); setOpen(true); }}
          >
            <Trash2 className="w-4 h-4 ml-1" /> مسح البيانات
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> تحليل أثر عملية المسح
            </DialogTitle>
            <DialogDescription className="text-foreground/80 pt-1">
              راجع التبعات كويس قبل ما تكمّل — النطاق: <b>{branchLabel}</b>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-[55vh] overflow-y-auto pl-1">
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <div className="text-sm font-bold mb-2">العناصر التي سيتم حذفها</div>
              <ul className="list-disc pr-5 space-y-1 text-sm">
                {effectiveChecked.map((i) => (<li key={i.key}>{i.label}</li>))}
              </ul>
            </div>

            <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3">
              <div className="text-sm font-bold text-destructive mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> الآثار والتبعات المترتبة على هذا الإجراء
              </div>
              <ul className="space-y-1.5 text-sm text-foreground/90">
                {effectiveChecked.map((i) => (
                  <li key={i.key}>
                    <span className="font-semibold">{i.label}:</span> {i.impact}
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-sm font-bold text-destructive">هذا الإجراء لا يمكن التراجع عنه.</div>
            </div>

            <div className="rounded-xl border border-success/50 bg-success/10 p-3">
              <div className="text-sm font-bold text-success mb-2 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" /> ما سيبقى محمياً بالكامل
              </div>
              <ul className="list-disc pr-5 space-y-1 text-sm text-foreground/90">
                <li>الأرشيف التاريخي (فواتير وسندات السنوات السابقة) لا يُمس نهائياً.</li>
                <li>المصاريف والإيداعات الشخصية للمالك محمية بالكامل.</li>
                <li>بيانات فروع الشركة وإعداداتها الأساسية تفضل زي ما هي.</li>
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <Label>اكتب كلمة <b>تأكيد</b> للمتابعة</Label>
            <Input value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} placeholder="تأكيد" />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>إلغاء</Button>
            <Button
              variant="destructive"
              disabled={busy || confirmWord.trim() !== "تأكيد" || !branchId || effectiveChecked.length === 0}
              onClick={run}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "نفّذ المسح"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
