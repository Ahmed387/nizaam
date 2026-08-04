import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronLeft, Trash2, Plus, Wand2, Search } from "lucide-react";
import type { LegacyDoc, LegacyItem } from "@/lib/legacySheetParser";
import { formatEGP } from "@/lib/format";
import { confirmAlert } from "@/components/ConfirmDialog";

/**
 * محرر المستندات قبل الاعتماد.
 * اليوزر يقدر يمسح فاتورة، يمسح صنف، يعدّل اسم/سعر/كمية/تاريخ/حساب — كله في الذاكرة قبل أي ترحيل.
 */

interface Props {
  docs: LegacyDoc[];
  onChange: (docs: LegacyDoc[]) => void;
}

const r2 = (n: number) => +(Number(n) || 0).toFixed(2);

function recalcItem(it: LegacyItem): LegacyItem {
  return { ...it, total: r2(it.qty * it.price - it.discount) };
}

function recalcDoc(d: LegacyDoc): LegacyDoc {
  const items = d.items.map(recalcItem);
  return { ...d, items, itemsTotal: r2(items.reduce((s, i) => s + i.total, 0)) };
}

export function LegacyDocsEditor({ docs, onChange }: Props) {
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
                <Input value={d.account} onChange={(e) => patchDoc(i, { account: e.target.value })}
                  className="h-8 flex-1 min-w-[120px]" placeholder="العميل / المورد" />
                <Badge variant="outline" className="shrink-0">{d.items.length} صنف</Badge>
                <span className={`shrink-0 font-semibold ${diff > 1 ? "text-warning" : ""}`}>{formatEGP(d.headerTotal)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => removeDoc(i)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {open[i] && (
                <div className="p-3 space-y-2 bg-background">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {([
                      ["المخزن", "warehouse", "text"],
                      ["إجمالي الفاتورة", "headerTotal", "number"],
                      ["خصم الفاتورة", "headerDiscount", "number"],
                      ["المدفوع", "paid", "number"],
                      ["المستند الأصلي", "originalNumber", "text"],
                    ] as const).map(([lbl, key, type]) => (
                      <div key={key} className="space-y-1">
                        <div className="text-muted-foreground">{lbl}</div>
                        <Input type={type} className="h-8"
                          value={(d as any)[key] ?? ""}
                          onChange={(e) => patchDoc(i, {
                            [key]: type === "number" ? Number(e.target.value) || 0 : e.target.value,
                          } as any)} />
                      </div>
                    ))}
                  </div>

                  {diff > 1 && (
                    <div className="flex items-center gap-2 text-warning">
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
                          <th className="px-2 py-2 w-20 font-extrabold text-center">كمية</th><th className="px-2 py-2 w-24 font-extrabold text-center">السعر</th>
                          <th className="px-2 py-2 w-24 font-extrabold text-center">خصم</th><th className="px-2 py-2 w-24 font-extrabold text-center">النهائي</th>
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
                            <td className="p-1"><Input type="number" className="h-8" value={it.discount} onChange={(e) => patchItem(i, j, { discount: Number(e.target.value) || 0 })} /></td>
                            <td className="px-2 py-1 font-bold tabular-nums text-center whitespace-nowrap">{formatEGP(it.total)}</td>
                            <td className="p-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(i, j)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {!d.items.length && (
                          <tr><td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">مفيش أصناف — ضيف صنف أو امسح المستند</td></tr>
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
