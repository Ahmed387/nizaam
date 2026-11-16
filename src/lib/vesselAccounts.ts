import { supabase } from "@/integrations/supabase/client";

/**
 * «حسابات الأوعية» (migration 0244): every vessel (محفظة / انستاباي / بنك …) has company-wide accounts the money lands on
 * — an employee's number or an outside one — added by the company owner from الإعدادات ← طرق الدفع.
 * A screen sends the chosen account's number in the company-side field (in → transfer_to_account, out →
 * transfer_from_account); the server matches it (`vessel_account_key`) and keeps a balance per account.
 */
export interface VesselAccount {
  id: string;
  payment_method: string;
  employee_id: string | null;
  holder_name: string;
  account_number: string;
  is_active: boolean;
  notes?: string | null;
  sort_order?: number;
}

/** Same rule as SQL `vessel_account_key`: Arabic/Persian digits → Latin, lower case, letters and digits only. */
export function accountKey(s: string | null | undefined): string {
  const map: Record<string, string> = {};
  "٠١٢٣٤٥٦٧٨٩".split("").forEach((d, i) => (map[d] = String(i)));
  "۰۱۲۳۴۵۶۷۸۹".split("").forEach((d, i) => (map[d] = String(i)));
  return (s ?? "").replace(/[٠-٩۰-۹]/g, (d) => map[d]).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const accountText = (a: Pick<VesselAccount, "holder_name" | "account_number">) => `${a.holder_name} — ${a.account_number}`;

let _cache: VesselAccount[] | null = null;
let _at = 0;
export const vesselAccountsCache = () => _cache;

export async function loadVesselAccounts(force = false): Promise<VesselAccount[]> {
  if (!force && _cache && Date.now() - _at < 60_000) return _cache;
  const { data, error } = await (supabase.from as any)("vessel_accounts")
    .select("id,payment_method,employee_id,holder_name,account_number,is_active,notes,sort_order")
    .order("sort_order").order("holder_name");
  if (error) return _cache ?? [];
  _cache = (data ?? []) as VesselAccount[];
  _at = Date.now();
  return _cache;
}

export function activeAccountsOf(method: string, list: VesselAccount[] | null = _cache): VesselAccount[] {
  return (list ?? []).filter((a) => a.payment_method === method && a.is_active);
}

/** The account a number belongs to (any of the vessel's accounts, active or not). */
export function accountOfNumber(method: string, number: string | null | undefined, list: VesselAccount[] | null = _cache) {
  const k = accountKey(number);
  if (!k) return undefined;
  return (list ?? []).find((a) => a.payment_method === method && accountKey(a.account_number) === k);
}

/**
 * Required when the vessel has active accounts: one of the two numbers must be one of them (same check as the server's
 * `assert_vessel_account`). Returns an Arabic error or null.
 */
export function vesselAccountError(
  pm: { method: string; transfer_from_account?: string | null; transfer_to_account?: string | null },
  list: VesselAccount[] | null = _cache,
): string | null {
  const acc = activeAccountsOf(pm.method, list);
  if (!acc.length) return null;
  const keys = new Set(acc.map((a) => accountKey(a.account_number)));
  if (keys.has(accountKey(pm.transfer_to_account)) || keys.has(accountKey(pm.transfer_from_account))) return null;
  return "اختار الحساب اللي الفلوس اتحولت عليه / منه";
}
