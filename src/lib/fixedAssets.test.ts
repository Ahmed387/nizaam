import { describe, expect, it } from "vitest";
import { assetMoneyChanged, cancelEffect, formOfAsset, liveAssets, type AssetLike } from "./fixedAssets";

const asset: AssetLike = {
  code: "FA-0001", name: "تكييف", category: "أجهزة", branch_id: "b1", acquisition_date: "2026-01-15",
  cost: 60000, salvage_value: 0, useful_life_months: 60, funding: "opening", payment_method: null, status: "active",
};

describe("fixed asset edit", () => {
  it("name / category / notes only = no money change", () => {
    const f = { ...formOfAsset(asset), name: "تكييف سبليت", category: "تكييفات", notes: "x" };
    expect(assetMoneyChanged(asset, f)).toBe(false);
  });
  it("cost, date, life, branch or funding = money change", () => {
    const f = formOfAsset(asset);
    expect(assetMoneyChanged(asset, { ...f, cost: "48000" })).toBe(true);
    expect(assetMoneyChanged(asset, { ...f, acquisition_date: "2026-03-10" })).toBe(true);
    expect(assetMoneyChanged(asset, { ...f, useful_life_months: "48" })).toBe(true);
    expect(assetMoneyChanged(asset, { ...f, branch_id: "b2" })).toBe(true);
    expect(assetMoneyChanged(asset, { ...f, funding: "paid" })).toBe(true);
  });
  it("same cost typed differently is not a change", () => {
    expect(assetMoneyChanged(asset, { ...formOfAsset(asset), cost: "60000.00" })).toBe(false);
  });
  it("paid asset: another vessel is a money change", () => {
    const paid = { ...asset, funding: "paid" as const, payment_method: "cash" };
    expect(assetMoneyChanged(paid, { ...formOfAsset(paid), method: "instapay" })).toBe(true);
    expect(assetMoneyChanged(paid, formOfAsset(paid))).toBe(false);
  });
});

describe("cancel effect", () => {
  it("opening asset: books only, gap card comes back, depreciation reversed", () => {
    const t = cancelEffect(asset, 9000).join(" ");
    expect(t).toContain("الخزنة مش بتتأثر");
    expect(t).toContain("الفرق بين رأس المال والدفاتر");
    expect(t).toContain("9,000");
  });
  it("paid asset: money back to its vessel on its day", () => {
    const t = cancelEffect({ ...asset, funding: "paid", payment_method: "cash" }, 0, () => "كاش").join(" ");
    expect(t).toContain("هترجع الخزنة يوم 2026-01-15");
    expect(t).not.toContain("الإهلاك");
  });
  it("disposed asset: the disposal is undone first", () => {
    expect(cancelEffect({ ...asset, status: "disposed" }, 0)[0]).toContain("التخلص منه هيتلغي");
  });
  it("only active assets are in the totals", () => {
    expect(liveAssets([{ status: "active" as const }, { status: "cancelled" as const }, { status: "disposed" as const }])).toHaveLength(1);
  });
});
