import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/cairoDate", () => ({ cairoTodayDay: () => "2026-11-19" }));
vi.mock("@/components/ContactLookup", () => ({
  ContactLookup: ({ onChange }: { onChange: (id: string) => void }) => <button type="button" onClick={() => onChange("sup1")}>اختار مورد</button>,
}));
const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));
vi.mock("@/lib/partners", async (orig) => ({ ...(await orig<any>()), fetchMoneyBranches: () => Promise.resolve([{ id: "br4", name: "عبدالمنعم", code: "FR-004" }]) }));

import { toast } from "sonner";
import { PartnerCapitalWizard } from "./PartnerCapitalWizard";

// the live answer of partner_capital_setup_info for A & N (2026-11-19)
const INFO = { start_day: "2026-01-01", opening_equity: 4845828.43, distributed: false, partners: [
  { id: "pb", name: "الحاج ناصر ايوب", opening: 0, capital: 0, capital_share: 1 },
  { id: "pa", name: "م/محمد ناصر", opening: 0, capital: 0, capital_share: 0 },
] };
const RESULT = (applied: boolean) => ({ start_day: "2026-01-01", opening_equity: 4845828.43, opening_total: 4000000, kept_as_retained: 845828.43, applied,
  books_balanced: applied ? true : undefined, partners: [
    { id: "pb", name: "الحاج ناصر ايوب", capital_before: 0, capital_after: 1050000, share_before: 1, share_after: 0.2542 },
    { id: "pa", name: "م/محمد ناصر", capital_before: 0, capital_after: 3000000, share_before: 0, share_after: 0.7458 },
  ] });

const show = (onDone = vi.fn()) => render(<MemoryRouter><PartnerCapitalWizard onClose={vi.fn()} onDone={onDone} /></MemoryRouter>);

describe("«ظبّط رأس مال الشركاء» wizard (0275)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation((name: string, args: any) => {
      if (name === "partner_capital_setup_info") return Promise.resolve({ data: INFO, error: null });
      if (name === "partner_capital_setup") return Promise.resolve({ data: RESULT(args.p_apply), error: null });
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("step 1 shows the books' first day and the net worth", async () => {
    show();
    expect(await screen.findByTestId("net-worth")).toHaveTextContent("4,845,828.43");
    expect(screen.getByTestId("start-day")).toHaveTextContent("2026-01-01");
  });

  it("step 2 refuses more than the net worth and shows what stays retained", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "التالي" }));
    fireEvent.change(screen.getByLabelText("م/محمد ناصر"), { target: { value: "5000000" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/أكبر من صافي الملك/);
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("م/محمد ناصر"), { target: { value: "3000000" } });
    fireEvent.change(screen.getByLabelText("الحاج ناصر ايوب"), { target: { value: "1000000" } });
    expect(screen.getByTestId("retained")).toHaveTextContent("845,828.43");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("percent mode turns the % into amounts of the net worth", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "التالي" }));
    fireEvent.click(screen.getByLabelText(/بالنسبة/));
    fireEvent.change(screen.getByLabelText("م/محمد ناصر"), { target: { value: "50" } });
    expect(screen.getByTestId("open-total")).toHaveTextContent("2,422,914.22");
  });

  it("supplier paid from his pocket: preview first, then ONE «سجّل» with the same data", async () => {
    const onDone = vi.fn();
    show(onDone);
    fireEvent.click(await screen.findByRole("button", { name: "التالي" }));
    fireEvent.change(screen.getByLabelText("م/محمد ناصر"), { target: { value: "3000000" } });
    fireEvent.change(screen.getByLabelText("الحاج ناصر ايوب"), { target: { value: "1000000" } });
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    fireEvent.click(screen.getByRole("button", { name: /ضيف حركة/ }));
    fireEvent.change(screen.getByLabelText("نوع الحركة"), { target: { value: "supplier" } });
    fireEvent.change(screen.getByLabelText("الشريك"), { target: { value: "pb" } });
    fireEvent.change(screen.getByLabelText("الفرع"), { target: { value: "br4" } });
    fireEvent.change(screen.getByLabelText("اليوم"), { target: { value: "2026-03-02" } });
    fireEvent.change(screen.getByLabelText("المبلغ"), { target: { value: "50000" } });
    expect(screen.getByText("اختار المورد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "راجع" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "اختار مورد" }));
    fireEvent.click(screen.getByRole("button", { name: "راجع" }));
    const moves = [{ kind: "supplier", partner_id: "pb", branch_id: "br4", amount: 50000, date: "2026-03-02", supplier_id: "sup1", method: "cash", notes: null }];
    const openings = [{ partner_id: "pb", amount: 1000000 }, { partner_id: "pa", amount: 3000000 }];
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("partner_capital_setup", { p_openings: openings, p_moves: moves, p_apply: false }));
    expect(await screen.findAllByTestId("review-row")).toHaveLength(2);
    expect(screen.getByText("74.58%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "سجّل" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("partner_capital_setup", { p_openings: openings, p_moves: moves, p_apply: true }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalled();
  });

  it("after a profit distribution it stops at step 1", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: { ...INFO, distributed: true }, error: null }));
    show();
    expect(await screen.findByText(/فيه أرباح اتوزعت/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
  });
});
