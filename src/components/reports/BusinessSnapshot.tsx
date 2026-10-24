import { useEffect, useState } from "react";
import { PermTable } from "@/components/PermTable";
import { TrendingUp, TrendingDown, Boxes, Receipt, Wallet, Scale, HandCoins, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorText } from "@/lib/rpcError";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StockMovementReport } from "@/components/reports/StockMovementReport";

type Row = {
  branch_id: string; branch: string; invoices: number; sales: number; returns: number; net_sales: number; cogs: number;
  collected: number; open_credit: number;
  gross_profit: number; expenses: number; net_profit: number; stock_value: number; stock_qty: number; stock_items: number;
  sold_ahead_of_stock: number;
};
type Snapshot = { from: string; to: string; branches: Row[]; total: Omit<Row, "branch_id" | "branch" | "stock_items" | "sold_ahead_of_stock"> };

/** «هل بنكسب ولا بنخسر؟» + «بضاعة كل فرع تساوي كام؟» — one RPC (owner_business_snapshot), per branch and in total. */
export function BusinessSnapshot({ compact = false, defaultFrom }: { compact?: boolean; defaultFrom?: string }) {
  const today = cairoTodayDay();
  const [from, setFrom] = useState(defaultFrom ?? `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setErr(null);
    supabase.rpc("owner_business_snapshot" as any, { p_from: from, p_to: to } as any).then(({ data, error }) => {
      if (off) return;
      if (error) { setErr(rpcErrorText(error, "تقرير «بنكسب ولا بنخسر»")); setData(null); } else setData(data as any);
    });
    return () => { off = true; };
  }, [from, to]);

  const t = data?.total as (Snapshot["total"] & { collected?: number; open_credit?: number }) | undefined;
  const winning = (t?.net_profit ?? 0) >= 0;

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex flex-wrap items-end gap-3">
          <div><Label className="text-xs">من</Label><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
          <div><Label className="text-xs">إلى</Label><Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
          <span className="text-xs text-muted-foreground">الأرقام بتاريخ المستند. المبيعات النشطة بس (الملغاة مش داخلة).</span>
        </div>
      )}
      {err && <div className="text-sm text-destructive">{err}</div>}

      {/* The verdict */}
      <div className={`rounded-2xl border p-5 flex flex-wrap items-center justify-between gap-4 ${winning ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}>
        <div className="flex items-center gap-3">
          {winning ? <TrendingUp className="w-9 h-9 text-success" /> : <TrendingDown className="w-9 h-9 text-destructive" />}
          <div>
            <div className="text-sm text-muted-foreground">{compact ? "الشهر ده لحد النهارده" : `من ${from} إلى ${to}`}</div>
            <div className={`text-2xl font-extrabold ${winning ? "text-success" : "text-destructive"}`}>
              {winning ? "الشركة كسبانة" : "الشركة خسرانة"} {formatEGP(Math.abs(t?.net_profit ?? 0))}
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground leading-6">
          صافي المبيعات {formatEGP(t?.net_sales ?? 0)} − تكلفة البضاعة المباعة {formatEGP(t?.cogs ?? 0)} = مجمل ربح {formatEGP(t?.gross_profit ?? 0)}<br />
          − مصروفات التشغيل {formatEGP(t?.expenses ?? 0)} = <b className="text-foreground">صافي {formatEGP(t?.net_profit ?? 0)}</b>
        </div>
      </div>

      {/* Money: sold vs really received vs still owed */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi icon={<Receipt />} label="المبيعات (صافي)" value={t?.net_sales} hint={`${t?.invoices ?? 0} فاتورة − مرتجعات ${formatEGP(t?.returns ?? 0)}`} />
        <Kpi icon={<HandCoins />} label="المحصّل فعلاً في الإيد" value={t?.collected} hint="كاش + بنك + محفظة دخلت من العملاء في الفترة، ناقص اللي اترد لهم" />
        <Kpi icon={<Clock />} label="الآجل الباقي على العملاء" value={t?.open_credit} hint="اللي لسه ما اتدفعش من فواتير الفترة دي لحد النهارده" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi icon={<Scale />} label="مجمل الربح" value={t?.gross_profit} hint={t?.net_sales ? `هامش ${(((t.gross_profit || 0) / t.net_sales) * 100).toFixed(1)}%` : undefined} />
        <Kpi icon={<Wallet />} label="مصروفات التشغيل" value={t?.expenses} hint="سندات صرف من تصنيفات «تُخصم من الربح»" />
        <Kpi icon={<Boxes />} label="قيمة البضاعة دلوقتي (بالتكلفة)" value={t?.stock_value} hint={`${(t?.stock_qty ?? 0).toLocaleString("en-US")} قطعة في كل الفروع`} />
      </div>

      <div className="card-elevated overflow-x-auto">
        <PermTable className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr className="text-xs">
              {["الفرع", "صافي المبيعات", "المحصّل فعلاً", "الآجل الباقي", "تكلفة المباع", "مجمل الربح", "المصروفات", "صافي الربح", "قيمة البضاعة الآن", "عدد القطع"].map((h) => (
                <th key={h} className="px-3 py-2.5 font-extrabold text-center">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.branches ?? []).map((b) => (
              <tr key={b.branch_id} className="border-t border-border/60 text-center tabular-nums">
                <td className="px-3 py-2 text-right font-semibold">{b.branch}</td>
                <td className="px-3 py-2">{formatEGP(b.net_sales)}</td>
                <td className="px-3 py-2 text-success">{formatEGP(b.collected ?? 0)}</td>
                <td className="px-3 py-2 text-warning">{formatEGP(b.open_credit ?? 0)}</td>
                <td className="px-3 py-2">{formatEGP(b.cogs)}</td>
                <td className="px-3 py-2">{formatEGP(b.gross_profit)}</td>
                <td className="px-3 py-2">{formatEGP(b.expenses)}</td>
                <td className={`px-3 py-2 font-extrabold ${b.net_profit >= 0 ? "text-success" : "text-destructive"}`}>{formatEGP(b.net_profit)}</td>
                <td className="px-3 py-2 font-bold">{formatEGP(b.stock_value)}
                  {b.sold_ahead_of_stock > 0 && <div className="text-[10px] text-warning">بعد خصم {formatEGP(b.sold_ahead_of_stock)} مباع بالسالب</div>}
                </td>
                <td className="px-3 py-2">{Number(b.stock_qty).toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </PermTable>
      </div>
      {!compact && (
        <p className="text-xs text-muted-foreground">
          تكلفة المباع = متوسط تكلفة الصنف في الفرع وقت بيعه × الكمية بعد المرتجع — نفس قيد تكلفة المبيعات في الحسابات.
          قيمة البضاعة = الكمية الموجودة × متوسط التكلفة. سداد الموردين وتحويلات الفروع وسلف الموظفين مش مصروفات ومش محسوبة هنا.
        </p>
      )}
      {!compact && <div className="pt-4 border-t border-border/60"><StockMovementReport from={from} to={to} /></div>}
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value?: number; hint?: string }) {
  const neg = (value ?? 0) < 0;
  return (
    <div className="card-elevated p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs [&_svg]:w-4 [&_svg]:h-4">{icon}{label}</div>
      <div className={`text-xl font-extrabold mt-1 tabular-nums ${neg ? "text-destructive" : ""}`}>{formatEGP(value ?? 0)}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
