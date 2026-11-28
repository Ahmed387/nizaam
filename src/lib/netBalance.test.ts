import { describe, expect, it } from "vitest";
import { balanceScope, netAfter, netBefore, netFromStatement, netOf, netOfSides, netText } from "@/lib/netBalance";

const plain = (s: string) => s.replace(/ /g, " ");

describe("الرصيد الحالي — one net balance (owner PDF 2026-11-28)", () => {
  it("net = supplier side − customer side; + دائن, − مدين, no minus sign on screen", () => {
    expect(netOf(316269.95, 0)).toBe(-316269.95);
    expect(plain(netText(netOf(316269.95, 0)))).toContain("مدين");
    expect(netText(netOf(316269.95, 0))).not.toContain("-");
    expect(plain(netText(netOf(0, 82400)))).toContain("دائن");
    expect(netText(netOf(500, 500))).toBe("مسدد");
    expect(netOfSides(null)).toBe(0);
  });

  it("the statement's sign (+ = مدين) is the opposite of the screen's net (+ = دائن)", () => {
    // a customer who owes 1,000 and a supplier side of 300: statement balance = 700 (مدين)
    expect(netFromStatement(1000 - 300)).toBe(netOf(1000, 300));
    expect(netFromStatement(-250)).toBe(250);
  });

  it("voucher: «الرصيد بعد السند» (PDF 2.1)", () => {
    const now = netOf(316269.95, 0);
    expect(netAfter(now, "receipt", 100000)).toBe(-216269.95);
    expect(netAfter(now, "payment", 100000)).toBe(-416269.95);
  });

  it("invoice views: before / after (PDF 2.3)", () => {
    const now = netOf(316269.95, 0);
    expect(netAfter(now, "sale", 50000)).toBe(-366269.95);
    expect(netAfter(now, "purchase", 40000)).toBe(-276269.95);
    // an invoice already in the account: before = now − its effect
    expect(netBefore(-366269.95, "sale", 50000)).toBe(-316269.95);
  });

  it("scope written next to the number", () => {
    expect(balanceScope(false)).toBe("الفرع ده");
    expect(balanceScope(true)).toBe("كل الفروع");
  });
});
