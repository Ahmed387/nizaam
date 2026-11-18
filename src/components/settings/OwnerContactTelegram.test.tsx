import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(() => Promise.resolve("data:image/png;base64,QR")) } }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } } }));

import OwnerContactTelegram from "./OwnerContactTelegram";

const OWNER_URL = "https://t.me/Nizam_Taxes_bot?start=004512";
const GROUP_URL = "https://t.me/Nizam_Taxes_bot?startgroup=778899";
const base = { owner_name: "ناصر", owner_phone: "01001234567", owner_email: null, tg_linked: false, tg_username: null, tg_linked_at: null,
  group_linked: false, group_title: null, group_linked_at: null, tg_last_error: null, tg_last_error_at: null, tg_last_sent_at: null,
  bot_ready: true, bot_username: "Nizam_Taxes_bot", is_owner: true };

let contact: any;
let status: any;
beforeEach(() => {
  contact = { ...base };
  status = { owner_linked: false, group_linked: false };
  rpc.mockReset();
  rpc.mockImplementation((name: string, args: any) => Promise.resolve(
    name === "tg_link_start"
      ? { data: args.p_purpose === "group" ? { url: GROUP_URL, code: "778899", expires_in: 900 } : { url: OWNER_URL, code: "004512", expires_in: 900 }, error: null }
      : name === "tg_link_status" ? { data: status, error: null }
      : { data: contact, error: null }));
});

describe("ربط تليجرام — easy for every company (owner 2026-11-18 «نفذه بالكامل مع وضع الخطوات»)", () => {
  it("writes the steps for the personal link on the page", async () => {
    render(<OwnerContactTelegram />);
    const steps = await screen.findByTestId("tg-owner-steps");
    expect(steps.textContent).toContain("صوّر الكود");
    expect(steps.textContent).toContain("6 أرقام");
    expect(steps.textContent).toContain("15 دقيقة");
    expect(steps.textContent).toContain("ابعت رسالة تجربة");
  });

  it("personal: QR, the 6-digit code big, open Telegram, WhatsApp to the saved mobile, copy", async () => {
    render(<OwnerContactTelegram />);
    fireEvent.click(await screen.findByRole("button", { name: /اربط تليجرامك/ }));
    const box = await screen.findByTestId("tg-invite-owner");
    expect((await screen.findByTestId("tg-qr")).getAttribute("src")).toBe("data:image/png;base64,QR");
    expect(screen.getByTestId("tg-code").textContent).toBe("004 512");
    expect(screen.getByRole("link", { name: /افتح تليجرام/ }).getAttribute("href")).toBe(OWNER_URL);
    expect(screen.getByRole("link", { name: /ابعت اللينك واتساب/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/201001234567\?text=/);
    expect(box.textContent).toMatch(/باقي 1[45]:\d\d/);
  });

  it("group: steps, QR of the add-to-group link and «/link» typed in the group as a fallback", async () => {
    render(<OwnerContactTelegram />);
    expect((await screen.findByTestId("tg-group-steps")).textContent).toContain("اختار الجروب");
    fireEvent.click(screen.getByRole("button", { name: /اربط الجروب/ }));
    const box = await screen.findByTestId("tg-invite-group");
    expect(screen.getByRole("link", { name: /افتح تليجرام/ }).getAttribute("href")).toBe(GROUP_URL);
    expect(box.textContent).toContain("/link 778899");
  });

  it("the page notices the link by itself and says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<OwnerContactTelegram />);
    fireEvent.click(await screen.findByRole("button", { name: /اربط تليجرامك/ }));
    await screen.findByTestId("tg-invite-owner");
    status = { owner_linked: true, group_linked: false };
    contact = { ...base, tg_linked: true, tg_linked_at: "2026-11-18T16:00:00Z" };
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(await screen.findByTestId("tg-owner-done")).toBeTruthy();
    expect(screen.queryByTestId("tg-invite-owner")).toBeNull();
    vi.useRealTimers();
  });
});
