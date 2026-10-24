import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ tenantId: "t1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const rpc = vi.fn();
const writes: any[] = [];
const db: Record<string, any[]> = {
  profiles: [
    { id: "own", name: "المالك", username: "owner" },
    { id: "c1", name: "mohayassr07", username: "mohayassr07" },
    { id: "m1", name: "مدير الفرع", username: "mgr" },
    { id: "lost", name: "موظف تايه", username: "lost" },
  ],
  user_roles: [
    { user_id: "own", role: "owner" }, { user_id: "own", role: "admin" },
    { user_id: "c1", role: "cashier" }, { user_id: "m1", role: "branch_manager" }, { user_id: "lost", role: "warehouse" },
  ],
  branch_users: [{ user_id: "c1", branch_id: "b1", access_level: "manage" }, { user_id: "m1", branch_id: "b1", access_level: "manage" }],
  branches: [{ id: "b1", name: "سكة تلة" }, { id: "b2", name: "عبدالمنعم الغربى" }],
  employees: [{ id: "e1", user_id: "c1" }],
  role_permissions: [],
  permission_templates: [],
  user_permissions: [{ user_id: "c1", permission_key: "part.dashboard.till_balance.view", allowed: false }],
};
function q(table: string) {
  let rows = db[table];
  const c: any = {
    select: () => c, order: () => c, not: () => c,
    eq: (col: string, v: any) => { if (table === "user_permissions" && col === "user_id") rows = db[table].filter((r) => r.user_id === v); return c; },
    in: () => c,
    insert: (x: any) => { writes.push({ table, op: "insert", x }); return Promise.resolve({ error: null }); },
    delete: () => { writes.push({ table, op: "delete" }); return c; },
    update: (x: any) => { writes.push({ table, op: "update", x }); return c; },
    then: (f: any, r: any) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => q(t), rpc: (...a: unknown[]) => rpc(...a) } }));

import { EmployeesPermissions } from "./EmployeesPermissions";
const show = (url = "/admin/settings?tab=user-permissions") => render(<MemoryRouter initialEntries={[url]}><EmployeesPermissions /></MemoryRouter>);

describe("Employees permissions screen", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: 1, error: null }); writes.length = 0; });

  it("lists employees but never the owner / admin", async () => {
    show();
    expect(await screen.findByRole("button", { name: /mohayassr07/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^المالك/ })).toBeNull();
    expect(screen.getByText(/عندهم كل حاجة/)).toBeInTheDocument();
  });

  it("warns about an employee with a role but no branch", async () => {
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("موظف تايه");
  });

  it("opens an employee with his template, branches, login link and saved differences", async () => {
    show("/admin/settings?tab=user-permissions&user=c1");
    expect(await screen.findByText("حساب الدخول: mohayassr07")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /حساب الدخول/ }).getAttribute("href")).toBe("/admin/employees/e1?tab=account");
    expect(await screen.findByRole("button", { name: /سكة تلة/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إدارة كاملة" })).toBeInTheDocument();
    expect(screen.getByText(/ممنوع استثناءً 1/)).toBeInTheDocument();
  });

  it("toggling a page then saving sends ALL differences in one call", async () => {
    show("/admin/settings?tab=user-permissions&user=c1");
    fireEvent.click(await screen.findByRole("switch", { name: "إخفاء الرئيسية" }));
    expect(screen.getByText(/فيه تغييرات لسه مااتحفظتش/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_user_permissions", {
      p_user: "c1",
      p_rows: [{ key: "part.dashboard.till_balance.view", allowed: false }, { key: "dashboard.view", allowed: false }],
    }));
  });

  it("«رجّعه للقالب» clears the differences, «فضّي التغييرات» brings back what is saved", async () => {
    show("/admin/settings?tab=user-permissions&user=c1");
    fireEvent.click(await screen.findByRole("button", { name: /رجّعه للقالب/ }));
    expect(screen.getByText(/ممنوع استثناءً 0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /فضّي التغييرات/ }));
    expect(await screen.findByText(/ممنوع استثناءً 1/)).toBeInTheDocument();
  });

  it("branch level switches between إدارة كاملة and عرض فقط", async () => {
    show("/admin/settings?tab=user-permissions&user=c1");
    fireEvent.click(await screen.findByRole("button", { name: "إدارة كاملة" }));
    expect(screen.getByRole("button", { name: "عرض فقط" })).toBeInTheDocument();
  });

  it("copies another employee through copy_user_permissions", async () => {
    show("/admin/settings?tab=user-permissions&user=c1");
    fireEvent.click(await screen.findByRole("button", { name: /انسخ من موظف تاني/ }));
    expect(screen.getByText("انسخ صلاحيات موظف تاني")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "انسخ" })).toBeDisabled();
  });

  it("the live preview shows his sidebar sections", async () => {
    show("/admin/settings?tab=user-permissions&user=c1");
    expect(await screen.findByText("معاينة: القايمة الجانبية عنده")).toBeInTheDocument();
    const preview = screen.getByRole("complementary", { name: "معاينة القايمة الجانبية" });
    expect(preview).toHaveTextContent("عام");
    expect(preview).toHaveTextContent("الرئيسية");
  });
});
