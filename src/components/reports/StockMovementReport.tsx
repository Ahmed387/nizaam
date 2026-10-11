import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Boxes, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { Input } from "@/components/ui/input";

/** One row of branch_stock_report (a branch total, or one product when a branch is opened). */
type Line = {
  branch_id?: string; branch?: string; product_id?: string; name?: string; products?: number;
  opening_qty: number; opening_value: number;
  purchased_qty: number; purchased_value: number;
  transfer_in_qty: number; transfer_in_value: number;
  sale_return_qty: number; sale_return_value: number;
  sold_qty: number; sold_cost: number;
  purchase_return_qty: number; purchase_return_value: number;
  transfer_out_qty: number; transfer_out_value: number;
  count_qty: number; count_value: number;
  unrecorded_qty: number; unrecorded_value: number;
  closing_qty: number; closing_value: number; avg_cost?: number;
};
type Report = { from: string; to: string; live: boolean; branches: Line[]; products: Line[] };

const n = (v: unknown) => Number(v ?? 0);
const qty = (v: unknown) => n(v).toLocaleString("en-US");

/** Column set: [label, qty key, value key, sign shown in the header] */
const COLS: { label: string; q: keyof Line; v: keyof Line; tone?: string }[] = [
  { label: "أول المدة", q: "opening_qty", v: "opening_value" },
  { label: "اشترينا (+)", q: "purchased_qty", v: "purchased_value", tone: "text-success" },
  { label: "مرتجع بيع رجع (+)", q: "sale_return_qty", v: "sale_return_value", tone: "text-success" },
  { label: "تحويل وارد (+)", q: "transfer_in_qty", v: "transfer_in_value", tone: "text-success" },
  { label: "اتباع بالتكلفة (−)", q: "sold_qty", v: "sold_cost", tone: "text-destructive" },
  { label: "مرتجع شراء (−)", q: "purchase_return_qty", v: "purchase_return_value", tone: "text-destructive" },
  { label: "تحويل صادر (−)", q: "transfer_out_qty", v: "transfer_out_value", tone: "text-destructive" },
  { label: "تسوية جرد (بمستند)", q: "count_qty", v: "count_value", tone: "text-warning" },
  { label: "فرق من غير مستند", q: "unrecorded_qty", v: "unrecorded_value", tone: "text-destructive" },
];

/**
 * «المخزون: دخل إيه وطلع إيه وفاضل كام» — per branch, then per product.
 * Every value is at the branch moving average (0071): what came in at its cost, what went out at the average.
 */
