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
import { AlertTriangle, Loader2, Trash2, Wallet, Boxes, Users2, Settings2, Info } from "lucide-react";

/** كل بند = خيار مستقل بالكامل بـ state خاص به */
interface ResetItem {
  key: string;
  label: string;
  hint: string;
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
      { key: "sales", label: "فواتير المبيعات وأقساطها", hint: "يمسح الفواتير والدفعات التابعة لها للفرع فقط.", options: ["sales"] },
      { key: "sale_returns", label: "مرتجعات المبيعات", hint: "يمسح فواتير الإرجاع وسنداتها للفرع فقط.", options: ["returns"] },
      { key: "purchases", label: "فواتير الشراء ومدفوعات الموردين", hint: "يمسح شحنات الوارد ودفعات الموردين للفرع فقط.", options: ["shipments"] },
      { key: "purchase_returns", label: "مرتجعات الشراء", hint: "يمسح مرتجعات البضاعة للموردين للفرع فقط.", options: ["purchase_returns"] },
      { key: "treasury", label: "حركات الخزينة والمصروفات التشغيلية", hint: "يمسح حركات الكاش والتحويلات للفرع فقط.", options: ["treasury"] },
      { key: "vouchers", label: "السندات اليدوية", hint: "يمسح سندات القبض والصرف التابعة للفرع فقط.", rpc: "vouchers" },
      { key: "voucher_sequences", label: "تصفير عداد ترقيم السندات", hint: "يُعيد ضبط تسلسل السندات ليبدأ من #1 مجدداً.", options: ["voucher_sequences"] },
    ],
  },
  {
    title: "المخزون والمنتجات",
    icon: Boxes,
    items: [
      { key: "inventory", label: "تصفير كميات المخزون", hint: "يُصفر الأرصدة للفرع المختار فقط مع الإبقاء على كروت المنتجات والباركود والأسعار.", options: ["inventory"] },
      { key: "stock_movements", label: "سجل حركات وبنود الجرد والتحويلات", hint: "يمسح كارت الصنف والتحويلات وجلسات الجرد للفرع فقط.", options: ["stock_movements", "count_moves"] },
      { key: "products", label: "حذف بطاقات المنتجات نهائياً", hint: "متاح فقط عند اختيار «كل الفروع» — يمسح الأصناف ذاتها من النظام.", options: ["products"], allBranchesOnly: true },
    ],
  },
  {
    title: "الموارد البشرية وجهات التعامل",
    icon: Users2,
    items: [
      { key: "payroll", label: "سجلات الرواتب والسلف والحضور", hint: "يمسح حركات الصرف والحضور مع الإبقاء على حسابات الموظفين.", options: ["payroll"] },
      { key: "employees", label: "حذف ملفات وحسابات الموظفين", hint: "يمسح حسابات الموظفين المعينين على الفرع المختار.", options: ["employees"] },
      { key: "customer_balances", label: "أرصدة وسجلات ديون العملاء", hint: "يُصفر الرصيد وسجل الائتمان مع الحفاظ على اسم وبيانات العميل.", options: ["customer_balances"] },
      { key: "orphan_contacts", label: "جهات الاتصال غير المرتبطة بحركات", hint: "يمسح العملاء/الموردين اللي ملهمش أي فواتير أو سندات مسجلة.", options: ["orphan_contacts"] },
    ],
  },
  {
    title: "النظام والتشغيل الإداري",
    icon: Settings2,
    items: [
      { key: "shifts", label: "الورديات المعلقة وأرصدة الأدراج", hint: "يمسح سجلات الورديات المفتوحة وتسليم العهد للفرع فقط.", options: ["shifts"] },
      { key: "fiscal_periods", label: "فترات الإغلاق السابقة", hint: "يحذف إقفالات الشهور والفروع لمنع أخطاء الحظر.", options: ["fiscal_periods"] },
      { key: "attachments", label: "المرفقات والملفات اليتيمة", hint: "ينظف المرفقات التالفة غير المرتبطة بأي مستند.", options: ["attachments"] },
      { key: "logs", label: "سجل العمليات والإشعارات", hint: "يُفرغ سجل العمليات والإشعارات وطلبات الاعتماد التابعة للفرع.", options: ["audit_log", "notifications", "approvals"] },
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> تأكيد مسح البيانات
            </DialogTitle>
            <DialogDescription className="text-foreground/80 pt-2">
              هتمسح من <b>{branchLabel}</b>:
              <br />
              <b>{effectiveChecked.map((i) => i.label).join(" + ")}</b>
              <br />
              <span className="text-destructive font-semibold">هذا الإجراء لا يمكن التراجع عنه.</span>
            </DialogDescription>
          </DialogHeader>
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
