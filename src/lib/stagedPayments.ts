import { supabase } from "@/integrations/supabase/client";

export type StagedPayment = {
  method: string;
  amount: number;
  reference_number?: string | null;
  transfer_to_account?: string | null;
  transfer_from_account?: string | null;
  fee_amount?: number;
  fee_on_customer?: boolean;
  received_by_name?: string | null;
};

export type StagedOp =
  | { id: string; type: "add_invpay"; payload: StagedPayment }
  | { id: string; type: "edit_invpay"; targetId: string; original: any; payload: StagedPayment; reason: string }
  | { id: string; type: "delete_invpay"; targetId: string; original: any; reason: string }
  | { id: string; type: "add_tx"; payload: StagedPayment; planId: string; installmentId?: string | null }
  | { id: string; type: "edit_tx"; targetId: string; original: any; payload: StagedPayment; reason: string }
  | { id: string; type: "delete_tx"; targetId: string; original: any; reason: string };

/**
 * Apply a list of staged payment operations against the DB in order using the
 * existing RPCs. Stops at first error and returns the failed op + reason.
 */
export async function applyStagedPayments(
  ops: StagedOp[],
  invoiceId: string
): Promise<{ ok: true } | { ok: false; failedAt: number; message: string }> {
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (op.type === "add_invpay") {
        const { error } = await supabase.rpc("add_invoice_payment" as any, {
          p_invoice_id: invoiceId,
          p_payment_method: op.payload.method,
          p_amount: op.payload.amount,
          p_reference_number: op.payload.reference_number ?? null,
          p_transfer_to_account: op.payload.transfer_to_account ?? null,
          p_transfer_from_account: op.payload.transfer_from_account ?? null,
          p_fee_amount: op.payload.fee_amount ?? 0,
          p_fee_on_customer: op.payload.fee_on_customer ?? false,
          p_received_by_name: op.payload.received_by_name ?? null,
        });
        if (error) throw error;
      } else if (op.type === "edit_invpay") {
        const { error } = await supabase.rpc("edit_invoice_payment" as any, {
          p_payment_id: op.targetId,
          p_amount: op.payload.amount,
          p_payment_method: op.payload.method,
          p_reference_number: op.payload.reference_number ?? null,
          p_transfer_to_account: op.payload.transfer_to_account ?? null,
          p_transfer_from_account: op.payload.transfer_from_account ?? null,
          p_fee_amount: op.payload.fee_amount ?? 0,
          p_fee_on_customer: op.payload.fee_on_customer ?? false,
          p_received_by_name: op.payload.received_by_name ?? null,
          p_reason: op.reason || "تعديل من صفحة تعديل الفاتورة",
        });
        if (error) throw error;
      } else if (op.type === "delete_invpay") {
        const { error } = await supabase.rpc("void_invoice_payment" as any, {
          p_payment_id: op.targetId,
          p_reason: op.reason || null,
        });
        if (error) throw error;
      } else if (op.type === "add_tx") {
        const { error } = await supabase.rpc("record_payment_transaction" as any, {
          p_payment_plan_id: op.planId,
          p_installment_id: op.installmentId ?? null,
          p_amount: op.payload.amount,
          p_payment_method: op.payload.method,
          p_reference_number: op.payload.reference_number ?? null,
          p_transfer_to_account: op.payload.transfer_to_account ?? null,
          p_transfer_from_account: op.payload.transfer_from_account ?? null,
          p_received_by_name: op.payload.received_by_name ?? null,
          p_fee_amount: op.payload.fee_amount ?? 0,
          p_fee_type: null,
          p_fee_on_customer: op.payload.fee_on_customer ?? false,
          p_direction: "in",
        });
        if (error) throw error;
      } else if (op.type === "edit_tx") {
        const { error } = await supabase.rpc("edit_payment_transaction" as any, {
          p_tx_id: op.targetId,
          p_amount: op.payload.amount,
          p_payment_method: op.payload.method,
          p_reference_number: op.payload.reference_number ?? null,
          p_transfer_to_account: op.payload.transfer_to_account ?? null,
          p_transfer_from_account: op.payload.transfer_from_account ?? null,
          p_fee_amount: op.payload.fee_amount ?? 0,
          p_received_by_name: op.payload.received_by_name ?? null,
          p_reason: op.reason || "تعديل من صفحة تعديل الفاتورة",
        });
        if (error) throw error;
      } else if (op.type === "delete_tx") {
        const { error } = await supabase.rpc("void_payment_transaction" as any, {
          p_tx_id: op.targetId,
          p_reason: op.reason || null,
        });
        if (error) throw error;
      }
    } catch (e: any) {
      return { ok: false, failedAt: i, message: e.message ?? "فشل تنفيذ عملية دفع" };
    }
  }
  return { ok: true };
}

export function stagedOpLabel(op: StagedOp): string {
  const m = (x: string) =>
    (({ cash: "نقدي", credit: "آجل", bank: "تحويل بنكي", instapay: "إنستاباي" } as any)[x] || x);
  const fmt = (n: number) => Number(n || 0).toFixed(2);
  switch (op.type) {
    case "add_invpay":
      return `➕ دفعة جديدة (${m(op.payload.method)}) بمبلغ ${fmt(op.payload.amount)} ج.م`;
    case "add_tx":
      return `➕ دفعة جديدة على الخطة (${m(op.payload.method)}) بمبلغ ${fmt(op.payload.amount)} ج.م`;
    case "edit_invpay":
    case "edit_tx": {
      const parts: string[] = [];
      if (Math.abs(Number(op.original?.amount || 0) - Number(op.payload.amount || 0)) > 0.01)
        parts.push(`المبلغ: ${fmt(Number(op.original?.amount || 0))} → ${fmt(op.payload.amount)}`);
      if ((op.original?.payment_method || "") !== op.payload.method)
        parts.push(`الطريقة: ${m(op.original?.payment_method || "-")} → ${m(op.payload.method)}`);
      return `✏️ تعديل دفعة — ${parts.join(" • ") || "بدون تغييرات"}`;
    }
    case "delete_invpay":
    case "delete_tx":
      return `🗑️ حذف دفعة بمبلغ ${fmt(Number(op.original?.amount || 0))} ج.م (${m(op.original?.payment_method || "-")})`;
  }
}

/** Compute the net effect (paid delta) of staged ops on top of current active totals. */
export function stagedPaidDelta(ops: StagedOp[]): number {
  let d = 0;
  for (const op of ops) {
    if (op.type === "add_invpay" || op.type === "add_tx") d += Number(op.payload.amount || 0);
    else if (op.type === "edit_invpay" || op.type === "edit_tx")
      d += Number(op.payload.amount || 0) - Number(op.original?.amount || 0);
    else if (op.type === "delete_invpay" || op.type === "delete_tx")
      d -= Number(op.original?.amount || 0);
  }
  return d;
}
