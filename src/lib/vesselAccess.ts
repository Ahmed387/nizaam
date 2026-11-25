/**
 * Who sees / uses each money vessel (migration 0281, owner 2026-11-25): per person, per vessel and — for a vessel with
 * several numbers — per account: 'use' يشوف ويستخدم · 'view' يشوف بس مايدفعش · 'hidden' مخفي خالص. Nothing set = 'use';
 * the company owner is never limited. The server refuses new money in a vessel / account he may not use and hides the
 * till rows of a hidden one; the screens use these helpers to offer / show the same.
 */
import { supabase } from "@/integrations/supabase/client";

export type VesselLevel = "hidden" | "view" | "use";
export type VesselRule = { method: string; account_id: string | null; level: VesselLevel };

export const LEVEL_LABEL: Record<VesselLevel, string> = { use: "يشوف ويستخدم", view: "يشوف بس مايدفعش", hidden: "مخفي خالص" };
const RANK: Record<VesselLevel, number> = { hidden: 0, view: 1, use: 2 };

/** One account (or the vessel itself when `accountId` is empty): the account's rule, else the vessel's, else 'use'. */
export function accountLevel(rules: VesselRule[], method: string, accountId?: string | null): VesselLevel {
  if (accountId) {
    const a = rules.find((r) => r.method === method && r.account_id === accountId);
    if (a) return a.level;
  }
  return rules.find((r) => r.method === method && !r.account_id)?.level ?? "use";
}

/** The vessel as a whole on screen: the best of its own rule and its accounts' rules (a hidden vessel with one open number is offered). */
export function methodLevel(rules: VesselRule[], method: string): VesselLevel {
  const own = accountLevel(rules, method, null);
  return rules.filter((r) => r.method === method && r.account_id)
    .reduce<VesselLevel>((best, r) => (RANK[r.level] > RANK[best] ? r.level : best), own);
}

/** What the settings screen sends: vessel rules not 'use', and account rules that differ from their vessel. */
export function rowsToSave(vessels: Record<string, VesselLevel>, accounts: Record<string, VesselLevel>): VesselRule[] {
  const out: VesselRule[] = [];
  for (const [m, level] of Object.entries(vessels).sort(([a], [b]) => a.localeCompare(b))) {
    if (level !== "use") out.push({ method: m, account_id: null, level });
  }
  for (const [key, level] of Object.entries(accounts).sort(([a], [b]) => a.localeCompare(b))) {
    const [m, acc] = key.split(":");
    if (level !== (vessels[m] ?? "use")) out.push({ method: m, account_id: acc, level });
  }
  return out.sort((a, b) => a.method.localeCompare(b.method) || (a.account_id ? 1 : 0) - (b.account_id ? 1 : 0));
}

let _mine: VesselRule[] | null = null;
let _mineFor: string | null = null;

/** The signed-in user's own rules (cached; an owner has none). */
export async function loadMyVesselRules(force = false): Promise<VesselRule[]> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user?.id ?? null;
  if (!uid) return [];
  if (!force && _mine && _mineFor === uid) return _mine;
  const { data } = await (supabase.from as any)("vessel_access").select("method, account_id, level").eq("user_id", uid);
  _mine = ((data ?? []) as VesselRule[]);
  _mineFor = uid;
  return _mine;
}
export const myVesselRulesCache = () => _mine ?? [];

/** Every rule of one person (owner screen). */
export async function loadVesselRulesOf(userId: string): Promise<VesselRule[]> {
  const { data, error } = await (supabase.from as any)("vessel_access").select("method, account_id, level").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as VesselRule[];
}

export async function saveVesselRules(userId: string, rows: VesselRule[]) {
  const { error } = await (supabase.rpc as any)("set_vessel_access", { p_user: userId, p_rows: rows });
  if (error) throw error;
}
