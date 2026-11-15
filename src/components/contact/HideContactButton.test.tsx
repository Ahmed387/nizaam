import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let owner = true;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isOwner: owner }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { HideContactButton } from "./HideContactButton";

const show = (p: Partial<{ internalBranch: boolean }> = {}) =>
  render(<MemoryRouter><HideContactButton contactId="c1" contactName="أ/ منتصر صالح" {...p} /></MemoryRouter>);

describe("«إخفاء الحساب» button (migration 0226)", () => {
  let hidden = false;
  beforeEach(() => {
    owner = true; hidden = false; rpc.mockReset();
    rpc.mockImplementation((name: string, a: any) => {
      if (name === "contact_is_hidden") return Promise.resolve({ data: hidden, error: null });
      if (name === "set_contact_hidden") { hidden = a.p_hidden; return Promise.resolve({ data: { hidden: a.p_hidden }, error: null }); }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("the owner hides an account: dialog explains, reason sent, then it shows «مخفي» + «إظهار»", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /إخفاء/ }));
    expect(await screen.findByText(/هيختفوا عن أي حد غيرك/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/السبب/), { target: { value: "خاص" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^إخفاء$/ }).pop()!);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_contact_hidden", { p_contact: "c1", p_hidden: true, p_reason: "خاص" }));
    expect(await screen.findByText(/مخفي عن الكل غيرك/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /إظهار/ })).toBeTruthy();
  });

  it("a hidden account opens with «إظهار», which shows it again", async () => {
    hidden = true;
    show();
    fireEvent.click(await screen.findByRole("button", { name: /إظهار/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /^إظهار$/ }).pop()!);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_contact_hidden", { p_contact: "c1", p_hidden: false, p_reason: null }));
  });

  it("nobody but the owner sees it, and it never asks the server", async () => {
    owner = false;
    const { container } = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("not offered on one of our branches' own accounts", async () => {
    const { container } = show({ internalBranch: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });
});
