import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// the signed-in user may not see: one auto card, one tab, one column
const hidden = new Set<string>();
const auth = { isAdmin: false, isOwner: false, tenantId: "t1", branches: [] as any[], roleLabel: (r: string) => r, can: (k: string) => !hidden.has(k) };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
const tables: Record<string, any[]> = {
  profiles: [{ name: "mohayassr07", username: "mohayassr07" }], user_roles: [{ role: "cashier" }], role_permissions: [], user_permissions: [], user_company_roles: [],
};
function q(table: string) {
  const res = { data: tables[table], error: null };
  const c: any = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: tables[table][0], error: null }), then: (f: any, r: any) => Promise.resolve(res).then(f, r) };
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => q(t), rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { PermCustomizeProvider, PermCard, PermPart, autoPartId, autoButtons } from "./PermCustomize";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermTable } from "@/components/PermTable";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

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
    <PermTable>
      <thead><tr><th>المنتج</th><th>الأسعار</th></tr></thead>
      <tbody><tr><td>غسالة</td><td>شراء 100</td></tr></tbody>
    </PermTable>
    <Card><CardHeader><CardTitle>أعلى العملاء</CardTitle></CardHeader><CardContent>محتوى الكارت</CardContent></Card>
    {autoButtons(<div><Button>تصدير Excel</Button><Button>موظف جديد</Button></div>)}
    <PermPart page="dashboard" part="collections" group>
      <PermCard label="وعاء كاش"><div>كارت الكاش</div></PermCard>
      <PermCard label="وعاء بنك"><div>كارت البنك</div></PermCard>
    </PermPart>
  </>
);
const show = (url: string) => render(<MemoryRouter initialEntries={[url]}><PermCustomizeProvider><Page /></PermCustomizeProvider></MemoryRouter>);

describe("every card, tab and column tags itself on a catalogue page", () => {
  beforeEach(() => { hidden.clear(); auth.isAdmin = false; auth.isOwner = false; sessionStorage.clear(); });

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

  it("a plain table hides a column with CSS, and a Card by its title", async () => {
    hidden.add(`part.dashboard.${autoPartId("col", "الأسعار")}.view`);
    hidden.add(`part.dashboard.${autoPartId("card", "أعلى العملاء")}.view`);
    const { container } = show("/branch/b1/dashboard");
    await waitFor(() => expect(container.querySelector("style")?.textContent ?? "").toMatch(/nth-child\(2\)/));
    expect(container.querySelector("style")!.textContent).toMatch(/display: none/);
    expect(screen.queryByText("محتوى الكارت")).toBeNull();
    expect(screen.getByText("غسالة")).toBeInTheDocument();
  });

  it("a hidden button is gone for him", () => {
    hidden.add(`part.dashboard.${autoPartId("btn", "تصدير Excel")}.view`);
    show("/branch/b1/dashboard");
    expect(screen.queryByRole("button", { name: "تصدير Excel" })).toBeNull();
    expect(screen.getByRole("button", { name: "موظف جديد" })).toBeInTheDocument();
  });

  it("hides one card of a box without hiding the box", () => {
    hidden.add(`part.dashboard.${autoPartId("card", "وعاء بنك")}.view`);
    show("/branch/b1/dashboard");
    expect(screen.getByText("كارت الكاش")).toBeInTheDocument();
    expect(screen.queryByText("كارت البنك")).toBeNull();
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
    expect(screen.getByText(/1 مخفي من 14/)).toBeInTheDocument();
    // the page's buttons too
    expect(screen.getByRole("button", { name: /إخفاء زرار «تصدير Excel» عن mohayassr07/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إخفاء زرار «موظف جديد» عن mohayassr07/ })).toBeInTheDocument();
    // a box of several cards: the box has a switch and every card inside has its own
    expect(screen.getByRole("button", { name: /إخفاء كارت «وعاء كاش» عن mohayassr07/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إخفاء كارت «وعاء بنك» عن mohayassr07/ })).toBeInTheDocument();
    // a plain <table> and a titled Card get their switches too
    expect(await screen.findByRole("button", { name: /إخفاء عمود الأسعار عن mohayassr07/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إخفاء كارت «أعلى العملاء» عن mohayassr07/ })).toBeInTheDocument();
  });
});
