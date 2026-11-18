import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } } }));

import OwnerContactTelegram from "./OwnerContactTelegram";

const URL_ = "https://t.me/Nizam_Taxes_bot?start=0123456789abcdef01234567";
const contact = { owner_name: "ناصر", owner_phone: "01001234567", owner_email: null, tg_linked: false, tg_username: null, tg_linked_at: null,
  group_linked: true, group_title: "فواتير A&N", group_linked_at: null, tg_last_error: null, tg_last_error_at: null, tg_last_sent_at: null,
  bot_ready: true, bot_username: "Nizam_Taxes_bot", is_owner: true };

describe("ربط تليجرام الشخصي — steps written on the page (owner 2026-11-18)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation((name: string) => Promise.resolve(name === "tg_link_start"
      ? { data: { url: URL_, expires_in: 900 }, error: null } : { data: contact, error: null }));
  });

  it("explains this phone vs. the company owner's phone, 15 minutes, and the test message", async () => {
    render(<OwnerContactTelegram />);
    const steps = await screen.findByTestId("tg-owner-steps");
    expect(steps.textContent).toContain("لو التقرير لصاحب الشركة على موبايل تاني");
    expect(steps.textContent).toContain("15 دقيقة");
    expect(steps.textContent).toContain("ابعت رسالة تجربة");
  });

  it("«جهّز لينك الربط» shows buttons to tap: open Telegram, WhatsApp to the saved mobile, copy, and the /start code", async () => {
    render(<OwnerContactTelegram />);
    fireEvent.click(await screen.findByRole("button", { name: /جهّز لينك الربط/ }));
    const box = await screen.findByTestId("tg-owner-invite");
    expect(screen.getByRole("link", { name: /افتح تليجرام/ }).getAttribute("href")).toBe(URL_);
    expect(screen.getByRole("link", { name: /ابعت اللينك واتساب/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/201001234567\?text=/);
    expect(box.textContent).toContain("/start 0123456789abcdef01234567");
    expect(box.textContent).toMatch(/باقي 1[45]:\d\d/);
  });
});
