import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronLeft, Trash2, Plus, Wand2, Search } from "lucide-react";
import type { LegacyDoc, LegacyItem } from "@/lib/legacySheetParser";
import type { ColumnKey } from "@/lib/legacyTemplate";
import { formatEGP } from "@/lib/format";
import { confirmAlert } from "@/components/ConfirmDialog";
import { LegacyContactPicker } from "@/components/legacy/LegacyContactPicker";

/**
 * محرر المستندات قبل الاعتماد.
 * اليوزر يقدر يمسح فاتورة، يمسح صنف، يعدّل اسم/سعر/كمية/تاريخ/حساب — كله في الذاكرة قبل أي ترحيل.
 */

interface Props {
  docs: LegacyDoc[];
  onChange: (docs: LegacyDoc[]) => void;
  /** الأعمدة الناقصة في الشيت — بتتعرض كخانات صفراء تعدّلها بإيدك قبل الاعتماد */
  missing?: ColumnKey[];
}


const r2 = (n: number) => +(Number(n) || 0).toFixed(2);

function recalcItem(it: LegacyItem): LegacyItem {
  return { ...it, total: r2(it.qty * it.price - it.discount) };
}

function recalcDoc(d: LegacyDoc): LegacyDoc {
  const items = d.items.map(recalcItem);
  return { ...d, items, itemsTotal: r2(items.reduce((s, i) => s + i.total, 0)) };
}

