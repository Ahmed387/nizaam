import { describe, expect, it } from "vitest";
import { sharedDocPath, withPdfLink } from "./docPdfLink";

describe("WhatsApp PDF link (0278)", () => {
  it("one file per document inside the company's folder", () => {
    expect(sharedDocPath("5316fbfe-b862-4c91-b48b-1d81c8aa5a71", "sale", "abc-123")).toBe("5316fbfe-b862-4c91-b48b-1d81c8aa5a71/sale-abc-123.pdf");
  });
  it("no folder tricks from the id", () => {
    expect(sharedDocPath("t1", "sale", "../x/y")).toBe("t1/sale-xy.pdf");
  });
  it("the link goes under the message with how long it works", () => {
    const t = withPdfLink("أهلاً يا احمد\nفاتورة IN47800 بـ 7,000\n", "https://x.supabase.co/sign/a.pdf?token=1");
    expect(t).toBe("أهلاً يا احمد\nفاتورة IN47800 بـ 7,000\n\n📄 الفاتورة PDF:\nhttps://x.supabase.co/sign/a.pdf?token=1\n(اللينك شغال 7 أيام)");
  });
});
