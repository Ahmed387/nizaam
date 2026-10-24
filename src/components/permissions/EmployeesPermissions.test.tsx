import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = { tenantId: "t1", user: { id: "own" }, isOwner: false, tenant: { owner_user_id: "own" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const rpc = vi.fn();
const writes: any[] = [];
const db: Record<string, any[]> = {
  profiles: [
    { id: "own", name: "المالك", username: "owner" },
    { id: "c1", name: "mohayassr07", username: "mohayassr07" },
    { id: "m1", name: "مدير الفرع", username: "mgr" },
    { id: "lost", name: "موظف تايه", username: "lost" },
    { id: "a1", name: "المدير العام", username: "gm" },
  ],
  user_roles: [
    { user_id: "own", role: "owner" }, { user_id: "own", role: "admin" },
    { user_id: "c1", role: "cashier" }, { user_id: "m1", role: "branch_manager" }, { user_id: "lost", role: "warehouse" },
    { user_id: "a1", role: "admin" },
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
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: 1, error: null }); writes.length = 0; auth.isOwner = false; auth.user = { id: "own" }; });

  it("a manager sees the employees, never the owner, and not the other managers", async () => {
    auth.user = { id: "m1" };
    show();
    expect(await screen.findByRole("button", { name: /mohayassr07/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^المالك/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /المدير العام/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /مدير الفرع/ })).toBeNull(); // himself
    expect(screen.getByText("المديرين والشركاء بيظبطهم صاحب الشركة بس.")).toBeInTheDocument();
  });

  it("the owner also sets the general manager (he starts with everything open)", async () => {
    auth.isOwner = true;
    show("/admin/settings?tab=user-permissions&user=a1");
    expect(await screen.findByRole("button", { name: /المدير العام/ })).toHaveTextContent("مدير عام · كل الفروع");
    expect(screen.queryByRole("button", { name: /^المالك/ })).toBeNull();
    fireEvent.click(await screen.findByRole("switch", { name: "إخفاء الرئيسية" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_user_permissions", { p_user: "a1", p_rows: [{ key: "dashboard.view", allowed: false }] }));
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

  it("per branch: hides the home page in سكة تلة only", async () => {
    show("/admin/settings?tab=user-permissions&user=c1");
    const bar = await screen.findByRole("tablist", { name: "الفرع اللي بتظبطه" });
    expect(bar).toHaveTextContent("كل الفروع");
    fireEvent.click(screen.getByRole("tab", { name: /سكة تلة/ }));
    expect(screen.getByText(/بتظبط فرع «سكة تلة» بس/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "إخفاء الرئيسية" }));
    expect(screen.getByRole("tab", { name: /سكة تلة · 1 متعدّل/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_user_permissions", {
      p_user: "c1",
      p_rows: [{ key: "part.dashboard.till_balance.view", allowed: false }, { key: "dashboard.view", allowed: false, branch: "b1" }],
    }));
  });

  it("«افتح الصفحة وظبطها» opens the real page for him, in the chosen branch", async () => {
    show("/admin/settings?tab=user-permissions&user=c1&branch=b1");
    const link = (await screen.findAllByRole("link", { name: /افتح الصفحة وظبطها/ }))[0];
    expect(link.getAttribute("href")).toBe("/branch/b1/dashboard?perm_for=c1&perm_scope=branch");
    expect(screen.queryByText(/معاينة/)).toBeNull();
  });
});