export function LegacyDocsEditor({ docs, onChange, missing = [] }: Props) {
  const miss = useMemo(() => new Set(missing), [missing]);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return docs.map((d, i) => ({ d, i }));
    return docs
      .map((d, i) => ({ d, i }))
      .filter(({ d }) =>
        d.legacyNumber.toLowerCase().includes(t) ||
        (d.account || "").toLowerCase().includes(t) ||
        d.items.some((it) => it.name.toLowerCase().includes(t) || (it.code || "").toLowerCase().includes(t)),
      );
  }, [docs, q]);

  const patchDoc = (i: number, patch: Partial<LegacyDoc>) => {
    const next = [...docs];
    next[i] = recalcDoc({ ...next[i], ...patch });
    onChange(next);
  };

  const patchItem = (di: number, ii: number, patch: Partial<LegacyItem>) => {
    const items = [...docs[di].items];
    items[ii] = { ...items[ii], ...patch };
    patchDoc(di, { items });
  };

  const removeItem = (di: number, ii: number) => {
    patchDoc(di, { items: docs[di].items.filter((_, x) => x !== ii) });
  };

  const addItem = (di: number) => {
    patchDoc(di, {
      items: [...docs[di].items, {
        code: "", name: "", qty: 1, price: 0, discount: 0, total: 0,
        cost: 0, marketPrice: 0, discountPercent: 0,
        barcode: "", unit: "", brand: "", model: "", category: "",
      }],
    });
    setOpen((o) => ({ ...o, [di]: true }));
  };


  const removeDoc = async (di: number) => {
    const ok = await confirmAlert({
      title: `هتمسح المستند #${docs[di].legacyNumber || "بدون رقم"}؟`,
      description: "المستند ده هيتشال من الدفعة ومش هيترحّل خالص. المسح من هنا مبيأثرش على أي حاجة اتسجلت قبل كده.",
      confirmLabel: "أيوه، امسحه",
      cancelLabel: "لأ، سيبه",
      tone: "danger",
    });
    if (!ok) return;
    onChange(docs.filter((_, x) => x !== di));
  };

  const matchTotal = (di: number) => patchDoc(di, { headerTotal: r2(docs[di].itemsTotal - docs[di].headerDiscount) });

  const total = r2(docs.reduce((s, d) => s + d.headerTotal, 0));

  return (
    <div className="border-2 border-primary/30 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-primary/10 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">
          مراجعة وتعديل البيانات قبل الاعتماد — {docs.length} مستند · {formatEGP(total)}
        </div>
        <div className="relative w-56">
          <Search className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر برقم/حساب/صنف" className="h-8 pr-7 text-xs" />
        </div>
      </div>

      {miss.size > 0 && (
        <div className="px-3 py-2.5 text-xs font-medium leading-6 bg-destructive text-destructive-foreground border-b border-destructive">
          <b className="font-extrabold">⚠ أعمدة ناقصة في الشيت:</b> النظام حطّ فيها قيمة افتراضية (٠ أو فاضي) وعلّمها بإطار أحمر تحت — عدّلها قبل الاعتماد.
        </div>
      )}


      <div className="max-h-[520px] overflow-y-auto divide-y animate-fade-in">
        {filtered.map(({ d, i }) => {
          const diff = Math.abs(r2(d.itemsTotal - d.headerTotal));
          return (
            <div key={`${i}-${d.row}`} className="text-xs">
              <div className="flex items-center gap-2 px-2 py-2 bg-surface-2/50 hover:bg-primary/5 transition-colors">
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                  {open[i] ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </Button>
                <Input value={d.legacyNumber} onChange={(e) => patchDoc(i, { legacyNumber: e.target.value })}
                  className="h-8 w-24 font-semibold" placeholder="رقم" />
                <Input type="datetime-local" value={d.dateISO ? d.dateISO.slice(0, 16) : ""}
                  onChange={(e) => patchDoc(i, { dateISO: e.target.value ? `${e.target.value}:00` : "" })}
                  className="h-8 w-44" />
                <div className="flex-1 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                  <LegacyContactPicker value={d.account} type={partyType}
                    onChange={(name) => patchDoc(i, { account: name })} />
                </div>
                <Badge variant="outline" className="shrink-0">{d.items.length} صنف</Badge>
                <span className={`shrink-0 font-semibold ${diff > 1 ? "text-destructive" : ""}`}>{formatEGP(d.headerTotal)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => removeDoc(i)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {open[i] && (
                <div className="p-3 space-y-2 bg-background">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {([
                      ["المخزن", "warehouse", "text", "warehouse"],
                      ["إجمالي الفاتورة", "headerTotal", "number", null],
                      ["خصم الفاتورة", "headerDiscount", "number", "headerDiscount"],
                      ["الضريبة", "tax", "number", "headerDiscount"],
                      ["المدفوع", "paid", "number", "payments"],
                      ["الآجل", "credit", "number", "credit"],
                      ["المستند الأصلي", "originalNumber", "text", "original"],
                      ["البائع", "salesperson", "text", "productInfo"],
                    ] as const).map(([lbl, key, type, mk]) => {
                      const isMissing = !!mk && miss.has(mk as ColumnKey);
                      return (
                        <div key={key} className="space-y-1">
                          <div className={isMissing ? "text-destructive font-semibold" : "text-muted-foreground"}>
                            {lbl}{isMissing ? " • ناقص" : ""}
                          </div>
                          <Input type={type} className={`h-8 ${isMissing ? "border-destructive/60 bg-destructive/10" : ""}`}
                            title={isMissing ? "العمود ده مش موجود في الشيت — القيمة دي افتراضية، عدّلها" : undefined}
                            value={(d as any)[key] ?? ""}
                            onChange={(e) => patchDoc(i, {
                              [key]: type === "number" ? Number(e.target.value) || 0 : e.target.value,
                            } as any)} />
                        </div>
                      );
                    })}
                  </div>


                  {diff > 1 && (
                    <div className="flex items-center gap-2 text-destructive">
                      مجموع السطور {formatEGP(d.itemsTotal)} مش مطابق لإجمالي الفاتورة {formatEGP(d.headerTotal)}
                      <Button size="sm" variant="outline" className="h-7" onClick={() => matchTotal(i)}>
                        <Wand2 className="w-3 h-3 ml-1" /> طابق الإجمالي مع السطور
                      </Button>
                    </div>
                  )}

                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full border-collapse">
                      <thead className="bg-surface-2">
                        <tr className="border-b-2 border-border">
                          <th className="px-2 py-2 w-28 font-extrabold text-center">كود المنتج</th>
                          <th className="px-2 py-2 font-extrabold text-center">اسم الصنف</th>
                          <th className="px-2 py-2 w-20 font-extrabold text-center">كمية</th>
                          <th className="px-2 py-2 w-24 font-extrabold text-center">السعر</th>
                          <th className={`px-2 py-2 w-24 font-extrabold text-center ${miss.has("cost") ? "text-destructive" : ""}`}>التكلفة{miss.has("cost") ? " • ناقص" : ""}</th>
                          <th className={`px-2 py-2 w-24 font-extrabold text-center ${miss.has("marketPrice") ? "text-destructive" : ""}`}>سعر السوق{miss.has("marketPrice") ? " • ناقص" : ""}</th>
                          <th className="px-2 py-2 w-24 font-extrabold text-center">خصم</th>
                          {miss.has("lineDiscount") && <th className="px-2 py-2 w-20 font-extrabold text-center text-destructive">خصم % • ناقص</th>}
                          {miss.has("productInfo") && (
                            <>
                              <th className="px-2 py-2 w-20 font-extrabold text-center text-destructive">وحدة • ناقص</th>
                              <th className="px-2 py-2 w-28 font-extrabold text-center text-destructive">باركود • ناقص</th>
                              <th className="px-2 py-2 w-24 font-extrabold text-center text-destructive">ماركة • ناقص</th>
                              <th className="px-2 py-2 w-24 font-extrabold text-center text-destructive">موديل • ناقص</th>
                              <th className="px-2 py-2 w-24 font-extrabold text-center text-destructive">تصنيف • ناقص</th>
                            </>
                          )}
                          <th className="px-2 py-2 w-24 font-extrabold text-center">النهائي</th>
                          <th className="px-2 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.items.map((it, j) => (
                          <tr key={j} className={`border-b border-border/50 transition-colors hover:bg-primary/5 ${j % 2 ? "bg-surface-2/30" : ""}`}>
                            <td className="p-1"><Input className="h-8 w-24 tabular-nums font-semibold text-center bg-primary/5 border-primary/20" placeholder="كود" value={it.code} onChange={(e) => patchItem(i, j, { code: e.target.value })} /></td>
                            <td className="p-1"><Input className="h-8" value={it.name} onChange={(e) => patchItem(i, j, { name: e.target.value })} /></td>
                            <td className="p-1"><Input type="number" className="h-8" value={it.qty} onChange={(e) => patchItem(i, j, { qty: Number(e.target.value) || 0 })} /></td>
                            <td className="p-1"><Input type="number" className="h-8" value={it.price} onChange={(e) => patchItem(i, j, { price: Number(e.target.value) || 0 })} /></td>
                            <td className="p-1">
                              <Input type="number" title="سعر التكلفة — لو صفر النظام هياخد آخر تكلفة للمنتج"
                                className={`h-8 ${!it.cost ? "border-destructive/60 bg-destructive/10" : ""}`}
                                value={it.cost} onChange={(e) => patchItem(i, j, { cost: Number(e.target.value) || 0 })} />
                            </td>
                            <td className="p-1"><Input type="number" className={`h-8 ${!it.marketPrice ? "border-destructive/60 bg-destructive/10" : ""}`} value={it.marketPrice} onChange={(e) => patchItem(i, j, { marketPrice: Number(e.target.value) || 0 })} /></td>
                            <td className="p-1"><Input type="number" className="h-8" value={it.discount} onChange={(e) => patchItem(i, j, { discount: Number(e.target.value) || 0 })} /></td>
                            {miss.has("lineDiscount") && (
                              <td className="p-1"><Input type="number" className="h-8 border-destructive/60 bg-destructive/10" value={it.discountPercent} onChange={(e) => patchItem(i, j, { discountPercent: Number(e.target.value) || 0 })} /></td>
                            )}
                            {miss.has("productInfo") && (
                              <>
                                {(["unit", "barcode", "brand", "model", "category"] as const).map((f) => (
                                  <td key={f} className="p-1">
                                    <Input className="h-8 border-destructive/60 bg-destructive/10" value={(it as any)[f] ?? ""}
                                      onChange={(e) => patchItem(i, j, { [f]: e.target.value } as any)} />
                                  </td>
                                ))}
                              </>
                            )}
                            <td className="px-2 py-1 font-bold tabular-nums text-center whitespace-nowrap">{formatEGP(it.total)}</td>
                            <td className="p-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(i, j)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}

                        {!d.items.length && (
                          <tr><td colSpan={9} className="px-2 py-3 text-center text-muted-foreground">مفيش أصناف — ضيف صنف أو امسح المستند</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <Button size="sm" variant="outline" className="h-7" onClick={() => addItem(i)}>
                    <Plus className="w-3 h-3 ml-1" /> ضيف صنف
                  </Button>

                </div>
              )}
            </div>
          );
        })}
        {!filtered.length && <div className="p-4 text-center text-xs text-muted-foreground">مفيش نتائج</div>}
      </div>
    </div>
  );
}
