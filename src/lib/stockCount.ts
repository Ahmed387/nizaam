/**
 * Branch stock count — who does what (migration 0267, owner 2026-11-18 «أمين المخزن أو المدير يفتح ويعدّ، والمدير
 * يراجع ويكتب أسباب الفروق، وإنت تعتمد»). Mirrors the server: `stock_count.create` opens + counts + hands in,
 * `stock_count.update` reviews / sends back / cancels an open count, the company owner approves and cancels an approved one.
 */
export type CountStatus = "counting" | "reviewing" | "pending_approval" | "closed" | "cancelled" | string;
export interface CountRights { canCount: boolean; canReview: boolean; isOwner: boolean }
export type CountAction = "count" | "review" | "approve" | "cancel_open" | "cancel_approved";

export const COUNT_OPEN: CountStatus[] = ["counting", "reviewing", "pending_approval"];

/** the main button of a count row (at most one), then the others */
export function countActions(status: CountStatus, r: CountRights): CountAction[] {
  const out: CountAction[] = [];
  if (status === "counting" && (r.canCount || r.isOwner)) out.push("count");
  if (status === "reviewing" && (r.canReview || r.isOwner)) out.push("review");
  if (status === "pending_approval" && r.isOwner) out.push("approve");
  if (COUNT_OPEN.includes(status) && (r.canReview || r.isOwner)) out.push("cancel_open");
  if (status === "closed" && r.isOwner) out.push("cancel_approved");
  return out;
}

/** what the count is waiting for, in words */
export function countWaitingFor(status: CountStatus): string {
  switch (status) {
    case "counting": return "مستني العد (أمين المخزن أو المدير)";
    case "reviewing": return "مستني مراجعة المدير";
    case "pending_approval": return "مستني اعتماد صاحب الشركة";
    case "closed": return "اتعتمد";
    case "cancelled": return "اتلغى";
    default: return "—";
  }
}
