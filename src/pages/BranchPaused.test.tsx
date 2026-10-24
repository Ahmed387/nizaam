import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: vi.fn() }) }));

import BranchPaused from "./BranchPaused";

const show = () => render(<MemoryRouter><BranchPaused /></MemoryRouter>);

describe("BranchPaused screen", () => {
  beforeEach(() => rpc.mockReset());

  it("names the paused branch from my_paused_branches", async () => {
    rpc.mockResolvedValue({ data: [{ id: "b1", name: "فرع المعادي" }], error: null });
    show();
    expect(await screen.findByRole("heading", { name: "فرع فرع المعادي موقوف مؤقتاً" })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("my_paused_branches");
    expect(screen.getByText(/بيانات الفرع كلها محفوظة/)).toBeInTheDocument();
  });

  it("joins two paused branches", async () => {
    rpc.mockResolvedValue({ data: [{ id: "b1", name: "أ" }, { id: "b2", name: "ب" }], error: null });
    show();
    expect(await screen.findByRole("heading", { name: "فرع أ و ب موقوف مؤقتاً" })).toBeInTheDocument();
  });

  it("without a paused branch says the account has no working branch", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    show();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "مفيش فرع شغال على حسابك" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسجيل خروج" })).toBeInTheDocument();
  });
});
