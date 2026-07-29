import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_RETURN_WINDOW_DAYS = 20;

export async function fetchReturnWindowDays(): Promise<number> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "return_policy")
    .maybeSingle();
  const v = (data as any)?.value ?? {};
  const n = Number(v?.days);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETURN_WINDOW_DAYS;
  return Math.min(365, Math.max(1, Math.floor(n)));
}

export type ReturnPolicyResult =
  | { status: "ok"; daysSince: number; windowDays: number }
  | { status: "exception"; reason: string; daysSince: number; windowDays: number }
  | { status: "override_required"; daysSince: number; windowDays: number }
  | { status: "blocked"; daysSince: number; windowDays: number };

/** Determine if a sale-return against `invoiceId` (dated `invoiceDate`) is allowed. */
export async function evaluateReturnPolicy(params: {
  invoiceId: string;
  invoiceDate: string | Date;
  isOwner: boolean;
}): Promise<ReturnPolicyResult> {
  const windowDays = await fetchReturnWindowDays();
  const created = new Date(params.invoiceDate).getTime();
  const daysSince = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));

  if (daysSince <= windowDays) return { status: "ok", daysSince, windowDays };

  // Exceptions: payment plan / pre-order → no warning for anyone
  const [{ data: plan }, { data: preorder }] = await Promise.all([
    supabase
      .from("payment_plans")
      .select("id")
      .eq("reference_type", "invoice")
      .eq("reference_id", params.invoiceId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("pre_orders")
      .select("id")
      .eq("invoice_id", params.invoiceId)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle(),
  ]);

  if (plan) return { status: "exception", reason: "payment_plan", daysSince, windowDays };
  if (preorder) return { status: "exception", reason: "pre_order", daysSince, windowDays };

  return params.isOwner
    ? { status: "override_required", daysSince, windowDays }
    : { status: "blocked", daysSince, windowDays };
}
