import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { uploadRecordAttachment } from "@/lib/attachmentUpload";

/**
 * Payment proofs (owner rule 2026-10-15): a transfer receipt (InstaPay / wallet / bank screenshot or PDF) chosen in a
 * payment form is saved on the voucher of THAT payment (record_type "voucher"), not on the whole document.
 *
 * The payment RPCs create the till row and its voucher on the server, so after a successful save we look up the
 * voucher this user just created for that method and amount, then upload the staged files to it.
 */
export interface ProofGroup {
  files?: File[] | null;
  method: string;
  /** the payment amount; `alt` is also accepted (e.g. amount + fee when the customer pays the fee) */
  amount: number;
  alt?: number;
  branchId?: string | null;
  /** one hand-over split by the server over several vouchers: take this user's latest voucher of the method */
  anyAmount?: boolean;
}

/** Call right before the save, pass the result to attachPaymentProofs after it. */
export function proofClock() {
  return new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min margin for clock differences
}

export function hasProofs(groups: ProofGroup[]) {
  return groups.some((g) => Array.isArray(g.files) && g.files.length > 0 && g.method !== "cash");
}

export async function attachPaymentProofs(groups: ProofGroup[], since: string): Promise<number> {
  const todo = groups.filter((g) => Array.isArray(g.files) && g.files.length > 0 && g.method !== "cash");
  if (todo.length === 0) return 0;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;
  const used = new Set<string>();
  let done = 0;
  let missing = 0;
  for (const g0 of todo) {
    const g = { ...g0, files: g0.files!.filter((f) => f instanceof File) };
    if (g.files.length === 0) continue;
    const amounts = [g.amount, g.alt].filter((a): a is number => typeof a === "number" && a > 0).map((a) => Math.round(a * 100) / 100);
    const look = async (byUser: boolean) => {
      let q = supabase.from("vouchers").select("id, amount, created_at")
        .eq("payment_method", g.method).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(10);
      if (!g.anyAmount) q = q.in("amount", amounts.length ? amounts : [g.amount]);
      if (byUser && uid) q = q.eq("created_by", uid);
      if (g.branchId) q = q.eq("branch_id", g.branchId);
      const { data } = await q;
      return (data ?? []).find((x: any) => !used.has(x.id));
    };
    // the voucher this user just created; some server paths stamp no user on it → same branch / method / amount
    const v = (await look(true)) ?? (await look(false));
    if (!v) { missing += g.files!.length; continue; }
    used.add(v.id);
    for (const f of g.files!) {
      try {
        await uploadRecordAttachment("voucher", v.id, f, uid);
        done += 1;
      } catch (e: any) {
        toast.error(`إيصال ${f.name}: ${e?.message ?? "فشل الرفع"}`);
      }
    }
  }
  if (done > 0) toast.success(done === 1 ? "تم رفع إيصال التحويل على السند" : `تم رفع ${done} إيصالات على السندات`);
  if (missing > 0) toast.warning(`${missing} إيصال ما اترفعش — مالقيناش سند الدفعة. ارفعه من 📎 على السند في جدول السندات`);
  return done;
}
