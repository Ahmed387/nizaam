import { useAuth } from "@/contexts/AuthContext";

/** النص البديل اللي بيظهر مكان الرقم لما الموظف مش مصرحله يشوف صافي الربح. */
export const NET_PROFIT_MASK = "غير مصرح";

/** مفتاح الصلاحية المخزن في user_permissions / role_permissions. */
export const NET_PROFIT_PERM = "net_profit.view";

/**
 * هل المستخدم الحالي مسموحله يشوف أرقام صافي الربح؟
 * الأونر/الأدمن/السوبر أدمن دايماً بيشوفوا (checkPermission بيرجع true ليهم).
 */
export function useCanViewNetProfit(): boolean {
  const { isAdmin, isOwner, can } = useAuth();
  return isAdmin || isOwner || can(NET_PROFIT_PERM);
}

/** يرجّع النص الأصلي لو مصرح، أو "غير مصرح" لو لأ — من غير ما يخفي الكارت. */
export const maskNetProfit = (visible: boolean, text: string) => (visible ? text : NET_PROFIT_MASK);
