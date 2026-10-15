import { supabase } from "@/integrations/supabase/client";

/**
 * Ledger money rows (contact file) → the voucher of that money, so its attachments (transfer receipts) can be
 * shown. vouchers: the source is the voucher; plan / contact payments: the till row of the payment; payments made
 * with an invoice: the invoice's till row of the same amount closest in time.
 */
export async function vouchersForMovements(rows: { movement_id: string; source_table: string; source_id: string; amount: number }[]) {
  const out: Record<string, { id: string; status: string }> = {};
  const vIds = rows.filter((r) => r.source_table === "vouchers").map((r) => r.source_id);
  const ptIds = rows.filter((r) => r.source_table === "payment_transactions").map((r) => r.source_id);
  const ipIds = rows.filter((r) => r.source_table === "invoice_payments").map((r) => r.source_id);
  const chunk = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

  const vById = new Map<string, any>();
  for (const c of chunk(vIds)) {
    const { data } = await supabase.from("vouchers").select("id, status").in("id", c);
    (data ?? []).forEach((v: any) => vById.set(v.id, v));
  }
  const ptTreasury = new Map<string, string>();
  for (const c of chunk(ptIds)) {
    const { data } = await supabase.from("payment_transactions").select("id, treasury_id").in("id", c);
    (data ?? []).forEach((p: any) => p.treasury_id && ptTreasury.set(p.id, p.treasury_id));
  }
  const ips = new Map<string, any>();
  for (const c of chunk(ipIds)) {
    const { data } = await supabase.from("invoice_payments").select("id, invoice_id, amount, created_at").in("id", c);
    (data ?? []).forEach((p: any) => ips.set(p.id, p));
  }
  const ipTreasury = new Map<string, string>();
  const invIds = Array.from(new Set(Array.from(ips.values()).map((p) => p.invoice_id)));
  const tillByInv = new Map<string, any[]>();
  for (const c of chunk(invIds)) {
    const { data } = await supabase.from("treasury").select("id, reference_id, amount, created_at").in("reference_id", c).eq("type", "income");
    (data ?? []).forEach((t: any) => tillByInv.set(t.reference_id, [...(tillByInv.get(t.reference_id) ?? []), t]));
  }
  ips.forEach((p, id) => {
    const cands = (tillByInv.get(p.invoice_id) ?? []).filter((t) => Math.abs(Number(t.amount) - Number(p.amount)) < 0.01);
    cands.sort((a, b) => Math.abs(+new Date(a.created_at) - +new Date(p.created_at)) - Math.abs(+new Date(b.created_at) - +new Date(p.created_at)));
    if (cands[0]) ipTreasury.set(id, cands[0].id);
  });
  const trIds = Array.from(new Set([...ptTreasury.values(), ...ipTreasury.values()]));
  const vByTreasury = new Map<string, any>();
  for (const c of chunk(trIds)) {
    const { data } = await supabase.from("vouchers").select("id, status, treasury_id").in("treasury_id", c);
    (data ?? []).forEach((v: any) => vByTreasury.set(v.treasury_id, v));
  }
  rows.forEach((r) => {
    const v = r.source_table === "vouchers" ? vById.get(r.source_id)
      : r.source_table === "payment_transactions" ? vByTreasury.get(ptTreasury.get(r.source_id) ?? "")
      : r.source_table === "invoice_payments" ? vByTreasury.get(ipTreasury.get(r.source_id) ?? "")
      : null;
    if (v) out[r.movement_id] = { id: v.id, status: v.status };
  });
  return out;
}
