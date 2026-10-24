import { useEffect, useState } from "react";
import { PermTable } from "@/components/PermTable";
import { Link } from "react-router-dom";
import { Loader2, ArrowUpLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, sanitizeOperationalDescription } from "@/lib/format";
import type { RecentDoc } from "@/lib/recentDocs";

type Line = { name: string; qty: number; price: number; total: number };
type Meta = { notes: string | null; payment: string | null; recipient: string | null };

const PAY: Record<string, string> = {
  cash: "كاش", installment: "تقسيط", bank: "بنكي", transfer: "تحويل", credit: "آجل", balance: "رصيد", mixed: "متعدد",
};
const payLabel = (v?: string | null) => (v ? PAY[v] ?? v : null);

/** Read-only inline details for a recent document (line items + notes + payment). */
export function RecentDocDetails({ doc }: { doc: RecentDoc }) {
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [meta, setMeta] = useState<Meta>({ notes: null, payment: null, recipient: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      let l: Line[] = [];
      let m: Meta = { notes: null, payment: null, recipient: null };
      if (doc.kind === "sale") {
        const [h, it] = await Promise.all([
          supabase.from("invoices").select("notes, payment_method, recipient_name").eq("id", doc.id).maybeSingle(),
          supabase.from("invoice_items").select("product_name, quantity, final_price, selling_price, total").eq("invoice_id", doc.id),
        ]);
        m = { notes: h.data?.notes ?? null, payment: payLabel(h.data?.payment_method), recipient: h.data?.recipient_name ?? null };
        l = (it.data ?? []).map((r: any) => ({ name: r.product_name, qty: Number(r.quantity), price: Number(r.final_price ?? r.selling_price ?? 0), total: Number(r.total) }));
      } else if (doc.kind === "purchase") {
        const [h, it] = await Promise.all([
          supabase.from("shipments").select("notes, received_by").eq("id", doc.id).maybeSingle(),
          supabase.from("shipment_items").select("product_name, quantity, cost_price, total").eq("shipment_id", doc.id),
        ]);
        m = { notes: h.data?.notes ?? null, payment: null, recipient: (h.data as any)?.received_by ?? null };
        l = (it.data ?? []).map((r: any) => ({ name: r.product_name, qty: Number(r.quantity), price: Number(r.cost_price), total: Number(r.total) }));
      } else if (doc.kind === "sale_return") {
        const [h, it] = await Promise.all([
          supabase.from("returns").select("notes, refund_method, recipient_name").eq("id", doc.id).maybeSingle(),
          supabase.from("return_items").select("quantity, refund, products(name)").eq("return_id", doc.id),
        ]);
        m = { notes: h.data?.notes ?? null, payment: payLabel(h.data?.refund_method), recipient: h.data?.recipient_name ?? null };
        l = (it.data ?? []).map((r: any) => { const q = Number(r.quantity); const t = Number(r.refund); return { name: r.products?.name ?? "—", qty: q, price: q ? t / q : 0, total: t }; });
      } else {
        const [h, it] = await Promise.all([
          supabase.from("purchase_returns").select("notes, refund_method, recipient_name").eq("id", doc.id).maybeSingle(),
          supabase.from("purchase_return_items").select("product_name, quantity, unit_cost, total").eq("purchase_return_id", doc.id),
        ]);
        m = { notes: h.data?.notes ?? null, payment: payLabel(h.data?.refund_method), recipient: h.data?.recipient_name ?? null };
        l = (it.data ?? []).map((r: any) => ({ name: r.product_name, qty: Number(r.quantity), price: Number(r.unit_cost), total: Number(r.total) }));
      }
      if (alive) { setLines(l); setMeta(m); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [doc.id, doc.kind]);

  if (loading) {
    return <div className="p-4 flex justify-center bg-muted/40 shadow-inner"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  }

  const notes = meta.notes ? sanitizeOperationalDescription(meta.notes) : "";

  return (
    <div className="bg-muted/40 p-4 border-b rounded-b-md shadow-inner space-y-3 animate-fade-in" onClick={(e) => e.stopPropagation()}>
      {lines.length ? (
        <PermTable className="w-full text-sm border border-border/60 rounded-md overflow-hidden">
          <thead className="bg-surface-2">
            <tr>
              <th className="p-2 w-10 text-center">#</th>
              <th className="p-2 text-right">الصنف / المنتج</th>
              <th className="p-2 text-center">الكمية</th>
              <th className="p-2 text-center">السعر</th>
              <th className="p-2 text-center">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((r, i) => (
              <tr key={i} className="border-t border-border/40 bg-card">
                <td className="p-2 text-center text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="p-2 text-right">{r.name}</td>
                <td className="p-2 text-center tabular-nums">{r.qty}</td>
                <td className="p-2 text-center tabular-nums">{formatEGP(r.price)}</td>
                <td className="p-2 text-center tabular-nums font-semibold">{formatEGP(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </PermTable>
      ) : (
        <p className="text-sm text-muted-foreground text-center">لا توجد أصناف</p>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div><span className="text-muted-foreground">الملاحظات / البيان: </span><bdi dir="rtl">{notes || "—"}</bdi></div>
        {meta.payment && <div><span className="text-muted-foreground">طريقة السداد: </span>{meta.payment}</div>}
        {meta.recipient && <div><span className="text-muted-foreground">المستلم: </span><bdi dir="rtl">{meta.recipient}</bdi></div>}
        <Link to={doc.path} className="ms-auto inline-flex items-center gap-1 text-primary hover:underline">
          عرض المستند كاملًا <ArrowUpLeft className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
