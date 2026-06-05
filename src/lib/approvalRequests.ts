import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ApprovalEntityType = "contact" | "invoice" | "shipment";
export type ApprovalAction = "delete" | "update";

export interface CreateApprovalRequestInput {
  tenantId: string;
  branchId?: string | null;
  entityType: ApprovalEntityType;
  entityId: string;
  entityLabel: string;
  action: ApprovalAction;
  payload?: Record<string, any> | null;
  reason?: string;
  requestedBy: string;
  requestedByName: string;
}

export async function createApprovalRequest(input: CreateApprovalRequestInput) {
  const { error } = await supabase.from("approval_requests" as any).insert({
    tenant_id: input.tenantId,
    branch_id: input.branchId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    entity_label: input.entityLabel,
    action: input.action,
    payload: input.payload ?? null,
    reason: input.reason ?? null,
    requested_by: input.requestedBy,
    requested_by_name: input.requestedByName,
  });
  if (error) {
    toast.error(error.message);
    return false;
  }
  toast.success("تم إرسال الطلب لمدير الشركة للموافقة");
  return true;
}
