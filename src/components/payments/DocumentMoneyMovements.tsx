import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { useAttachmentCounts, type RecordType } from "@/hooks/useAttachmentCounts";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { Paperclip, Receipt } from "lucide-react";

interface VoucherRow {
  id: string;
  voucher_number: string;
  type: string;
  amount: number;
  payment_method: string | null;
  voucher_date: string;
  status: string;
  reference_number: string | null;
}

/**
 * «حركات الفلوس على المستند» — every receipt / payment voucher of a document (its own till rows and its plan
 * payments), with each voucher's attachments (transfer receipts) and a header summary:
 * how many movements the document has and how many attachments in total (document + payment receipts).
 */
export function DocumentMoneyMovements({ docId, docRecordType, canEdit = true }: {
  docId: string;
  docRecordType: RecordType;
  canEdit?: boolean;
}) {
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [{ data: tr }, { data: plans }] = await Promise.all([
      supabase.from("treasury").select("id").eq("reference_id", docId),
      supabase.from("payment_plans").select("id").eq("reference_id", docId),
    ]);
    const ids = new Set<string>((tr ?? []).map((t: any) => t.id));
    const planIds = (plans ?? []).map((p: any) => p.id);
    if (planIds.length) {
      const { data: pts } = await supabase.from("payment_transactions").select("treasury_id, fee_treasury_id").in("payment_plan_id", planIds);
      (pts ?? []).forEach((p: any) => { if (p.treasury_id) ids.add(p.treasury_id); if (p.fee_treasury_id) ids.add(p.fee_treasury_id); });
    }
    if (ids.size === 0) { setRows([]); setLoaded(true); return; }
    const { data: vs } = await supabase.from("vouchers")
      .select("id, voucher_number, type, amount, payment_method, voucher_date, status, reference_number")
      .in("treasury_id", Array.from(ids)).order("voucher_date").order("voucher_number");
    setRows((vs ?? []) as any);
    setLoaded(true);
  }, [docId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["vouchers", "treasury", "payment_transactions"], load);

  const voucherIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const vCounts = useAttachmentCounts("voucher", voucherIds);
  const docIds = useMemo(() => [docId], [docId]);
  const dCounts = useAttachmentCounts(docRecordType, docIds);

  const active = rows.filter((r) => r.status === "active");
  const proofCount = rows.reduce((s, r) => s + (vCounts[r.id] ?? 0), 0);
  const docCount = dCounts[docId] ?? 0;

  return (
    <div className="space-y-2" dir="rtl">
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
        <Receipt className="w-5 h-5" /> حركات الفلوس على المستند
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{active.length} حركة</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs flex items-center gap-1">
          <Paperclip className="w-3 h-3" /> {docCount + proofCount} مرفق
          <span className="text-muted-foreground font-normal">({docCount} على المستند + {proofCount} إيصال دفع)</span>
        </span>
        {rows.length > active.length && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{rows.length - active.length} ملغاة</span>
        )}
      </div>
      {!loaded ? (
        <div className="text-xs text-muted-foreground text-center py-2">جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-2 rounded border border-dashed">لا توجد حركات فلوس على المستند ده</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-right py-1">السند</th>
                <th className="text-right py-1">التاريخ</th>
                <th className="text-right py-1">النوع</th>
                <th className="text-right py-1">الطريقة</th>
                <th className="text-right py-1">رقم العملية</th>
                <th className="text-left py-1">المبلغ</th>
                <th className="text-center py-1">الإيصالات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-dashed ${r.status !== "active" ? "opacity-50 line-through" : ""}`}>
                  <td className="py-1 font-mono">{r.voucher_number}</td>
                  <td className="py-1">{String(r.voucher_date).slice(0, 10)}</td>
                  <td className="py-1">{r.type === "receipt" ? "قبض" : "صرف"}</td>
                  <td className="py-1">{PAYMENT_METHOD_LABELS[r.payment_method ?? "cash"] ?? r.payment_method}</td>
                  <td className="py-1" dir="ltr">{r.reference_number ?? "—"}</td>
                  <td className="py-1 text-left tabular-nums font-semibold">{formatEGP(r.amount)}</td>
                  <td className="py-1 text-center">
                    <AttachmentsDialogButton recordType="voucher" recordId={r.id} count={vCounts[r.id] ?? 0}
                                             canEdit={canEdit && r.status === "active"} label={`إيصالات السند ${r.voucher_number}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
