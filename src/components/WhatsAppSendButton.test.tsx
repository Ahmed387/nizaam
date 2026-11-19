import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(() => Promise.resolve({ error: null })) } }));
const nav = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => nav }));

import { WhatsAppSendButton } from "./WhatsAppSendButton";

const FIX = "/branch/b1/contacts/c1?fix=phone&back=%2Fbranch%2Fb1%2Fsales%2Fi1";
let open: ReturnType<typeof vi.fn>;
beforeEach(() => { nav.mockReset(); open = vi.fn(); (window as any).open = open; });

describe("زرار الواتساب — رقم مش موجود ← تنبيه ← صفحة الحساب (owner 2026-11-19)", () => {
  it("a saved mobile opens WhatsApp at once", () => {
    render(<WhatsAppSendButton phone="01001234567" contactId="c1" canSavePhone fixPath={FIX} buildText={() => "hi"} />);
    fireEvent.click(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }));
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/201001234567\?text=hi$/);
  });

  it("no number: an alert says so and takes him to the customer's page with the phone open", () => {
    render(<WhatsAppSendButton phone={null} contactId="c1" canSavePhone fixPath={FIX} buildText={() => "hi"} />);
    fireEvent.click(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }));
    const alert = screen.getByTestId("wa-problem");
    expect(alert.textContent).toContain("مفيش رقم موبايل متسجل");
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /سجّل رقمه في ملفه/ }));
    expect(nav).toHaveBeenCalledWith(FIX);
  });

  it("a landline: the alert names the number and why WhatsApp can't use it", () => {
    render(<WhatsAppSendButton phone="0862345678" contactId="c1" canSavePhone fixPath={FIX} buildText={() => "hi"} />);
    fireEvent.click(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }));
    expect(screen.getByTestId("wa-problem").textContent).toContain("0862345678");
  });

  it("supplier wording on a purchase invoice", () => {
    render(<WhatsAppSendButton who="supplier" phone={null} contactId="c1" canSavePhone fixPath={FIX} buildText={() => "hi"} />);
    fireEvent.click(screen.getByRole("button", { name: /ابعت للمورد واتساب/ }));
    expect(screen.getByTestId("wa-problem").textContent).toContain("المورد");
  });

  it("no right to edit the account: no trip to the page, he is told who can, and may type the number once", () => {
    render(<WhatsAppSendButton phone={null} contactId="c1" canSavePhone={false} fixPath={null} buildText={() => "hi"} />);
    fireEvent.click(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }));
    expect(screen.queryByRole("button", { name: /سجّل رقمه في ملفه/ })).toBeNull();
    expect(screen.getByTestId("wa-problem").textContent).toContain("اطلب من المدير");
    fireEvent.click(screen.getByRole("button", { name: /اكتب الرقم وابعت المرة دي/ }));
    fireEvent.change(screen.getByLabelText("الموبايل"), { target: { value: "01112223334" } });
    fireEvent.click(screen.getByRole("button", { name: /افتح واتساب/ }));
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/201112223334\?text=hi$/);
  });

  it("a walk-in sale (no account): straight to typing the number", () => {
    render(<WhatsAppSendButton phone={null} contactId={null} canSavePhone={false} fixPath={null} buildText={() => "hi"} />);
    fireEvent.click(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }));
    expect(screen.queryByTestId("wa-problem")).toBeNull();
    expect(screen.getByLabelText("الموبايل")).toBeTruthy();
  });

  it("highlight: the button is pointed out when the page comes back ready", () => {
    render(<WhatsAppSendButton phone="01001234567" contactId="c1" canSavePhone fixPath={FIX} highlight buildText={() => "hi"} />);
    expect(screen.getByRole("button", { name: /ابعت للعميل واتساب/ }).getAttribute("data-ready")).toBe("1");
  });
});
