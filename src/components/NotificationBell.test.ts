import { describe, expect, it } from "vitest";
import { notificationTarget } from "./NotificationBell";

describe("notificationTarget", () => {
  it("an e-invoice notification opens that invoice's details", () => {
    expect(notificationTarget({ link: "/admin/eta-invoices", related_entity: "eta_documents", related_entity_id: "d-1" }))
      .toBe("/admin/eta-invoices?doc=d-1");
  });
  it("other notifications keep their link", () => {
    expect(notificationTarget({ link: "/admin/approvals", related_entity: "approval_requests", related_entity_id: "x" })).toBe("/admin/approvals");
    expect(notificationTarget({ link: null })).toBeNull();
  });
  it("an e-invoice notification without an id falls back to the page", () => {
    expect(notificationTarget({ link: "/admin/eta-invoices", related_entity: "eta_documents", related_entity_id: null })).toBe("/admin/eta-invoices");
  });
});
