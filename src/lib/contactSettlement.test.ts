import { describe, it, expect } from "vitest";
import { settleDirections, settleEffect, settleProblem } from "./contactSettlement";

describe("«تسوية رصيد بدون فلوس» button (0148)", () => {
  const today = "2026-11-04";
  const kiriazi = { branchId: "b1", side: "supplier" as const, direction: "we_owe_less" as const, amount: 661343.01, date: "2026-03-31", reason: "بونص آخر العام 2025" };

  it("a supplier only gets «نقلل اللي علينا ليه»; a customer gets both", () => {
    expect(settleDirections("supplier").map((d) => d.value)).toEqual(["we_owe_less"]);
    expect(settleDirections("customer").map((d) => d.value)).toEqual(["he_owes_less", "we_owe_less"]);
  });

  it("the effect line says the till does not move and 2026 profit stays", () => {
    const e = settleEffect("supplier", "we_owe_less", 661343.01);
    expect(e).toContain("اللي علينا للمورد يقل");
    expect(e).toContain("661,343.01");
    expect(e).toContain("الخزنة الحقيقية ما تتحركش");
    expect(settleEffect("customer", "he_owes_less", 58283.77)).toContain("اللي على العميل يقل");
    expect(settleEffect("customer", null, 10)).toBe("");
  });

  it("checks what was typed before calling the server", () => {
    expect(settleProblem(kiriazi, today)).toBeNull();
    expect(settleProblem({ ...kiriazi, branchId: null }, today)).toContain("الفرع");
    expect(settleProblem({ ...kiriazi, direction: "he_owes_less" }, today)).toContain("مرتجع شراء");
    expect(settleProblem({ ...kiriazi, amount: 0 }, today)).toContain("المبلغ");
    expect(settleProblem({ ...kiriazi, date: "2025-12-31" }, today)).toContain("2026");
    expect(settleProblem({ ...kiriazi, date: "2026-11-05" }, today)).toContain("ماجاش");
    expect(settleProblem({ ...kiriazi, reason: " " }, today)).toContain("السبب");
  });
});

import {
  balanceText, branchesWithBalance, directionAllowed, overBalance, balanceAfter, toBalanceResult, toBalanceEffect, toBalanceProblem,
  settleKindText, sideNet, type BranchBalance,
} from "./contactSettlement";

describe("0291: a settlement reads his balance in the branch", () => {
  const info: BranchBalance[] = [
    { branch_id: "sk", branch: "سكة", customer: 3600, supplier: 17100 },
    { branch_id: "ab", branch: "عبدالمنعم", customer: -250, supplier: 0 },
    { branch_id: "sh", branch: "شلبى", customer: 0, supplier: 0 },
  ];
  it("lists only the branches where that side has a balance", () => {
    expect(branchesWithBalance(info, "customer").map((b) => b.branch_id)).toEqual(["sk", "ab"]);
    expect(branchesWithBalance(info, "supplier").map((b) => b.branch_id)).toEqual(["sk"]);
    expect(sideNet(info, "ab", "customer")).toBe(-250);
    expect(sideNet(info, null, "customer")).toBe(0);
  });
  it("says the balance in words", () => {
    expect(balanceText("customer", 3600)).toBe("عليه 3,600 ج.م");
    expect(balanceText("customer", -250)).toBe("ليه عندنا 250 ج.م");
    expect(balanceText("supplier", 17100)).toBe("علينا ليه 17,100 ج.م");
    expect(balanceText("supplier", -40)).toBe("عليه لينا 40 ج.م");
    expect(balanceText("customer", 0)).toBe("مفيش رصيد");
  });
  it("only the direction that matches the balance is allowed", () => {
    expect(directionAllowed("customer", "he_owes_less", 3600)).toBe(true);
    expect(directionAllowed("customer", "we_owe_less", 3600)).toBe(false);
    expect(directionAllowed("customer", "we_owe_less", -250)).toBe(true);
    expect(directionAllowed("customer", "he_owes_less", -250)).toBe(false);
    expect(directionAllowed("supplier", "we_owe_less", 17100)).toBe(true);
    expect(directionAllowed("supplier", "we_owe_less", -40)).toBe(false);
    expect(directionAllowed("customer", "he_owes_less", 0)).toBe(false);
  });
  it("an amount above the balance asks the owner, and shows where it lands", () => {
    expect(overBalance(3600, 3600)).toBe(false);
    expect(overBalance(3600, 5000)).toBe(true);
    expect(overBalance(-250, 300)).toBe(true);
    expect(balanceAfter(3600, 1000)).toBe(2600);
    expect(balanceAfter(3600, 5000)).toBe(-1400);
    expect(balanceAfter(-250, 100)).toBe(-150);
  });
});

