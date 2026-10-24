import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const rpc = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

const pending = {
  id: "r1", tenant_id: "t1", requested_by_name: "أحمد", branch_name: "فرع المعادي", note: "زحمة",
  limit_at_request: 3, branches_at_request: 3, status: "pending", new_limit: null,
  created_at: "2026-10-24T08:00:00Z", decided_at: null,
};
const old = { ...pending, id: "r0", status: "approved", new_limit: 3, branch_name: "فرع قديم", decided_at: "2026-10-01T08:00:00Z" };

function chain(data: unknown) {
  const p = Promise.resolve({ data, error: null });
  const c: any = { select: () => c, order: () => c, limit: () => p, then: (f: any, r: any) => p.then(f, r) };
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => chain(t === "tenants" ? [{ id: "t1", name: "شركة النور" }] : [pending, old]),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/components/layout/SuperAdminLayout", () => ({ SuperAdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/layout/AppShell", () => ({ PageHeader: ({ title, subtitle }: any) => <header><h1>{title}</h1><p>{subtitle}</p></header> }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

import BranchRequests from "./BranchRequests";

const show = () => render(<MemoryRouter><BranchRequests /></MemoryRouter>);

describe("Platform owner — branch requests", () => {
  beforeEach(() => { rpc.mockReset(); toastError.mockReset(); toastSuccess.mockReset(); });

  it("lists the pending request with the company name and the old one in history", async () => {
    show();
    expect(await screen.findByText("شركة النور", { selector: "a" })).toBeInTheDocument();
    expect(screen.getByText("1 مستني ردّك")).toBeInTheDocument();
    expect(screen.getByText("3 من 3")).toBeInTheDocument();
    expect(screen.getByText("فرع المعادي")).toBeInTheDocument();
    expect(screen.getByText("اتوافق (الحد 3)")).toBeInTheDocument();
  });

  it("approve button adds one branch (no number sent)", async () => {
    rpc.mockResolvedValue({ data: { status: "approved", new_limit: 4 }, error: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /موافقة — يبقى 4 فروع/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("super_decide_branch_request", { p_request: "r1", p_approve: true, p_new_limit: null }));
    expect(toastSuccess).toHaveBeenCalledWith("اتوافق — الحد بقى 4 فروع");
  });

  it("custom number is sent as the new limit", async () => {
    rpc.mockResolvedValue({ data: { status: "approved", new_limit: 6 }, error: null });
    show();
    const input = await screen.findByLabelText("أو حدد العدد بنفسك");
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "موافقة بالعدد ده" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("super_decide_branch_request", { p_request: "r1", p_approve: true, p_new_limit: 6 }));
  });

  it("a number not above the branches already used is refused before calling the server", async () => {
    show();
    const input = await screen.findByLabelText("أو حدد العدد بنفسك");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "موافقة بالعدد ده" }));
    expect(toastError).toHaveBeenCalledWith("العدد لازم يكون أكبر من 3");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reject sends approve = false", async () => {
    rpc.mockResolvedValue({ data: { status: "rejected" }, error: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /رفض/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("super_decide_branch_request", { p_request: "r1", p_approve: false, p_new_limit: null }));
    expect(toastSuccess).toHaveBeenCalledWith("اترفض الطلب");
  });
});
