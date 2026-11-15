// Shapes for the «دمج حسابين» search (migration 0223, `merge_contact_candidates`). Pure, tested in mergeCandidates.test.ts.
import { netOf } from "@/lib/netBalance";

export interface MergeCandidate {
  id: string; name: string; account_no: number | null; phone: string | null; type: string;
  branch_id: string | null; branch_name: string | null; same_branch: boolean;
  customer_balance: number; supplier_balance: number; net: number;
  opening_balance: number; shared_words: number; documents: number;
  can_merge: boolean; why_not: string | null;
}
export interface MergeCandidates { mode: "search" | "similar"; words: string[]; results: MergeCandidate[] }

export const contactTypeName = (t: string) => (t === "customer" ? "عميل" : t === "supplier" ? "مورد" : "عميل ومورد");

/** The account's balance the way every screen shows it (netOf: supplier − customer → دائن / مدين). */
export const candidateNet = (c: Pick<MergeCandidate, "customer_balance" | "supplier_balance">) => netOf(c.customer_balance, c.supplier_balance);

/** Same branch first (mergeable), then the other branches for information only. */
export function splitCandidates(list: MergeCandidate[]) {
  return { mergeable: list.filter((c) => c.can_merge), elsewhere: list.filter((c) => !c.can_merge) };
}

/**
 * Which account should stay: the one with an opening balance (merge_contacts refuses to archive an account that carries
 * one). Both with an opening → the merge will be refused; say so before the owner presses anything.
 */
export function keepAdvice(thisOpening: number, other: Pick<MergeCandidate, "opening_balance" | "name">, thisName: string) {
  const a = Math.abs(Number(thisOpening) || 0) > 0.005;
  const b = Math.abs(Number(other.opening_balance) || 0) > 0.005;
  if (a && b) return { keepThis: true, blocked: true, note: "الحسابين عليهم رصيد افتتاحي — الدمج هيترفض. صفّر الافتتاحي في واحد منهم الأول." };
  if (b) return { keepThis: false, blocked: false, note: `«${other.name}» عليه رصيد افتتاحي، فهو اللي هيفضل.` };
  if (a) return { keepThis: true, blocked: false, note: `«${thisName}» عليه رصيد افتتاحي، فهو اللي هيفضل.` };
  return { keepThis: true, blocked: false, note: null as string | null };
}