export function StockMovementReport({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<Report | null>(null);
  const [branch, setBranch] = useState<{ id: string; name: string } | null>(null);
  const [products, setProducts] = useState<Line[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let off = false;
    setErr(null); setLoading(true);
    supabase.rpc("branch_stock_report" as any, { p_from: from, p_to: to } as any).then(({ data, error }) => {
      if (off) return;
      setLoading(false);
      if (error) { setErr(error.message); setData(null); } else setData(data as any);
    });
    return () => { off = true; };
  }, [from, to]);

  useEffect(() => {
    if (!branch) { setProducts(null); return; }
    let off = false;
    setProducts(null);
    supabase.rpc("branch_stock_report" as any, { p_from: from, p_to: to, p_branch: branch.id } as any).then(({ data, error }) => {
      if (off) return;
      if (error) setErr(error.message); else setProducts(((data as any)?.products ?? []) as Line[]);
    });
    return () => { off = true; };
  }, [branch, from, to]);

  const total = useMemo<Line | null>(() => {
    if (!data?.branches?.length) return null;
    const t: any = {};
    for (const c of COLS) { t[c.q] = 0; t[c.v] = 0; }
    t.closing_qty = 0; t.closing_value = 0;
    for (const b of data.branches) {
      for (const c of COLS) { t[c.q] += n(b[c.q]); t[c.v] += n(b[c.v]); }
      t.closing_qty += n(b.closing_qty); t.closing_value += n(b.closing_value);
    }
    return t as Line;
  }, [data]);

  const shown = useMemo(() => {
    const list = products ?? [];
    const s = q.trim();
    return s ? list.filter((p) => (p.name ?? "").includes(s)) : list;
  }, [products, q]);

  const cells = (r: Line) => (
    <>
      {COLS.map((c) => (
        <td key={c.label} className="px-2 py-2 text-center tabular-nums whitespace-nowrap">
          <div className={`font-semibold ${n(r[c.q]) === 0 ? "text-muted-foreground/50" : c.tone ?? ""}`}>{qty(r[c.q])}</div>
          <div className="text-[11px] text-muted-foreground">{n(r[c.v]) === 0 ? "—" : formatEGP(n(r[c.v]))}</div>
        </td>
      ))}
      <td className="px-2 py-2 text-center tabular-nums whitespace-nowrap bg-primary/5">
        <div className="font-extrabold">{qty(r.closing_qty)}</div>
        <div className="text-[11px] font-bold">{formatEGP(n(r.closing_value))}</div>
      </td>
    </>
  );

  const head = (first: string, withAvg = false) => (
    <thead className="bg-surface-2">
      <tr className="text-xs">
        <th className="px-3 py-2.5 font-extrabold text-right">{first}</th>
        {COLS.map((c) => <th key={c.label} className="px-2 py-2.5 font-extrabold text-center whitespace-nowrap">{c.label}</th>)}
        <th className="px-2 py-2.5 font-extrabold text-center bg-primary/10 whitespace-nowrap">الباقي دلوقتي</th>
        {withAvg && <th className="px-2 py-2.5 font-extrabold text-center whitespace-nowrap">متوسط التكلفة</th>}
      </tr>
      <tr className="text-[10px] text-muted-foreground"><th />{COLS.map((c) => <th key={c.label} className="pb-1.5 font-normal">قطع / قيمة</th>)}<th className="pb-1.5 font-normal">قطع / قيمة</th>{withAvg && <th />}</tr>
    </thead>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Boxes className="w-5 h-5 text-primary" />
        <h3 className="font-extrabold">المخزون: دخل إيه، طلع إيه، وفاضل كام وبكام</h3>
        {branch && (
          <button onClick={() => { setBranch(null); setQ(""); }} className="ms-auto text-xs text-primary hover:underline flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5 rotate-180" /> رجوع لكل الفروع
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-6">
        كل الأرقام بمتوسط التكلفة لكل فرع: اللي دخل بتكلفته، واللي طلع بمتوسط الفرع وقت ما طلع.
        «الباقي دلوقتي» = الكمية الفعلية في المخزن × متوسط التكلفة.
        «تسوية جرد» = كميات اتعدّلت بمستند تسوية (جرد أو تعديل كمية من شاشة المخزون).
        «فرق من غير مستند» = اللي مفيش مستند يفسّره: كمية اتظبطت قبل ما السيستم يسجّل الحركات، أو اتباع قبل ما البضاعة تتسجل.
      </p>
      {err && <div className="text-sm text-destructive">{err}</div>}

      {!branch && (
        <div className={`card-elevated overflow-x-auto ${loading ? "opacity-60" : ""}`}>
          <table className="w-full text-sm">
            {head("الفرع")}
            <tbody>
              {(data?.branches ?? []).map((b) => (
                <tr key={b.branch_id} className="border-t border-border/60 hover:bg-surface-2/60 cursor-pointer"
                    onClick={() => setBranch({ id: b.branch_id!, name: b.branch! })} title="افتح أصناف الفرع">
                  <td className="px-3 py-2 text-right font-semibold whitespace-nowrap text-primary">{b.branch} <span className="text-[10px] text-muted-foreground">({qty(b.products)} صنف)</span></td>
                  {cells(b)}
                </tr>
              ))}
              {total && (
                <tr className="border-t-2 border-border font-extrabold bg-surface-2/60">
                  <td className="px-3 py-2 text-right">الإجمالي</td>
                  {cells(total)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {branch && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{branch.name}</span>
            <div className="relative ms-auto">
              <Search className="w-4 h-4 absolute top-2.5 start-2.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على صنف" className="h-9 w-64 ps-8" />
            </div>
          </div>
          <div className="card-elevated overflow-x-auto">
            <table className="w-full text-sm">
              {head("الصنف", true)}
              <tbody>
                {products === null && <tr><td colSpan={COLS.length + 3} className="p-6 text-center text-muted-foreground">بيحمّل...</td></tr>}
                {shown.map((p) => (
                  <tr key={p.product_id} className="border-t border-border/60">
                    <td className="px-3 py-2 text-right font-medium max-w-[280px]">{p.name}</td>
                    {cells(p)}
                    <td className="px-2 py-2 text-center tabular-nums whitespace-nowrap">{formatEGP(n(p.avg_cost))}</td>
                  </tr>
                ))}
                {products !== null && shown.length === 0 && <tr><td colSpan={COLS.length + 3} className="p-6 text-center text-muted-foreground">مفيش أصناف</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
