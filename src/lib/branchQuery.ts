/**
 * Strict branch isolation helpers (see AGENTS.md).
 * Every query on a branch page must pass through `scopeToBranch` with the
 * route's active branch id. A missing id returns no rows instead of leaking
 * data from other branches.
 */
const NO_BRANCH = "00000000-0000-0000-0000-000000000000";

export function scopeToBranch<Q extends { eq: (col: string, val: any) => Q }>(
  query: Q,
  branchId: string | null | undefined,
  tenantId?: string | null,
  column = "branch_id",
): Q {
  let q = query.eq(column, branchId || NO_BRANCH);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  return q;
}
