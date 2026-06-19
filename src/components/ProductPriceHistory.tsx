import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, formatEGP } from "@/lib/format";
import { Sparkles, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { toast } from "sonner";

const PRICE_TYPE_LABEL: Record<string, string> = {
  selling_price: "سعر البيع",
  cost_price: "سعر التكلفة",
  market_price: "سعر السوق",
  min_price: "الحد الأدنى",
  discount_limit: "حد الخصم",
  shipping_cost: "تكلفة الشحن",
  true_unit_cost: "التكلفة الحقيقية",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "يدوي",
  shipment: "شحنة",
  price_list_import: "استيراد",
  system: "النظام",
};

export function ProductPriceHistory({ productId }: { productId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from("price_audit_log")
      .select("*")
      .eq("entity_id", productId)
      .order("created_at", { ascending: false })
      .limit(200);
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!productId) return;
    load();
    const ch = supabase
      .channel(`price-history-${productId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "price_audit_log", filter: `entity_id=eq.${productId}` },
        (payload: any) => {
          setRows((prev) => [payload.new, ...prev]);
          toast.info(`تم تعديل سعر هذا المنتج للتو بواسطة ${payload.new.changed_by_name ?? ""}`);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [productId]);

  if (loading) return <div className="card-elevated p-6 text-center text-muted-foreground">جاري التحميل...</div>;
  if (!rows.length) return <div className="card-elevated p-6 text-center text-muted-foreground">لا يوجد تاريخ تعديلات</div>;

  return (
    <div className="card-elevated p-4">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-primary" />
        <h3 className="font-bold">تاريخ تعديلات السعر</h3>
        <span className="text-xs text-muted-foreground">({rows.length})</span>
      </div>
      <div className="space-y-3 relative">
        <div className="absolute right-2 top-0 bottom-0 w-px bg-border" />
        {rows.map((r) => {
          const first = r.old_value == null;
          const up = !first && Number(r.new_value) > Number(r.old_value);
          const down = !first && Number(r.new_value) < Number(r.old_value);
          const dotCls = first ? "bg-primary" : up ? "bg-success" : down ? "bg-destructive" : "bg-muted";
          return (
            <div key={r.id} className="relative pr-8">
              <div className={`absolute right-1 top-2 w-3 h-3 rounded-full ${dotCls} ring-4 ring-background`} />
              <div className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</div>
              <div className="font-semibold text-sm mt-0.5 flex flex-wrap items-center gap-2">
                <span>
                  {PRICE_TYPE_LABEL[r.price_type] ?? r.price_type}:{" "}
                  {first ? (
                    <span className="inline-flex items-center gap-1 text-primary"><Sparkles className="w-3 h-3" /> أول تسجيل {formatEGP(r.new_value)}</span>
                  ) : (
                    <span className={up ? "text-success" : "text-destructive"}>
                      {up ? <TrendingUp className="inline w-3 h-3" /> : <TrendingDown className="inline w-3 h-3" />}{" "}
                      {formatEGP(r.old_value)} → {formatEGP(r.new_value)}
                    </span>
                  )}
                </span>
                {r.quantity_at_change != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-muted text-foreground">
                    الكمية: <b>{Number(r.quantity_at_change)}</b>
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                بواسطة: <span className="font-semibold">{r.changed_by_name ?? "—"}</span>
                {r.change_reason && <> — السبب: {r.change_reason}</>}
                {" "}— مصدر: {SOURCE_LABEL[r.source] ?? r.source}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
