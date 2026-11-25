// Fixed assets: edit / cancel helpers (migration 0284).
// Text fields (name / category / notes) change in place; anything that touches money = cancel + a new asset.

export type AssetStatus = "active" | "disposed" | "cancelled";

export type AssetLike = {
  code: string;
  name: string;
  category: string | null;
  branch_id: string | null;
  acquisition_date: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  funding: "opening" | "paid" | null;
  payment_method?: string | null;
  status: AssetStatus;
};

export type AssetForm = {
  name: string;
  category: string;
  branch_id: string;
  acquisition_date: string;
  cost: string;
  salvage_value: string;
  useful_life_months: string;
  funding: "" | "opening" | "paid";
  method: string;
  notes: string;
};

const n = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

/** true when the change reaches the books (the server then cancels the old asset and adds a new one). */
export function assetMoneyChanged(a: AssetLike, f: AssetForm, account = ""): boolean {
  return (
    f.branch_id !== (a.branch_id ?? "") ||
    f.acquisition_date !== a.acquisition_date ||
    n(f.cost) !== n(a.cost) ||
    n(f.salvage_value) !== n(a.salvage_value) ||
    Number(f.useful_life_months) !== Number(a.useful_life_months) ||
    f.funding !== (a.funding ?? "") ||
    (f.funding === "paid" && (f.method || "cash") !== (a.payment_method || "cash")) ||
    (f.funding === "paid" && account.trim() !== "")
  );
}

/** The form opened on an existing asset. */
export function formOfAsset(a: AssetLike & { notes?: string | null }): AssetForm {
  return {
    name: a.name,
    category: a.category ?? "",
    branch_id: a.branch_id ?? "",
    acquisition_date: a.acquisition_date,
    cost: String(a.cost),
    salvage_value: String(a.salvage_value ?? 0),
    useful_life_months: String(a.useful_life_months),
    funding: a.funding ?? "",
    method: a.payment_method || "cash",
    notes: a.notes ?? "",
  };
}

const fmt = (v: number) => Number(v || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

/** What cancelling does, in words, before the owner confirms. */
export function cancelEffect(a: AssetLike, accum: number, methodLabel = (m: string) => m): string[] {
  const out: string[] = [];
  if (a.status === "disposed") out.push("التخلص منه هيتلغي في يومه (لو دخلت فلوس من بيعه هتطلع من نفس الخزنة في نفس اليوم).");
  if (a.funding === "paid") {
    out.push(`الـ ${fmt(a.cost)} اللي اتدفعت من ${methodLabel(a.payment_method || "cash")} هترجع الخزنة يوم ${a.acquisition_date}.`);
  } else {
    out.push(`الأصل يخرج من الدفاتر بـ ${fmt(a.cost)} — الخزنة مش بتتأثر (كان رصيد افتتاحي).`);
    out.push("لو كنت حاطه في «الفرق بين رأس المال والدفاتر»، الفرق هيرجع يظهر هناك.");
  }
  if (accum > 0) out.push(`الإهلاك اللي اتحسب (${fmt(accum)}) هيتلغي كل شهر في شهره — الربح بتاع الشهور دي هيزيد بنفس المبلغ.`);
  out.push("الأصل يفضل في السجل «ملغي» بالسبب، ومفيش حاجة بتتمسح.");
  return out;
}

export const STATUS_LABEL: Record<AssetStatus, string> = { active: "نشط", disposed: "مستبعد", cancelled: "ملغي" };

/** The cards add up only what is still in the books: a sold asset left 1500 / 1590, a cancelled one never counted. */
export function liveAssets<T extends { status: AssetStatus }>(list: T[]): T[] {
  return list.filter(a => a.status === "active");
}
