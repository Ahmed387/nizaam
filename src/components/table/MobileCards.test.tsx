import { describe, expect, it } from "vitest";
import { columnTitles, labelCells } from "./MobileCards";

const make = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.querySelector("table")!;
};

describe("mobile cards", () => {
  it("each cell gets its column title, the filter arrow is not part of it", () => {
    const t = make(`<table><thead><tr><th>#</th><th>الاسم<span data-xf-slot>▾</span></th><th>المبلغ</th></tr></thead>
      <tbody><tr><td>1</td><td>أحمد</td><td>500</td></tr></tbody></table>`);
    expect(columnTitles(t)).toEqual(["#", "الاسم", "المبلغ"]);
    labelCells(t);
    const cells = Array.from(t.tBodies[0].rows[0].cells).map((c) => c.getAttribute("data-label"));
    expect(cells).toEqual(["#", "الاسم", "المبلغ"]);
  });
  it("a wide cell (colspan) has no label and the next cells keep their columns", () => {
    const t = make(`<table><thead><tr><th>أ</th><th>ب</th><th>ج</th></tr></thead>
      <tbody><tr><td colspan="2">تفاصيل</td><td>3</td></tr></tbody><tfoot><tr><td>الإجمالي</td><td></td><td>9</td></tr></tfoot></table>`);
    labelCells(t);
    expect(t.tBodies[0].rows[0].cells[0].getAttribute("data-label")).toBe("");
    expect(t.tBodies[0].rows[0].cells[1].getAttribute("data-label")).toBe("ج");
    expect(t.tFoot!.rows[0].cells[2].getAttribute("data-label")).toBe("ج");
  });
});
