import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// the signed-in user may not see: one auto card, one tab, one column
const hidden = new Set<string>();
const auth = { isAdmin: false, isOwner: false, tenantId: "t1", can: (k: string) => !hidden.has(k) };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
const tables: Record<string, any[]> = {
  profiles: [{ name: "mohayassr07", username: "mohayassr07" }], user_roles: [{ role: "cashier" }], role_permissions: [], user_permissions: [],
};
function q(table: string) {
  const res = { data: tables[table], error: null };
  const c: any = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: tables[table][0], error: null }), then: (f: any, r: any) => Promise.resolve(res).then(f, r) };
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => q(t), rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { PermCustomizeProvider, autoPartId } from "./PermCustomize";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Page = () => (
  <>
    <StatCard label="صافي الربح" value="10" icon={null} />
    <StatCard label="عدد الفواتير" value="3" icon={null} />
    <Tabs defaultValue="a">
      <TabsList><TabsTrigger value="a">تاب أ</TabsTrigger><TabsTrigger value="b">تاب ب</TabsTrigger></TabsList>
      <TabsContent value="a">محتوى أ</TabsContent>
      <TabsContent value="b">محتوى ب</TabsContent>
    </Tabs>
    <DataTable rows={[{ id: 1, name: "عميل", phone: "010" }]} columns={[{ key: "name", header: "الاسم" }, { key: "phone", header: "التليفون" }]} />
  </>
);
const show = (url: string) => render(<MemoryRouter initialEntries={[url]}><PermCustomizeProvider><Page /></PermCustomizeProvider></MemoryRouter>);

describe("every card, tab and column tags itself on a catalogue page", () => {
  beforeEach(() => { hidden.clear(); auth.isAdmin = false; auth.isOwner = false; });

  it("ids are stable and match the database rule", () => {
    expect(autoPartId("card", "صافي الربح")).toBe(autoPartId("card", "صافي الربح"));
    expect(autoPartId("card", "صافي الربح")).not.toBe(autoPartId("card", "عدد الفواتير"));
    expect(`part.reports.${autoPartId("card", "صافي الربح")}.view`).toMatch(/^part\.[a-z0-9_]+\.[a-z0-9_]+\.view$/);
  });

  it("hides a card, a tab and a column the person may not see", () => {
    hidden.add(`part.reports.${autoPartId("card", "صافي الربح")}.view`);
    hidden.add("part.reports.tab_b.view");
    hidden.add("part.reports.col_phone.view");
    show("/branch/b1/reports");
    expect(screen.queryByText("صافي الربح")).toBeNull();
    expect(screen.getByText("عدد الفواتير")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "تاب ب" })).toBeNull();
    expect(screen.getByRole("tab", { name: "تاب أ" })).toBeInTheDocument();
    expect(screen.getByText("الاسم")).toBeInTheDocument();
    expect(screen.queryByText("التليفون")).toBeNull();
  });

  it("off a catalogue page nothing changes", () => {
    hidden.add("part.reports.col_phone.view");
    show("/somewhere/else");
    expect(screen.getByText("التليفون")).toBeInTheDocument();
  });

  it("in «افتح الصفحة وظبطها» each card, tab and column gets its own switch", async () => {
    auth.isAdmin = true; auth.isOwner = true;
    show("/branch/b1/dashboard?perm_for=u2"); // the cashier template opens the dashboard, so all six start «ظاهر»
    await screen.findByRole("region", { name: "شريط تظبيط الصفحة" });
    expect(await screen.findByRole("button", { name: /إخفاء كارت «صافي الربح» عن mohayassr07/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إخفاء تاب «تاب ب» عن mohayassr07/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /إخفاء عمود التليفون عن mohayassr07/ }));
    expect(screen.getByRole("button", { name: /إظهار عمود التليفون عن mohayassr07/ })).toBeInTheDocument();
    expect(screen.getByText(/1 مخفي من 6/)).toBeInTheDocument();
  });
});
