import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ROLE_LABELS } from "@/lib/roles";

const auth: any = {
  tenantId: "t1",
  roleSettings: [{ role: "warehouse", hidden: false, label: "مسؤول المخزن" }, { role: "driver", hidden: true, label: null }],
  roleLabel: (r: string) => (r === "warehouse" ? "مسؤول المخزن" : (ROLE_LABELS as any)[r] ?? r),
  refresh: vi.fn(),
};
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const upserts: any[] = [];
const inserts: any[] = [];
const rpc = vi.fn();
const db: Record<string, any[]> = {
  role_permissions: [{ role: "cashier", permission_key: "dashboard.view", allowed: true }, { role: "cashier", permission_key: "sales.view", allowed: true }],
  permission_templates: [{ id: "tp1", name: "مندوب مبيعات", base_role: "cashier", perms: { "treasury.view": false } }],
  user_roles: [{ user_id: "u1", role: "cashier" }, { user_id: "u2", role: "cashier" }, { user_id: "u3", role: "viewer" }],
  user_company_roles: [{ user_id: "u1", template_id: "tp1" }, { user_id: "u2", template_id: "tp1" }],
};
function q(table: string) {
  const c: any = {
    select: () => c, order: () => c, eq: () => c, in: () => c, single: () => Promise.resolve({ data: { id: "tp2" }, error: null }),
    upsert: (rows: any) => { upserts.push(rows); return Promise.resolve({ error: null }); },
    insert: (x: any) => { inserts.push(x); return c; },
    update: () => c, delete: () => c,
    then: (f: any, r: any) => Promise.resolve({ data: db[table], error: null }).then(f, r),
  };
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => q(t), rpc: (...a: unknown[]) => rpc(...a) } }));

import { TemplatesPermissions } from "./TemplatesPermissions";
const show = () => render(<MemoryRouter><TemplatesPermissions /></MemoryRouter>);

describe("Roles screen (migration 0115)", () => {
  beforeEach(() => { upserts.length = 0; inserts.length = 0; rpc.mockReset(); rpc.mockResolvedValue({ data: {}, error: null }); });

  it("lists the ready roles with their employees, the company's own names and hidden ones, then the company roles", async () => {
    show();
    expect(await screen.findByRole("button", { name: /^كاشير\s*2 موظف/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /مدير فرع\s*مفيش/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /مسؤول المخزن.*أصله «أمين مخازن»/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /سواق\s*مخفي/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /مندوب مبيعات.*مبني على كاشير.*2 موظف/ })).toBeInTheDocument();
  });

  it("changing a ready role and saving writes its matrix (it reaches everyone on it)", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /^كاشير\s*2 موظف/ }));
    fireEvent.click(screen.getByRole("switch", { name: "إخفاء الرئيسية" }));
    fireEvent.click(screen.getByRole("button", { name: /حفظ الدور/ }));
    await waitFor(() => expect(upserts.length).toBe(1));
    const rows = upserts[0] as any[];
    expect(rows.every((r) => r.role === "cashier" && r.tenant_id === "t1")).toBe(true);
    expect(rows.find((r) => r.permission_key === "dashboard.view").allowed).toBe(false);
  });

  it("hides a ready role and shows a hidden one through set_role_setting", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "إخفاء مدير فرع" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_role_setting", { p_role: "branch_manager", p_hidden: true, p_label: null }));
    fireEvent.click(screen.getByRole("button", { name: "إظهار سواق" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_role_setting", { p_role: "driver", p_hidden: false, p_label: null }));
    expect(screen.queryByRole("button", { name: /إخفاء Viewer/ })).toBeNull(); // partners need «مراقب»
  });

  it("renames a ready role for this company only", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "غيّر اسم ملاحظ (متابعة الحضور والانصراف فقط)" }));
    fireEvent.change(screen.getByLabelText("الاسم الجديد"), { target: { value: "مشرف صالة" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الاسم" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_role_setting", { p_role: "supervisor", p_hidden: false, p_label: "مشرف صالة" }));
  });

  it("deleting a company role with employees asks where they go first", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /مندوب مبيعات/ }));
    fireEvent.click(screen.getByRole("button", { name: /امسح الدور/ }));
    expect(screen.getByText(/عليه 2 موظف/)).toBeInTheDocument();
    const del = screen.getAllByRole("button", { name: "امسح الدور" }).pop()!;
    expect(del).toBeDisabled();
  });

  it("«دور جديد» asks for a name and the ready role it is built on", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /دور جديد/ }));
    fireEvent.change(screen.getByLabelText("اسم الدور"), { target: { value: "كاشير مسائي" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمل الدور" }));
    await waitFor(() => expect(inserts[0]).toMatchObject({ tenant_id: "t1", name: "كاشير مسائي", base_role: "cashier", perms: {} }));
  });
});
