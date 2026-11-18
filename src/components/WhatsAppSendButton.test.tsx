import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { WhatsAppSendButton } from "./WhatsAppSendButton";

const opened: string[] = [];
beforeEach(() => {
  opened.length = 0; rpc.mockReset(); rpc.mockResolvedValue({ data: {}, error: null });
  vi.stubGlobal("open", (url: string) => { opened.push(url); return null; });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

const show = (p: Partial<{ phone: string | null; contactId: string | null; canSavePhone: boolean }> = {}) =>
  render(<WhatsAppSendButton phone={null} contactId="c1" canSavePhone buildText={() => "فاتورة رقم IN1"} {...p} />);

describe("«ابعت للعميل واتساب» (owner 2026-11-18 «مش شغال»)", () => {
  it("is never disabled — the accounts had no saved mobile, so it never worked", () => {
    show();
    expect((screen.getByRole("button", { name: /ابعت للعميل واتساب/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a saved mobile opens WhatsApp at once with the message", () => {
    show({ phone: "0100 123 4567" });
    fireEvent.click(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }));
    expect(opened).toEqual(["https://wa.me/201001234567?text=" + encodeURIComponent("فاتورة رقم IN1")]);
  });

  it("no number: the cashier types it, a wrong one is refused, a right one opens WhatsApp and is saved", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }));
    const input = await screen.findByLabelText("الموبايل");
    fireEvent.change(input, { target: { value: "0862345678" } });
    expect(screen.getByText(/الرقم ده مش موبايل/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /افتح واتساب/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "01112223334" } });
    fireEvent.click(screen.getByRole("button", { name: /افتح واتساب/ }));
    expect(opened[0]).toMatch(/^https:\/\/wa\.me\/201112223334\?text=/);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_contact", { p_id: "c1", p_data: { phone: "01112223334" } }));
  });

  it("someone who may not edit the account sends without the save box, and nothing is saved", async () => {
    show({ canSavePhone: false });
    fireEvent.click(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }));
    expect(screen.queryByText(/احفظ الرقم/)).toBeNull();
    fireEvent.change(await screen.findByLabelText("الموبايل"), { target: { value: "01001234567" } });
    fireEvent.click(screen.getByRole("button", { name: /افتح واتساب/ }));
    expect(opened.length).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });
});
