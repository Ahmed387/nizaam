// «اختصارات» (owner 2026-11-16 «خلي في تابه اسمها اختصارات عشان تعلمني ازاي استخدمها»): what each shortcut does and
// how to use it, from the same list the sale screen reads (SALE_SHORTCUTS) — taught = what works.
import { SALE_SHORTCUTS } from "@/lib/saleShortcuts";

const Kbd = ({ k }: { k: string }) => (
  <kbd dir="ltr" className="inline-flex min-w-[2rem] justify-center rounded-md border border-b-2 bg-muted px-1.5 py-0.5 font-mono text-xs font-bold">{k}</kbd>
);

export function ShortcutsGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-4" dir="rtl">
      {!compact && (
        <div className="rounded-xl border bg-primary/5 p-4 text-sm leading-relaxed">
          <div className="font-bold mb-1">إزاي تبيع من غير ماوس — فاتورة كاملة في ثواني</div>
          <ol className="list-decimal pr-5 space-y-0.5 text-muted-foreground">
            <li>افتح «فاتورة بيع جديدة» — المؤشر بيكون في خانة البحث لوحده (أو اضغط <Kbd k="F2" />).</li>
            <li>اكتب جزء من اسم الصنف أو الكود، انزل بالسهم <Kbd k="↓" /> واضغط <Kbd k="Enter" /> — الصنف اتضاف والبحث فضي.</li>
            <li>عاوز 3 من نفس الصنف؟ اضغط <Kbd k="+" /> مرتين. غلطت؟ <Kbd k="Delete" /> يشيل آخر صنف.</li>
            <li><Kbd k="F4" /> للعميل (اكتب اسمه أو تليفونه ثم Enter) — لو كاش سيبه فاضي.</li>
            <li>دفع بطريقة غير الكاش أو جزء آجل؟ <Kbd k="F8" /> واكتب المبلغ.</li>
            <li><Kbd k="Ctrl+P" /> يحفظ ويطبع الإيصال، أو <Kbd k="Ctrl+S" /> يحفظ بس.</li>
          </ol>
          <div className="mt-2 text-xs text-muted-foreground">جوه شاشة البيع اضغط <Kbd k="?" /> في أي وقت عشان تشوف القايمة دي.</div>
        </div>
      )}
      <div className="rounded-xl border overflow-hidden">
        {SALE_SHORTCUTS.map((s) => (
          <div key={s.title} className="flex flex-col sm:flex-row sm:items-start gap-2 border-b last:border-b-0 p-3">
            <div className="flex flex-wrap items-center gap-1 sm:w-40 shrink-0">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1">{i > 0 && <span className="text-xs text-muted-foreground">أو</span>}<Kbd k={k} /></span>
              ))}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm">{s.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{s.how}</div>
            </div>
          </div>
        ))}
      </div>
      {!compact && (
        <div className="text-xs text-muted-foreground">
          ملاحظة: <Kbd k="+" /> و <Kbd k="-" /> و <Kbd k="Delete" /> بيشتغلوا وخانة البحث فاضية، أو والمؤشر برّه أي خانة — جوه خانة الكمية أو السعر بتكتب عادي.
          على الماك استخدم <Kbd k="⌘" /> بدل Ctrl.
        </div>
      )}
    </div>
  );
}
