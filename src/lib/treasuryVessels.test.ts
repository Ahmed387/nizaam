import { describe, expect, it } from "vitest";
import { detailFilter, methodOfWord, vesselMeaning, vesselWord } from "./treasuryVessels";

const custom = { paymob: "PayMob", safe: "الخزينة", old_drawer: "درج النقدية القديم", company_offers: "خصومات / عروض الشركات" };

describe("vesselWord", () => {
  it("keeps the built-in words", () => {
    expect(vesselWord("cash", custom)).toBe("كاش");
    expect(vesselWord("vodafone", custom)).toBe("محفظة");
    expect(vesselWord("instapay", custom)).toBe("انستاباي");
    expect(vesselWord("bank", custom)).toBe("بنكي");
  });
  it("shows a settings vessel by its own name, not «كاش»", () => {
    expect(vesselWord("paymob", custom)).toBe("PayMob");
    expect(vesselWord("safe", custom)).toBe("الخزينة");
    expect(vesselWord("old_drawer", custom)).toBe("درج النقدية القديم");
  });
  it("falls back to the key when the name is not loaded yet", () => {
    expect(vesselWord("paymob", {})).toBe("paymob");
  });
});

describe("methodOfWord", () => {
  it("maps words back to vessel keys", () => {
    expect(methodOfWord("كاش", custom)).toBe("cash");
    expect(methodOfWord("PayMob", custom)).toBe("paymob");
    expect(methodOfWord("الخزينة", custom)).toBe("safe");
    expect(methodOfWord("paymob", {})).toBeNull();
    expect(methodOfWord("", custom)).toBeNull();
  });
});

describe("vesselMeaning", () => {
  it("explains a virtual vessel as not real money", () => {
    expect(vesselMeaning("company_offers", "خصومات / عروض الشركات", "virtual")).toContain("وعاء حسابي");
    expect(vesselMeaning("paymob", "PayMob", "wallet")).toContain("«PayMob»");
    expect(vesselMeaning("cash", "كاش")).toContain("درج");
  });
});

describe("detailFilter", () => {
  it("balance card shows every row from the first day", () => {
    expect(detailFilter({ kind: "balance" })).toMatchObject({ type: "all", method: null, allTime: true });
  });
  it("income / expense cards keep the period and pick the type", () => {
    expect(detailFilter({ kind: "income" })).toMatchObject({ type: "income", allTime: false });
    expect(detailFilter({ kind: "expense" })).toMatchObject({ type: "expense", allTime: false });
    expect(detailFilter({ kind: "net" })).toMatchObject({ type: "all", allTime: false, method: null });
  });
  it("a vessel card picks the vessel", () => {
    expect(detailFilter({ kind: "channel", method: "paymob", label: "PayMob" })).toMatchObject({ method: "paymob", label: "حركات «PayMob» في الفترة دي" });
  });
  it("an account row picks the vessel and the number, all time", () => {
    const f = detailFilter({ kind: "account", method: "instapay", methodLabel: "انستاباي", accountId: "a1", accountName: "محمد 0101" });
    expect(f).toMatchObject({ method: "instapay", allTime: true, account: { id: "a1" } });
    expect(detailFilter({ kind: "account", method: "vodafone", methodLabel: "فودافون", accountId: null, accountName: "x" }).account).toEqual({ id: null });
  });
});
