import { describe, expect, it } from "vitest";
import { cancelMessage, docCaption, docFileName, paidWith } from "../../supabase/functions/telegram/format.ts";

const sale = {
  id: 1, kind: "sale", doc_type: "sale", event: "create", title: "فاتورة بيع", number: "IN47906", company: "A & N",
  branch: "معرض عبدالمنعم الغربى", date: "2026-11-16T17:44:25Z", created_at: "2026-11-16T17:44:25Z",
  party: "ام مروان (ناهد سمير)", employee: "محمد ياسر", recipient: null, notes: null, total: 23800, extra: {},
  lines: [{ name: "ثلاجة", qty: 1, price: 23800, total: 23800 }],
  payments: [{ number: "RV-6286", type: "receipt", method: "كاش", amount: 20000, status: "active" },
             { number: "RV-6287", type: "receipt", method: "إنستاباي", amount: 3000, status: "active" }],
  cancel: null, chat: -100, link: "/branch/b/sales/x",
};

describe("documents to the group (0268)", () => {
  it("file name = number - branch - employee", () => {
    expect(docFileName(sale)).toBe("IN47906 - معرض عبدالمنعم الغربى - محمد ياسر.pdf");
    expect(docFileName({ number: "RV/12", branch: null, employee: "—" })).toBe("RV-12.pdf");
  });
  it("the money paid with it is in the same message, by method, and the rest is آجل", () => {
    expect(paidWith(sale.payments)).toEqual({ sum: 23000, text: "كاش 20,000 + إنستاباي 3,000" });
    const c = docCaption(sale, "https://app");
    expect(c).toContain("فاتورة بيع IN47906");
    expect(c).toContain("اتقبض معاه 23,000");
    expect(c).toContain("آجل 800");
    expect(c).toContain("بواسطة: محمد ياسر");
    expect(c).toContain('href="https://app/branch/b/sales/x"');
  });
  it("a voucher shows its amount, method and item", () => {
    const v = { ...sale, kind: "voucher", doc_type: "payment", title: "سند صرف", number: "PV-7100", total: 500,
      extra: { method: "كاش", category: "اجرة توكتوك" }, payments: [], lines: [] };
    const c = docCaption(v);
    expect(c).toContain("💸");
    expect(c).toContain("المبلغ: <b>500</b> — كاش");
    expect(c).toContain("اجرة توكتوك");
  });
  it("«اتلغى» with reason and who", () => {
    const m = cancelMessage({ ...sale, event: "cancel", cancel: { reason: "غلط في السعر", by: "احمد ناصر", at: "2026-11-18T19:00:00Z" } });
    expect(m).toContain("اتلغى: فاتورة بيع IN47906");
    expect(m).toContain("السبب: غلط في السعر");
    expect(m).toContain("ألغاه: احمد ناصر");
  });
  it("names are escaped for Telegram HTML", () => {
    expect(docCaption({ ...sale, party: "A<b>&" })).toContain("A&lt;b&gt;&amp;");
  });
});
