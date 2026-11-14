import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UnifiedDocumentMetrics } from "@/components/documents/UnifiedDocumentMetrics";

// owner 2026-11-14 «نقفل حوار الفواتير المفتوحة والمغلقة»: the sale / purchase cards never break «آجل» down by how it
// was settled (من تحت حسابه / من مرتجع / اتسدد بفلوس) — only its count and the «المتبقي» on it.
const split = (total: number, remaining: number) => ({ count: 2, total, remaining, after: 0, byBucket: { cash: 100, instapay: 0, wallet: 0, bank: 0, account: 50, other: 30 } as any });
const metrics: any = { values: { active: 1000 }, counts: { active: 4 }, byBucket: {}, split: { cash: split(400, 0), credit: split(600, 420) } };

describe("UnifiedDocumentMetrics — no allocation breakdown", () => {
  for (const kind of ["sale", "purchase"] as const) {
    it(kind, () => {
      const { container } = render(<MemoryRouter><UnifiedDocumentMetrics kind={kind} metrics={metrics} loading={false} selected={null} onSelect={() => {}} /></MemoryRouter>);
      const text = container.textContent ?? "";
      for (const gone of ["من تحت حساب", "من مرتجع", "اتسدد بفلوس", "لم يتم الدفع"]) expect(text).not.toContain(gone);
      expect(text).toContain("المتبقي");
      expect(text).toContain("420");
    });
  }
});
