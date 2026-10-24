import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ tenantId: "t1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const upserts: any[] = [];
const inserts: any[] = [];
const db: Record<string, any[]> = {
  role_permissions: [{ role: "cashier", permission_key: "dashboard.view", allowed: true }, { role: "cashier", permission_key: "sales.view", allowed: true }],
  permission_templates: [{ id: "tp1", name: "كاشير من غير خزنة", base_role: "cashier", perms: { "part.dashboard.till_balance.view": false } }],
  user_roles: [{ role: "cashier" }, { role: "viewer" }],
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
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => q(t), rpc: vi.fn() } }));

import { TemplatesPermissions } from "./TemplatesPermissions";
const show = () => render(<MemoryRouter><TemplatesPermissions /></MemoryRouter>);

describe("Templates (roles) screen", () => {
  beforeEach(() => { upserts.length = 0; inserts.length = 0; });

  it("lists the 8 roles with how many employees use each, and your own templates", async () => {
    show();
    expect(await screen.findByRole("button", { name: /كاشير\s*1 موظف/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /مدير فرع\s*مفيش/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /كاشير من غير خزنة/ })).toBeInTheDocument();
  });

  it("changing a role and saving writes the whole matrix for that role", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /كاشير\s*1 موظف/ }));
    fireEvent.click(screen.getByRole("switch", { name: "إخفاء الرئيسية" }));
    fireEvent.click(screen.getByRole("button", { name: /حفظ القالب/ }));
    await waitFor(() => expect(upserts.length).toBe(1));
    const rows = upserts[0] as any[];
    expect(rows.every((r) => r.role === "cashier" && r.tenant_id === "t1")).toBe(true);
    expect(rows.find((r) => r.permission_key === "dashboard.view").allowed).toBe(false);
    expect(rows.find((r) => r.permission_key === "sales.view").allowed).toBe(true);
  });

  it("a custom template shows its base role and its differences", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /كاشير من غير خزنة/ }));
    expect(screen.getByText("قالب «كاشير من غير خزنة»")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /امسح القالب/ })).toBeInTheDocument();
  });

  it("«قالب جديد» asks for a name and a base role", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /قالب جديد/ }));
    fireEvent.change(screen.getByLabelText("اسم القالب"), { target: { value: "كاشير مسائي" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمل القالب" }));
    await waitFor(() => expect(inserts[0]).toMatchObject({ tenant_id: "t1", name: "كاشير مسائي", base_role: "cashier", perms: {} }));
  });
});
