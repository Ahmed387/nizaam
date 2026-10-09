import { supabase } from "@/integrations/supabase/client";
import type { PaymentPlanState } from "@/components/PaymentPlanSelector";

interface CreatePlanArgs {
  branchId: string;
  entityType: "customer" | "supplier" | "employee";
  entityId: string;
  entityName: string;
  totalAmount: number;
  referenceType: "invoice" | "shipment" | "salary" | "advance";
  referenceId?: string | null;
  state: PaymentPlanState;
  /** direction of the initial payment if any */
  direction: "in" | "out";
  createdBy: string;
  /** Plan header already created atomically by a DB RPC (e.g. record_shipment_with_credit). */
  existingPlanId?: string;
  /** Accounting date (YYYY-MM-DD) inherited by the initial payment of a backdated document. */
  paymentDate?: string | null;
}

/**
 * Creates a payment_plan + installments (if scheduled) through create_payment_plan, then the initial
 * payment_transaction(s) through record_payment_transaction (if mode != 'credit').
 * branchId / entity* / createdBy stay in the signature for callers; the server derives them.
 * Returns the created plan id.
 */
export async function createPaymentPlanWithInitial(args: CreatePlanArgs): Promise<string> {
  const { totalAmount, referenceType, referenceId, state, direction, existingPlanId, paymentDate } = args;
  const paidNow = state.mode === "credit" ? 0 : Number(state.paidNow || 0);

  // Plan header + installments are written on the server (create_payment_plan): party, branch and the
  // document limits come from the invoice / purchase invoice, never from the browser (SEC-004).
  const scheduled = (state.mode === "credit" || state.mode === "partial") && state.scheduleType === "scheduled" && state.installments.length > 0;
  const { data: planId, error: pe } = await (supabase.rpc as any)("create_payment_plan", {
    p_reference_type: referenceType,
    p_reference_id: referenceId,
    p_total: totalAmount,
    p_plan_type: scheduled ? "scheduled" : "open",
    p_fee_on_customer: !!state.feeOnCustomer,
    p_installments: scheduled ? state.installments.map((r) => ({ due_date: r.due_date, amount: r.amount })) : [],
    p_existing_plan_id: existingPlanId ?? null,
  });
  if (pe) throw pe;
  const plan = { id: String(planId) };

  // Record initial payment(s) — supports multi-method splits
  if (paidNow > 0) {
    const splits = (state.splits && state.splits.length > 0)
      ? state.splits.filter((s) => Number(s.amount) > 0)
      : (state.method
          ? [{
              method: state.method.method,
              amount: paidNow,
              reference_number: state.method.reference_number,
              transfer_to_account: state.method.transfer_to_account,
              transfer_from_account: state.method.transfer_from_account,
              received_by_name: state.method.received_by_name,
              fee_amount: state.method.fee_amount ?? 0,
              fee_type: state.method.fee_type,
            }]
          : []);

    for (const sp of splits) {
      const { error: te } = await supabase.rpc("record_payment_transaction" as any, {
        p_payment_plan_id: plan.id,
        p_installment_id: null,
        p_amount: sp.amount,
        p_payment_method: sp.method,
        p_reference_number: sp.reference_number ?? null,
        p_transfer_to_account: sp.transfer_to_account ?? null,
        p_received_by_name: sp.received_by_name ?? null,
        p_fee_amount: sp.fee_amount ?? 0,
        p_fee_type: sp.fee_type ?? null,
        p_fee_on_customer: direction === "in" ? state.feeOnCustomer : false,
        p_direction: direction,
        p_transfer_from_account: sp.transfer_from_account ?? null,
        p_payment_date: paymentDate ?? null,
      });
      if (te) throw te;
    }
  }

  return plan.id;
}
