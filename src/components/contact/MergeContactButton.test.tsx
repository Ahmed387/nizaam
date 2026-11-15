import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isOwner: true, tenantId: "t1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({}) } }));

import { MergeContactButton } from "./MergeContactButton";

// the real answer of merge_contact_candidates for «النقابة المعلمين» (سكة), dry-run 2026-11-15
const SIMILAR = { mode: "similar", words: ["نقابه", "معلمين"], results: [
  { id: "a356", name: "اسماء النقابة", account_no: 356, phone: null, type: "customer", branch_id: "b3", branch_name: "معرض سكة تلة", same_branch: true,
    customer_balance: 0, supplier_balance: 0, net: 0, opening_balance: 0, shared_words: 1, documents: 1, can_merge: true, why_not: null },
  { id: "a629", name: "نقابة المعلمين", account_no: 629, phone: null, type: "customer", branch_id: "b4", branch_name: "معرض عبدالمنعم الغربى", same_branch: false,
    customer_balance: 250622.75, supplier_balance: 0, net: 250622.75, opening_balance: 0, shared_words: 2, documents: 80, can_merge: false,
    why_not: "في فرع تاني — الدمج جوه الفرع الواحد بس" },
] };

const show = () => render(<MemoryRouter><MergeContactButton contactId="me" contactName="النقابة المعلمين" openingBalance={0} /></MemoryRouter>);

describe("«دمج حسابين» search (migration 0223, owner answer «ب»)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation((name: string, args: any) => {
      if (name === "merge_contact_candidates") {
        if (!args.p_query) return Promise.resolve({ data: SIMILAR, error: null });
        return Promise.resolve({ data: { mode: "search", words: [], results: SIMILAR.results }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("opens on similar names before anything is typed, other branches listed but not pickable", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /دمج حساب تاني/ }));
    expect(await screen.findByText(/حسابات اسمها قريب من «النقابة المعلمين»/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("merge_contact_candidates", { p_contact: "me", p_query: null });
    const other = screen.getByRole("button", { name: /نقابة المعلمين/ });
    expect(other).toBeDisabled();
    expect(within(other).getByText(/في فرع تاني/)).toBeInTheDocument();
    expect(within(other).getByText(/250,622.75/)).toBeInTheDocument();
    expect(within(other).getByText(/مدين/)).toBeInTheDocument();
    expect(within(other).getByText(/رقم 629/)).toBeInTheDocument();
    expect(screen.getByText("في فروع تانية (مينفعش تتدمج)")).toBeInTheDocument();
  });

  it("searches on the server with what was typed and lets a same-branch account be picked", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /دمج حساب تاني/ }));
    await screen.findByText(/حسابات اسمها قريب/);
    fireEvent.change(screen.getByPlaceholderText(/اكتب أي جزء/), { target: { value: "نقابه" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("merge_contact_candidates", { p_contact: "me", p_query: "نقابه" }));
    fireEvent.click(await screen.findByRole("button", { name: /اسماء النقابة/ }));
    expect(await screen.findByText("هيتشال (يتأرشف)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "معاينة قبل الدمج" })).toBeInTheDocument();
  });

  it("one letter waits; nothing is sent for it", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /دمج حساب تاني/ }));
    await screen.findByText(/حسابات اسمها قريب/);
    rpc.mockClear();
    fireEvent.change(screen.getByPlaceholderText(/اكتب أي جزء/), { target: { value: "ن" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(rpc).not.toHaveBeenCalled();
  });
});
