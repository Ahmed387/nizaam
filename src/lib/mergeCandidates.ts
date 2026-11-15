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

/**
 * Same branch first, then the other branches. Since 0229 an account of another branch can be merged too (owner
 * 2026-11-15): every document keeps its own branch, only the account becomes one.
 */
export function splitCandidates(list: MergeCandidate[]) {
  return { sameBranch: list.filter((c) => c.same_branch), elsewhere: list.filter((c) => !c.same_branch) };
}

/** The names the owner can keep after the merge: the kept account's, the other one's (if different), or his own. */
export function mergeNameOptions(keptName: string, goneName: string): string[] {
  const a = keptName.trim(), b = goneName.trim();
  return a === b || !b ? [a] : [a, b];
}

/** The branches the merged account can belong to: the kept account's first, then the other one's (if different). */
export function mergeBranchOptions(kept: { id: string | null; name: string | null }, gone: { id: string | null; name: string | null }) {
  const out: { id: string; name: string }[] = [];
  for (const b of [kept, gone]) if (b.id && !out.some((o) => o.id === b.id)) out.push({ id: b.id, name: b.name ?? "—" });
  return out;
}

/** The name sent to merge_contacts: the typed one when «اسم تاني» is chosen, else the picked option. */
export function mergeNameToSend(choice: string, custom: string): string {
  return (choice === "__custom" ? custom : choice).replace(/\s+/g, " ").trim();
}

/**
 * Which account stays by default: the one with an opening balance. Since 0230 both may carry one: each opening stays
 * on its own branch, and two openings on the same branch are added into one (owner 2026-11-15 «نجمعهم في افتتاحي واحد»).
 */
export function keepAdvice(thisOpening: number, other: Pick<MergeCandidate, "opening_balance" | "name">, thisName: string) {
  const a = Math.abs(Number(thisOpening) || 0) > 0.005;
  const b = Math.abs(Number(other.opening_balance) || 0) > 0.005;
  if (a && b) return { keepThis: true, blocked: false, note: "الحسابين عليهم رصيد افتتاحي — كل افتتاحي بيفضل في فرعه، ولو الاتنين في نفس الفرع بيتجمعوا في افتتاحي واحد." };
  if (b) return { keepThis: false, blocked: false, note: `«${other.name}» عليه رصيد افتتاحي، فهو اللي هيفضل.` };
  if (a) return { keepThis: true, blocked: false, note: `«${thisName}» عليه رصيد افتتاحي، فهو اللي هيفضل.` };
  return { keepThis: true, blocked: false, note: null as string | null };
}
