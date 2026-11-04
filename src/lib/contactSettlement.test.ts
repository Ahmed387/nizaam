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
