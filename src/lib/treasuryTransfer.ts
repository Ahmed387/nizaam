/**
 * Money transfer between branches (migration 0140): the receiver types what really arrived; the rest goes back to the
 * sender on the transfer's own day. Same rule as `receive_treasury_transfer` on the server.
 */
export type ReceiveSplit = { received: number; returned: number; error: string | null; needsNote: boolean };

export function receiveSplit(sent: number, received: number | string, note = ""): ReceiveSplit {
  const s = Math.round((Number(sent) || 0) * 100) / 100;
  const r = Math.round((Number(received) || 0) * 100) / 100;
  const returned = Math.round((s - r) * 100) / 100;
  if (!(r >= 0) || r > s) return { received: r, returned, error: `المبلغ لازم يكون بين 0 و ${s}`, needsNote: false };
  const needsNote = returned > 0;
  return { received: r, returned, error: needsNote && !note.trim() ? "اكتب سبب الفرق" : null, needsNote };
}

/** 0285: where a money transfer stands (the same words on the screen everywhere). */
export type MoneyTransferState = "waiting" | "refused" | "cancelled" | "rejected" | "confirmed" | "pending";
export function moneyTransferState(r: {
  approval_status?: string | null; cancelled_at?: string | null; rejected_at?: string | null; acknowledged_at?: string | null;
}): MoneyTransferState {
  if (r.cancelled_at) return "cancelled";
  if (r.approval_status === "refused") return "refused";
  if (r.approval_status === "waiting") return "waiting";
  if (r.rejected_at) return "rejected";
  if (r.acknowledged_at) return "confirmed";
  return "pending";
}
export const MONEY_TRANSFER_STATE_LABEL: Record<MoneyTransferState, string> = {
  waiting: "مستني موافقة المالك", refused: "المالك رفضه", cancelled: "اتلغى من المرسل",
  rejected: "مرفوض", confirmed: "مؤكد", pending: "بانتظار الاستلام",
};
/** the sender may still edit / cancel it (0285): not received, not refused, not cancelled */
export const senderCanChange = (r: Parameters<typeof moneyTransferState>[0]) => ["waiting", "pending"].includes(moneyTransferState(r));
/** the receiver may act on it now */
export const receiverCanAct = (r: Parameters<typeof moneyTransferState>[0]) => moneyTransferState(r) === "pending";
/** a non-owner's transfer above the owner's limit waits for him (0 = no limit) */
export const needsOwnerApproval = (amount: number, limit: number, isOwner: boolean) => !isOwner && limit > 0 && amount > limit;
