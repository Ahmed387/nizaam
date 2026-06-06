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
}

/**
 * Creates a payment_plan + installments (if scheduled) + initial payment_transaction (if mode != 'credit').
 * Returns the created plan id.
 */
export async function createPaymentPlanWithInitial(args: CreatePlanArgs): Promise<string> {
  const { branchId, entityType, entityId, entityName, totalAmount, referenceType, referenceId, state, direction, createdBy } = args;
  const paidNow = state.mode === "credit" ? 0 : Number(state.paidNow || 0);

  // If fully paid in cash with no plan needed, still create a "completed" plan for auditability.
  const { data: plan, error: pe } = await supabase
    .from("payment_plans")
    .insert({
      branch_id: branchId,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      total_amount: totalAmount,
      paid_amount: 0,
      remaining_amount: totalAmount,
      plan_type: state.mode === "credit" || state.mode === "partial" ? state.scheduleType : "open",
      reference_type: referenceType,
      reference_id: referenceId ?? null,
      fee_on_customer: state.feeOnCustomer,
      status: "active",
      created_by: createdBy,
    })
    .select()
    .single();
  if (pe) throw pe;

  // Insert installments if scheduled
  if ((state.mode === "credit" || state.mode === "partial") && state.scheduleType === "scheduled" && state.installments.length) {
    const rows = state.installments.map((r, i) => ({
      payment_plan_id: plan.id,
      installment_number: i + 1,
      due_date: r.due_date,
      amount: r.amount,
      status: "pending",
    }));
    const { error: ie } = await supabase.from("payment_installments").insert(rows);
    if (ie) throw ie;
  }

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
      });
      if (te) throw te;
    }
  }

  return plan.id;
}
