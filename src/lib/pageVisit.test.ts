import { describe, expect, it } from "vitest";
import { pageVisitOf } from "./pageVisit";

const B = "7a9f9e1b-d6ae-47c0-9965-bf23d0d31213";
describe("pageVisitOf", () => {
  it("names the sale screen and keeps the branch", () => {
    expect(pageVisitOf(`/branch/${B}/sales/new`)).toEqual({ key: "sales_new", label: "شاشة البيع", branch: B });
  });
  it("catalogue pages use their label", () => {
    const v = pageVisitOf(`/branch/${B}/contacts`)!;
    expect(v.branch).toBe(B);
    expect(v.label).not.toBe("");
    expect(v.key).toMatch(/^[a-z0-9_.:-]{2,80}$/);
  });
  it("company pages have no branch", () => {
    expect(pageVisitOf("/admin/eta-invoices/123")).toEqual({ key: "admin_eta", label: "الفواتير الإلكترونية", branch: null });
  });
  it("login is not a visit", () => {
    expect(pageVisitOf("/login")).toBeNull();
    expect(pageVisitOf("/")).toBeNull();
  });
});
