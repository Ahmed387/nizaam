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

  // Record initial payment if any
  if (paidNow > 0) {
    const { error: te } = await supabase.rpc("record_payment_transaction", {
      p_payment_plan_id: plan.id,
      p_installment_id: null,
      p_amount: paidNow,
      p_payment_method: state.method.method,
      p_reference_number: state.method.reference_number ?? null,
      p_transfer_to_account: state.method.transfer_to_account ?? null,
      p_received_by_name: state.method.received_by_name ?? null,
      p_fee_amount: state.method.fee_amount,
      p_fee_type: state.method.fee_type ?? null,
      p_fee_on_customer: direction === "in" ? state.feeOnCustomer : false,
      p_direction: direction,
    });
    if (te) throw te;
  }

  return plan.id;
}
