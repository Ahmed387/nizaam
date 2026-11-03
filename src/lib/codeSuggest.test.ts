import { describe, it, expect } from "vitest";
import { editDistance, matchProducts, similarCodes } from "./codeSuggest";

const fan = { id: "1", name: "مروحة حائط جامبو بريفكس، 21 بوصة، 3 سرعات، بالريموت ,WFJ211 - اسود", sku: "WFJ211", legacy_code: "7788" };
const fan2 = { id: "2", name: "مروحة حائط جامبو 18 بوصة", sku: "WFJ221", legacy_code: null };
const fridge = { id: "3", name: "تلاجة توشيبا 14 قدم", sku: "GRRT16", legacy_code: "1234" };
const all = [fan, fan2, fridge];

describe("stock-transfer search (0143)", () => {
  it("«مروحه 211» finds the fan like the sale screen (ة = ه, words in any order)", () => {
    expect(matchProducts("مروحه 211", all).map((p) => p.id)).toEqual(["1"]);
    expect(matchProducts("حائط اسود", all).map((p) => p.id)).toEqual(["1"]);
  });
  it("an exact code comes first", () => {
    expect(matchProducts("WFJ221", all)[0].id).toBe("2");
  });
  it("a code one or two letters away is suggested", () => {
    expect(editDistance("wfj211", "wfj221")).toBe(1);
    const s = similarCodes("WFJ212", all);
    expect(s.map((x) => x.item.id)).toEqual(["1", "2"]);
    expect(similarCodes("GRT16", all).map((x) => x.item.id)).toEqual(["3"]);
  });
  it("no suggestions for names or very short text, and none for what already matched", () => {
    expect(similarCodes("مروحة حائط", all)).toEqual([]);
    expect(similarCodes("WF", all)).toEqual([]);
    expect(similarCodes("WFJ211", all, new Set(["1"])).map((x) => x.item.id)).toEqual(["2"]);
  });
});
