import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { PermissionEditor } from "./PermissionEditor";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/roles";
import { allowAllPage, effective, resetPage, setOverride } from "@/lib/permissionModel";

function Harness({ onChange }: { onChange?: (o: Record<string, boolean>) => void }) {
  const rp = { cashier: { ...DEFAULT_ROLE_PERMISSIONS.cashier } };
  const [o, setO] = useState<Record<string, boolean>>({});
  const upd = (n: Record<string, boolean>) => { setO(n); onChange?.(n); };
  return (
    <MemoryRouter>
      <PermissionEditor bind={{
        resetWord: "القالب",
        get: (k) => effective(["cashier"], rp, o, k),
        changed: (k) => k in o,
        set: (k, v) => upd(setOverride(["cashier"], rp, o, k, v)),
        resetPage: (p) => upd(resetPage(p, o)),
        allowAll: (p) => upd(allowAllPage(["cashier"], rp, p, o)),
        customizeHref: (p) => (p.route ? `${p.route.replace(":branch", "b1")}?perm_for=u1` : null),
      }} />
    </MemoryRouter>
  );
}

describe("PermissionEditor", () => {
  it("shows the five sidebar tabs with how many pages are on", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs[0]).toMatch(/^عام/);
    expect(tabs[4]).toMatch(/المصاريف الشخصية/);
    expect(tabs[0]).toMatch(/من/);
  });

  it("hiding a page with its switch stores one override and marks it «متعدّل»", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "إخفاء الرئيسية" }));
    expect(onChange).toHaveBeenLastCalledWith({ "dashboard.view": false });
    expect(screen.getAllByText(/متعدّل عن القالب/).length).toBeGreaterThan(0);
  });

  it("action chips switch create / update / delete", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /العمليات/ }));
    const row = screen.getByText("المبيعات").closest("div.border-b") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "يلغي" }));
    expect(onChange).toHaveBeenLastCalledWith({ "sales.delete": true });
  });

  it("search finds a card on any tab", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("بحث في الصلاحيات"), { target: { value: "صافي الربح" } });
    expect(screen.getByText(/نتايج البحث/)).toBeInTheDocument();
    expect(screen.getByText("رؤية صافي الربح")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("every open page offers «افتح الصفحة وظبطها» (the real page, box by box)", () => {
    render(<Harness />);
    const link = screen.getAllByRole("link", { name: /افتح الصفحة وظبطها/ })[0];
    expect(link.getAttribute("href")).toMatch(/^\/branch\/b1\/dashboard\?perm_for=u1/);
    // no preview, no parts grid any more
    expect(screen.queryByText(/معاينة/)).toBeNull();
    expect(screen.queryByRole("button", { name: /أجزاء/ })).toBeNull();
  });

  it("a hidden page has no «افتح الصفحة وظبطها»", () => {
    render(<Harness />);
    const before = screen.getAllByRole("link", { name: /افتح الصفحة وظبطها/ }).length;
    fireEvent.click(screen.getByRole("switch", { name: "إخفاء الرئيسية" }));
    expect(screen.queryAllByRole("link", { name: /افتح الصفحة وظبطها/ }).length).toBe(before - 1);
  });

  it("shows the branch it is setting", () => {
    render(<MemoryRouter><PermissionEditor bind={{ resetWord: "القالب", get: () => true, changed: () => false, set: () => {}, resetPage: () => {}, allowAll: () => {}, scopeNote: "في فرع سكة تلة بس" }} /></MemoryRouter>);
    expect(screen.getByText("في فرع سكة تلة بس")).toBeInTheDocument();
  });

  it("the personal-expenses tab only explains, it changes nothing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: /المصاريف الشخصية/ }));
    expect(screen.getByText("المصاريف الشخصية بتاعتك انت بس")).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});
