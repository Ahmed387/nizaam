import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { accountSectionHtml } from "./vesselAccountPdf";

describe("vessel account PDF section", () => {
  it("shows limits, what is left and the period totals", () => {
    const html = accountSectionHtml(
      { id: "a", payment_method: "vodafone", holder_name: "أحمد", account_number: "01012345678", is_active: true,
        daily_limit: 60000, monthly_limit: 200000, sent_today: 50000, sent_month: 120000, balance: 7000 },
      "فودافون كاش",
      [
        { id: "1", transaction_date: "2026-11-16", created_at: "", branch_name: "عبد المنعم", type: "income", category: "sale",
          amount: 1000, is_fee: false, description: "فاتورة", reference_number: "R1", other_account: "0111" },
        { id: "2", transaction_date: "2026-11-16", created_at: "", branch_name: "عبد المنعم", type: "expense", category: "x",
          amount: 400, is_fee: false, description: "سداد", reference_number: null, other_account: null },
      ], "2026-11-01", "2026-11-16");
    expect(html).toContain("أحمد");
    expect(html).toContain("فودافون كاش");
    expect(html).toMatch(/10,000|10٬000|١٠/); // left today
    expect(html).toContain("كشف الحركات من 2026-11-01 إلى 2026-11-16");
    expect(html).not.toContain("<script");
  });
  it("escapes text", () => {
    const html = accountSectionHtml(
      { id: "a", payment_method: "v", holder_name: "<b>x</b>", account_number: "1", is_active: false,
        daily_limit: null, monthly_limit: null, sent_today: 0, sent_month: 0, balance: 0 }, "v", [], "2026-11-01", "2026-11-02");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("مفيش حركات");
    expect(html).toContain("(موقوف)");
  });
});
