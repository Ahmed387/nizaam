import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Branch visibility scope for admin/central pages.
 * Owner, admin and super_admin see every branch (`allowed === null`).
 * Any other user only sees the branches linked to them in "branch_users".
 */
export function useBranchScope() {
  const { branchScope } = useAuth();
  return useMemo(() => {
    const allowed = branchScope;
    const isAllowed = (id?: string | null) => !allowed || (!!id && allowed.includes(id));
    return {
      allowed,
      isAllowed,
      /** Filter any list of objects that carry a branch id field. */
      filterByBranch: <T,>(rows: T[], getId: (row: T) => string | null | undefined) =>
        !allowed ? rows : rows.filter((r) => isAllowed(getId(r))),
      /** Filter a branches list ([{ id }]). */
      filterBranches: <T extends { id: string }>(rows: T[]) =>
        !allowed ? rows : rows.filter((b) => allowed.includes(b.id)),
    };
  }, [branchScope]);
}
