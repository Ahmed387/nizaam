import { useEffect, useState } from "react";
import { PermCard } from "@/contexts/PermCustomize";
import { Percent, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
import { formatEGP } from "@/lib/format";

type FeeRow = { payment_method: string | null; amount: number; type: string };

/**
 * «عمولات التحويل» — كارت لكل وسيلة (محفظة / انستاباي / بنك …):
 *   نسبة العمولة المتسجلة في الإعدادات + اتدفع كام عمولة في الفترة وعدد العمليات.
 * مين بيدخل العمولة؟ محدش بيكتبها بإيده: المدير بيحدد النسبة أو المبلغ الثابت مرة واحدة في
 * الإعدادات ← طرق الدفع والعمولات، والسيرفر بيحسبها لوحده في كل عملية (H-08) ويكتب سطر خزنة واحد
 * للعمولة (is_fee = true) في نفس الفرع.
 */
export function TransferFeeCards({ branchId, from, to }: { branchId?: string | null; from?: string; to?: string }) {
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [rows, setRows] = useState<FeeRow[] | null>(null);

  useEffect(() => { loadAllPaymentMethods().then((m) => setMethods(m.filter((x) => x.value !== "cash"))); }, []);

  useEffect(() => {
    let off = false;
    setRows(null);
    fetchAllRows<FeeRow>(() => {
      let q: any = supabase.from("treasury").select("id,payment_method,amount,type").eq("is_fee", true);
      if (branchId) q = q.eq("branch_id", branchId);
      if (from) q = q.gte("transaction_date", from);
      if (to) q = q.lte("transaction_date", to);
      return q.order("id");
    }).then((d) => { if (!off) setRows(d); }).catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, [branchId, from, to]);

  const by = new Map<string, { total: number; count: number }>();
  for (const r of rows ?? []) {
    const k = r.payment_method ?? "other";
    const cur = by.get(k) ?? { total: 0, count: 0 };
    // an expense row is a fee paid; an income row of a fee is its reversal (cancelled document)
    cur.total += r.type === "income" ? -Number(r.amount) : Number(r.amount);
    cur.count += r.type === "income" ? -1 : 1;
    by.set(k, cur);
  }
  const total = [...by.values()].reduce((s, x) => s + x.total, 0);
  const keys = [...new Set([...methods.map((m) => m.value), ...by.keys()])];
  const label = (k: string) => methods.find((m) => m.value === k)?.label ?? k;
  const rate = (k: string) => {
    const m = methods.find((x) => x.value === k);
    if (!m || !m.fee_value) return "مفيش عمولة متسجلة";
    return m.fee_type === "percentage" ? `${m.fee_value}% من المبلغ` : `${formatEGP(m.fee_value)} ثابت للعملية`;
  };

  return (
    <div className="card-elevated p-4 mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Percent className="w-5 h-5 text-warning" />
        <h3 className="font-extrabold">عمولات التحويل (محافظ / انستاباي / بنك)</h3>
        <span className="ms-auto text-sm">إجمالي العمولات في الفترة: <b className="text-destructive tabular-nums">{formatEGP(total)}</b></span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {keys.map((k) => {
          const v = by.get(k) ?? { total: 0, count: 0 };
          return (
            <PermCard key={k} label={`عمولة ${label(k)}`}><div className="rounded-xl border border-border p-3 bg-surface-2/50">
              <div className="font-bold">{label(k)}</div>
              <div className="text-[11px] text-muted-foreground">{rate(k)}</div>
              <div className="mt-2 text-xl font-extrabold tabular-nums text-destructive">{rows === null ? "…" : formatEGP(v.total)}</div>
              <div className="text-[11px] text-muted-foreground">{v.count} عملية عليها عمولة</div>
            </div></PermCard>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground leading-6 flex gap-1.5">
        <Info className="w-3.5 h-3.5 mt-1 shrink-0" />
        العمولة محدش بيكتبها بإيده: المدير بيحدد نسبتها أو مبلغها الثابت مرة واحدة من «الإعدادات ← طرق الدفع والعمولات»،
        والسيستم بيحسبها لوحده في كل عملية بالوسيلة دي وبيخصمها من الخزنة كسطر منفصل «عمولة». الكروت دي بتجمعها لكل وسيلة.
      </p>
    </div>
  );
}
