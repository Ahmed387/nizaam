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