describe("0291: «تسوية برصيد» — the difference is a gain or a loss", () => {
  it("customer 3,600 → 2,000 is a loss of 1,600; → 2,400 from 2,000 is a gain of 400", () => {
    expect(toBalanceResult("customer", 3600, 2000)).toEqual({ result: "loss", amount: 1600, flips: false });
    expect(toBalanceResult("customer", 2000, 2400)).toEqual({ result: "gain", amount: 400, flips: false });
  });
  it("supplier 17,100 → 16,000 is a gain of 1,100; → 17,600 a loss of 500", () => {
    expect(toBalanceResult("supplier", 17100, 16000)).toEqual({ result: "gain", amount: 1100, flips: false });
    expect(toBalanceResult("supplier", 17100, 17600)).toEqual({ result: "loss", amount: 500, flips: false });
  });
  it("a target on the other side flips; the same balance is nothing", () => {
    expect(toBalanceResult("customer", 2000, -500)).toEqual({ result: "loss", amount: 2500, flips: true });
    expect(toBalanceResult("customer", 2000, 2000)).toBeNull();
    expect(toBalanceResult("customer", 2000, 0)?.flips).toBe(false);
  });
  it("the effect line names the month and the account", () => {
    const e = toBalanceEffect("customer", 3600, 2000, "2026-11-20");
    expect(e).toContain("خسارة 1,600 ج.م");
    expect(e).toContain("نوفمبر 2026");
    expect(e).toContain("خسائر تسوية أرصدة");
    expect(e).toContain("الخزن الحقيقية ما تتحركش");
    expect(toBalanceEffect("supplier", 17100, 16000, "2026-11-20")).toContain("ربح 1,100 ج.م");
    expect(toBalanceEffect("supplier", 17100, 16000, "2026-11-20")).toContain("إيرادات أخرى");
  });
  it("checks what was typed", () => {
    const ok = { branchId: "sk", net: 3600, target: 2000, date: "2026-11-20", reason: "اتفاق" };
    expect(toBalanceProblem(ok, "2026-11-26")).toBeNull();
    expect(toBalanceProblem({ ...ok, branchId: null }, "2026-11-26")).toContain("الفرع");
    expect(toBalanceProblem({ ...ok, net: 0 }, "2026-11-26")).toContain("رصيد");
    expect(toBalanceProblem({ ...ok, target: 3600 }, "2026-11-26")).toContain("مفيش فرق");
    expect(toBalanceProblem({ ...ok, target: NaN }, "2026-11-26")).toContain("الرصيد");
    expect(toBalanceProblem({ ...ok, date: "2026-11-27" }, "2026-11-26")).toContain("ماجاش");
    expect(toBalanceProblem({ ...ok, reason: "" }, "2026-11-26")).toContain("السبب");
  });
  it("the list says what each settlement did", () => {
    expect(settleKindText({ kind: "profit_loss", result: "loss", side: "customer", direction: "he_owes_less" })).toBe("تسوية برصيد · خسارة");
    expect(settleKindText({ kind: "profit_loss", result: "gain", side: "supplier", direction: "we_owe_less" })).toBe("تسوية برصيد · ربح");
    expect(settleKindText({ kind: "prior_years", result: null, side: "customer", direction: "he_owes_less" })).toBe("عميل · قلّ اللي عليه");
    expect(settleKindText({ side: "supplier", direction: "we_owe_less" })).toBe("مورد · قلّ اللي علينا");
  });
});
