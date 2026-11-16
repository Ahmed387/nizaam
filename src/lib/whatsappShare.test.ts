import { describe, expect, it } from "vitest";
import { saleMessage, waLink, waPhone } from "./whatsappShare";

describe("whatsapp share", () => {
  it("Egyptian numbers", () => {
    expect(waPhone("01001234567")).toBe("201001234567");
    expect(waPhone("010 0123 4567")).toBe("201001234567");
    expect(waPhone("+20 100 123 4567")).toBe("201001234567");
    expect(waPhone("00201001234567")).toBe("201001234567");
    expect(waPhone("٠١٠٠١٢٣٤٥٦٧")).toBe("201001234567");
    expect(waPhone("1001234567")).toBe("201001234567");
    expect(waPhone("0862345678")).toBeNull(); // landline
    expect(waPhone("")).toBeNull();
    expect(waPhone(null)).toBeNull();
  });
  it("message", () => {
    const t = saleMessage({ customer: "محمد علاء", number: "IN05120", branch: "معرض عبد المنعم", date: "16/11/2026",
      items: [{ name: "غسالة فريش 10 ك", quantity: 1, total: 14500 }, { name: "مكواة توشيبا", quantity: 2, total: 1800 }],
      total: 16300, paid: 10000, remaining: 6300 });
    expect(t).toContain("السلام عليكم أ/ محمد علاء");
    expect(t).toContain("فاتورة رقم IN05120 — معرض عبد المنعم — 16/11/2026");
    expect(t).toContain("• مكواة توشيبا × 2 = 1,800");
    expect(t).toContain("الإجمالي: 16,300");
    expect(t).toContain("الباقي عليك: 6,300");
    expect(saleMessage({ customer: null, number: "IN1", branch: null, date: "1/1/2026", items: [], total: 5, paid: 5, remaining: 0 }))
      .toContain("مدفوعة بالكامل");
    expect(waLink("201001234567", "أ b")).toBe("https://wa.me/201001234567?text=%D8%A3%20b");
  });
});
