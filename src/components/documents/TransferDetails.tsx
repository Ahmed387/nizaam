import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, formatEGP } from "@/lib/format";

type Value = { unit: number; sent: number; received: number; rejected: number };

/**
 * Accordion row under a stock transfer: the item, quantities (sent / received / back to sender),
 * its value at the sender's moving average, who received it and when, and the rejection reason.
 */
export function TransferDetails({ transfer, value, fromName, toName }: { transfer: any; value?: Value; fromName: string; toName: string }) {
  const [product, setProduct] = useState<{ name: string; sku?: string | null; brand?: string | null; model?: string | null } | null>(null);

  useEffect(() => {
    let off = false;
    if (!transfer?.product_id) return;
    supabase.from("products").select("name, sku, brand, model").eq("id", transfer.product_id).maybeSingle()
      .then(({ data }) => { if (!off) setProduct((data as any) ?? null); });
    return () => { off = true; };
  }, [transfer?.product_id]);

  const sent = Number(transfer.quantity) || 0;
  const received = transfer.status === "confirmed" ? Number(transfer.received_quantity ?? transfer.quantity) || 0 : 0;
  const back = transfer.status === "rejected" ? sent : transfer.status === "confirmed" ? Math.max(0, sent - received) : 0;
  const status = transfer.status === "confirmed" ? "اتقبل" : transfer.status === "rejected" ? "اترفض" : "معلق — لسه ما اتأكدش";

  const Cell = ({ label, children, tone = "" }: { label: string; children: React.ReactNode; tone?: string }) => (
    <div className="rounded-lg bg-surface-2/60 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`font-bold tabular-nums ${tone}`}>{children}</div>
    </div>
  );

  return (
    <div className="space-y-3 p-3 text-sm" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-extrabold">{product?.name ?? "…"}</span>
        {product?.sku && <span className="text-xs text-muted-foreground">({product.sku})</span>}
        {(product?.brand || product?.model) && <span className="text-xs text-muted-foreground">{[product?.brand, product?.model].filter(Boolean).join(" • ")}</span>}
        <span className="ms-auto text-xs text-muted-foreground">من {fromName} إلى {toName}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
        <Cell label="الكمية المحوّلة">{sent.toLocaleString("en-US")}</Cell>
        <Cell label="اتقبل" tone="text-success">{received.toLocaleString("en-US")}</Cell>
        <Cell label="رجع للمرسل" tone={back ? "text-destructive" : ""}>{back.toLocaleString("en-US")}</Cell>
        <Cell label="تكلفة الوحدة (متوسط المرسل)">{value ? formatEGP(value.unit) : "—"}</Cell>
        <Cell label="قيمة التحويل">{value ? formatEGP(value.sent) : "—"}</Cell>
        <Cell label="قيمة اللي اتقبل" tone="text-success">{value ? formatEGP(value.received) : "—"}</Cell>
        <Cell label="قيمة اللي اترفض / رجع" tone="text-destructive">{value ? formatEGP(transfer.status === "rejected" ? value.rejected : transfer.status === "confirmed" ? Math.max(0, value.sent - value.received) : 0) : "—"}</Cell>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>الحالة: <b className="text-foreground">{status}</b></span>
        <span>اتعمل: {formatDateTime(transfer.created_at)}</span>
        {transfer.confirmed_at && <span>اتأكد: {formatDateTime(transfer.confirmed_at)}</span>}
        {transfer.recipient_name && <span>المستلم: {transfer.recipient_name}</span>}
        {transfer.reason && <span>السبب: {transfer.reason}</span>}
        {transfer.notes && <span>ملاحظات: {transfer.notes}</span>}
      </div>
      {transfer.status === "rejected" && transfer.rejection_reason && (
        <div className="text-xs text-destructive">سبب الرفض: {transfer.rejection_reason}</div>
      )}
    </div>
  );
}
