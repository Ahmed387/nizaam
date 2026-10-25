import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = { isAdmin: false, isOwner: false, tenantId: "t1", branches: [] as any[], roleLabel: (r: string) => r, can: (k: string) => k !== "part.dashboard.till_balance.view" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

const rpc = vi.fn();
const tables: Record<string, any[]> = {
  profiles: [{ name: "mohayassr07", username: "mohayassr07" }],
  user_roles: [{ role: "cashier" }],
  role_permissions: [],
  user_permissions: [{ permission_key: "part.dashboard.sales_month.view", allowed: false }],
  user_company_roles: [],
};
const writes: any[] = [];
function q(table: string) {
  const res = { data: tables[table], error: null };
  const c: any = {
    select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: tables[table]?.[0] ?? null, error: null }),
    upsert: (rows: any, o: any) => { writes.push({ table, op: "upsert", rows, o }); return Promise.resolve({ error: null }); },
    update: (x: any) => { writes.push({ table, op: "update", x }); return c; },
    then: (f: any, r: any) => Promise.resolve(res).then(f, r),
  };
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => q(t), rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PermCustomizeProvider, PermPart } from "./PermCustomize";

const Page = () => (
  <>
    <PermPart page="dashboard" part="sales_today"><div>كارت مبيعات اليوم</div></PermPart>
    <PermPart page="dashboard" part="sales_month"><div>كارت مبيعات الشهر</div></PermPart>
    <PermPart page="dashboard" part="till_balance"><div>كارت رصيد الخزنة</div></PermPart>
  </>
);
const show = (url: string) => render(<MemoryRouter initialEntries={[url]}><PermCustomizeProvider><Page /></PermCustomizeProvider></MemoryRouter>);

describe("PermPart — normal use", () => {
  beforeEach(() => { auth.isAdmin = false; auth.isOwner = false; rpc.mockReset(); sessionStorage.clear(); });

  it("shows the card when the user can see it and hides it otherwise", () => {
    show("/branch/b1/dashboard");
    expect(screen.getByText("كارت مبيعات اليوم")).toBeInTheDocument();
    expect(screen.queryByText("كارت رصيد الخزنة")).toBeNull();
  });

  it("an employee who adds ?perm_for gets nothing special", () => {
    show("/branch/b1/dashboard?perm_for=u2");
    expect(screen.queryByRole("region", { name: "شريط تظبيط الصفحة" })).toBeNull();
  });
});

describe("PermPart — customize on the page (owner)", () => {
  beforeEach(() => { auth.isAdmin = true; auth.isOwner = true; rpc.mockReset(); rpc.mockResolvedValue({ data: 1, error: null }); sessionStorage.clear(); });

  it("puts a show / hide button on every card for that employee", async () => {
    show("/branch/b1/dashboard?perm_for=u2");
    expect(await screen.findByRole("region", { name: "شريط تظبيط الصفحة" })).toBeInTheDocument();
    expect(await screen.findByText(/بتظبط اللي يظهر لـ mohayassr07/)).toBeInTheDocument();
    // his saved override hides «مبيعات الشهر»
    expect(await screen.findByRole("button", { name: /إظهار مبيعات الشهر عن mohayassr07/ })).toBeInTheDocument();
    expect(await screen.findByText(/1 مخفي من 3/)).toBeInTheDocument();
  });

  it("hides a card, previews as him, and saves through save_user_permissions", async () => {
    show("/branch/b1/dashboard?perm_for=u2");
    fireEvent.click(await screen.findByRole("button", { name: /إخفاء رصيد الخزنة عن mohayassr07/ }));
    expect(screen.getByText(/2 مخفي من 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "شوفها بعينه" }));
    expect(screen.queryByText("كارت رصيد الخزنة")).toBeNull();
    expect(screen.getByText("كارت مبيعات اليوم")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_user_permissions", {
      p_user: "u2",
      p_rows: [{ key: "part.dashboard.sales_month.view", allowed: false }, { key: "part.dashboard.till_balance.view", allowed: false }],
    }));
  });

  it("«أظهر الكل» brings every card back", async () => {
    show("/branch/b1/dashboard?perm_for=u2");
    fireEvent.click(await screen.findByRole("button", { name: "أظهر الكل" }));
    expect(screen.getByText(/0 مخفي من 3/)).toBeInTheDocument();
  });
});

describe("per-branch customize («الفرع ده بس»)", () => {
  beforeEach(() => { auth.isAdmin = true; auth.isOwner = true; rpc.mockReset(); rpc.mockResolvedValue({ data: 1, error: null }); sessionStorage.clear(); });

  it("with perm_scope=branch a hidden card is saved for this branch only", async () => {
    show("/branch/b1/dashboard?perm_for=u2&perm_scope=branch");
    expect(await screen.findByRole("radio", { name: "الفرع ده بس" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /إخفاء رصيد الخزنة عن mohayassr07/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_user_permissions", {
      p_user: "u2",
      p_rows: [{ key: "part.dashboard.sales_month.view", allowed: false }, { key: "part.dashboard.till_balance.view", allowed: false, branch: "b1" }],
    }));
  });

  it("«كل الفروع» saves the rule for every branch", async () => {
    show("/branch/b1/dashboard?perm_for=u2&perm_scope=branch");
    fireEvent.click(await screen.findByRole("radio", { name: "كل الفروع" }));
    fireEvent.click(screen.getByRole("button", { name: /إخفاء رصيد الخزنة عن mohayassr07/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_user_permissions", {
      p_user: "u2",
      p_rows: [{ key: "part.dashboard.sales_month.view", allowed: false }, { key: "part.dashboard.till_balance.view", allowed: false }],
    }));
  });
});

describe("customize a whole role on the page (owner 2026-10-25)", () => {
  beforeEach(() => { auth.isAdmin = true; auth.isOwner = true; writes.length = 0; sessionStorage.clear(); tables.permission_templates = [{ id: "tp1", name: "مندوب مبيعات", base_role: "cashier", perms: {} }]; });

  it("?perm_role=cashier hides a card for every cashier — saved into the role", async () => {
    show("/branch/b1/dashboard?perm_role=cashier");
    expect(await screen.findByText(/بتظبط دور «cashier» — بيتطبق على كل الموظفين اللي عليه/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "الفرع ده بس" })).toBeNull(); // a role is for every branch
    fireEvent.click(screen.getByRole("button", { name: /إخفاء رصيد الخزنة عن cashier/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(writes.find((w) => w.table === "role_permissions")).toMatchObject({
      op: "upsert", rows: [{ tenant_id: "t1", role: "cashier", permission_key: "part.dashboard.till_balance.view", allowed: false }],
    }));
  });

  it("?perm_role=tpl:<id> saves into the company role", async () => {
    show("/branch/b1/dashboard?perm_role=tpl:tp1");
    expect(await screen.findByText(/بتظبط دور «مندوب مبيعات»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /إخفاء رصيد الخزنة عن مندوب مبيعات/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(writes.find((w) => w.table === "permission_templates")).toMatchObject({ op: "update", x: { perms: { "part.dashboard.till_balance.view": false } } }));
  });

  it("stays on when moving to another page without the query, until «خروج»", async () => {
    const { unmount } = show("/branch/b1/dashboard?perm_for=u2");
    await screen.findByRole("region", { name: "شريط تظبيط الصفحة" });
    unmount();
    show("/branch/b1/dashboard");
    expect(await screen.findByRole("region", { name: "شريط تظبيط الصفحة" })).toBeInTheDocument();
  });
});

