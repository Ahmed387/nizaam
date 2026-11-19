import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(() => Promise.resolve("data:image/png;base64,QR")) } }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { TenantTelegramSetup } from "./TenantTelegramSetup";

const OWNER_URL = "https://t.me/Nizam_Taxes_bot?start=004512";
const GROUP_URL = "https://t.me/Nizam_Taxes_bot?startgroup=778899";
const base = {
  bot_ready: true, bot_username: "Nizam_Taxes_bot", group_linked: false, group_title: null, tg_linked: false, tg_username: null,
  docs_enabled: false, daily_report_enabled: false, owner_name: "ناصر", owner_phone: "01001234567", plan_daily_report: true,
  docs_sent_today: 0, docs_failed: 0, waiting: null,
};
let ops: any;
beforeEach(() => {
  ops = { ...base };
  rpc.mockReset();
  rpc.mockImplementation((name: string, args: any) => {
    if (name === "super_tg_invite") return Promise.resolve({ data: args.p_purpose === "group"
      ? { url: GROUP_URL, code: "778899", expires_in: 900 } : { url: OWNER_URL, code: "004512", expires_in: 900 }, error: null });
    if (name === "super_tg_docs_set") { ops = { ...ops, docs_enabled: args.p_enabled }; return Promise.resolve({ data: ops, error: null }); }
    if (name === "super_tg_daily_set") { ops = { ...ops, daily_report_enabled: args.p_enabled }; return Promise.resolve({ data: ops, error: null }); }
    return Promise.resolve({ data: ops, error: null }); // super_tenant_ops_get
  });
});

describe("كارت تليجرام الشركة عند صاحب المنصة — 4 خطوات بعلامة ✓ (owner 2026-11-19)", () => {
  it("shows the four steps in order with 0 of 4 done", async () => {
    render(<TenantTelegramSetup tenantId="t1" />);
    const steps = await screen.findAllByTestId(/^tg-step-/);
    expect(steps.map((s) => s.getAttribute("data-testid"))).toEqual(["tg-step-group", "tg-step-owner", "tg-step-docs", "tg-step-daily"]);
    expect(screen.getByTestId("tg-setup-progress").textContent).toContain("0 من 4");
  });

  it("step 1: the group code with QR and «/link» fallback, from super_tg_invite('group')", async () => {
    render(<TenantTelegramSetup tenantId="t1" />);
    fireEvent.click(await screen.findByRole("button", { name: /اعمل كود الجروب/ }));
    await screen.findByTestId("tg-invite-group");
    expect(rpc).toHaveBeenCalledWith("super_tg_invite", { p_tenant: "t1", p_purpose: "group" });
    expect(screen.getByRole("link", { name: /افتح تليجرام/ }).getAttribute("href")).toBe(GROUP_URL);
    expect(screen.getByTestId("tg-invite-group").textContent).toContain("/link 778899");
  });

  it("step 2: the owner's link goes to his saved mobile on WhatsApp, and the card says «اتربط» by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<TenantTelegramSetup tenantId="t1" />);
    fireEvent.click(await screen.findByRole("button", { name: /اعمل لينك صاحب الشركة/ }));
    await screen.findByTestId("tg-invite-owner");
    expect(rpc).toHaveBeenCalledWith("super_tg_invite", { p_tenant: "t1", p_purpose: "owner" });
    expect(screen.getByTestId("tg-code").textContent).toBe("004 512");
    expect(screen.getByRole("link", { name: /ابعت اللينك واتساب/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/201001234567\?text=/);
    ops = { ...ops, tg_linked: true, tg_username: "nasser" };
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect((await screen.findByTestId("tg-step-owner")).textContent).toContain("اتربط @nasser");
    expect(screen.queryByTestId("tg-invite-owner")).toBeNull();
    vi.useRealTimers();
  });

  it("step 3 waits for the group, then the switch calls super_tg_docs_set", async () => {
    render(<TenantTelegramSetup tenantId="t1" />);
    const docs = await screen.findByTestId("tg-step-docs");
    expect(docs.textContent).toContain("اربط الجروب الأول");
    expect(within(docs).getByRole("switch")).toBeDisabled();
  });

  it("with the group linked, the documents switch turns on", async () => {
    ops = { ...base, group_linked: true, group_title: "A&N" };
    render(<TenantTelegramSetup tenantId="t1" />);
    const docs = await screen.findByTestId("tg-step-docs");
    fireEvent.click(within(docs).getByRole("switch"));
    await act(async () => {});
    expect(rpc).toHaveBeenCalledWith("super_tg_docs_set", { p_tenant: "t1", p_enabled: true });
    expect((await screen.findByTestId("tg-setup-progress")).textContent).toContain("2 من 4");
  });

  it("step 4 waits for the owner's Telegram; once linked the switch calls super_tg_daily_set", async () => {
    render(<TenantTelegramSetup tenantId="t1" />);
    expect((await screen.findByTestId("tg-step-daily")).textContent).toContain("اربط تليجرام صاحب الشركة الأول");
  });

  it("daily report switch", async () => {
    ops = { ...base, tg_linked: true };
    render(<TenantTelegramSetup tenantId="t1" />);
    const daily = await screen.findByTestId("tg-step-daily");
    fireEvent.click(within(daily).getByRole("switch"));
    await act(async () => {});
    expect(rpc).toHaveBeenCalledWith("super_tg_daily_set", { p_tenant: "t1", p_enabled: true });
  });

  it("all done: 4 of 4 and a ✓ on every step", async () => {
    ops = { ...base, group_linked: true, group_title: "A&N", tg_linked: true, tg_username: "n", docs_enabled: true, daily_report_enabled: true };
    render(<TenantTelegramSetup tenantId="t1" />);
    expect((await screen.findByTestId("tg-setup-progress")).textContent).toContain("4 من 4");
    expect(screen.getAllByTestId("tg-step-done")).toHaveLength(4);
  });
});
