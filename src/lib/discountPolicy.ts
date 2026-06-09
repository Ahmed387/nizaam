import { supabase } from "@/integrations/supabase/client";

export type DiscountPolicy =
  | { mode: "global"; percent: number }
  | { mode: "per_branch"; branches: Record<string, number> };

const DEFAULT_PCT = 10;

/** Load the active discount policy. Returns null if none set. */
export async function loadDiscountPolicy(): Promise<DiscountPolicy | null> {
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["discount_policy_global", "discount_policy_branches"]);
  const rows = (data ?? []) as { key: string; value: any }[];
  // per_branch wins if explicitly chosen
  const perBranch = rows.find((r) => r.key === "discount_policy_branches")?.value;
  const global = rows.find((r) => r.key === "discount_policy_global")?.value;
  if (perBranch && perBranch.mode === "per_branch") {
    return { mode: "per_branch", branches: perBranch.branches ?? {} };
  }
  if (global && global.mode === "global") {
    return { mode: "global", percent: Number(global.percent ?? DEFAULT_PCT) };
  }
  return null;
}

/** Compute the max discount % allowed for the given branch. */
export async function getMaxDiscountForBranch(branchId: string): Promise<number> {
  const policy = await loadDiscountPolicy();
  if (!policy) return DEFAULT_PCT;
  if (policy.mode === "global") return Number(policy.percent) || DEFAULT_PCT;
  const v = policy.branches?.[branchId];
  return v == null || isNaN(Number(v)) ? DEFAULT_PCT : Number(v);
}

export const DEFAULT_MAX_DISCOUNT_PCT = DEFAULT_PCT;
