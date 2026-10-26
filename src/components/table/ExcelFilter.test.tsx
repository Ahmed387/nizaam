import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DataTable } from "@/components/DataTable";
import { PermTable } from "@/components/PermTable";
import { formatEGP } from "@/lib/format";

// Radix popper measures the anchor
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? RO;
(globalThis as any).DOMRect = (globalThis as any).DOMRect ?? class { x = 0; y = 0; width = 0; height = 0; top = 0; left = 0; right = 0; bottom = 0; static fromRect() { return new this(); } };

// the live example shown to the owner (sales of سكة تلة, June 2026 — cut down)
const SALES = [
  { id: "a", invoice_number: "IN04506", customer: "اسامة الراعى الصالح", total: 70600, klass: "آجل", date: "3 يونيو 2026", notes: "" },
  { id: "b", invoice_number: "IN04512", customer: "اسامة الراعى الصالح", total: 12000, klass: "آجل", date: "5 يونيو 2026", notes: "تسليم المخزن" },
  { id: "c", invoice_number: "IN04539", customer: "اسامة الراعى الصالح", total: 58600, klass: "آجل", date: "9 يونيو 2026", notes: "" },
  { id: "d", invoice_number: "IN04540", customer: "جارحي", total: 21000, klass: "نقدي", date: "9 يونيو 2026", notes: "" },
  { id: "e", invoice_number: "IN04551", customer: "المخزن الرئيسي", total: 4500, klass: "آجل", date: "12 يونيو 2026", notes: "" },
  { id: "f", invoice_number: "IN04560", customer: "جارحي", total: 30000, klass: "آجل", date: "15 يونيو 2026", notes: "تسليم المخزن" },
];
const COLS = [
  { key: "invoice_number", header: "رقم" },
  { key: "customer", header: "العميل" },
  { key: "total", header: "المبلغ", numeric: true, render: (r: any) => formatEGP(r.total) },
  { key: "klass", header: "التصنيف" },
  { key: "date", header: "تاريخ الفاتورة" },
  { key: "notes", header: "الملاحظات", render: (r: any) => r.notes || "—" },
  { key: "actions", header: "إجراءات", render: () => <button type="button">فتح</button> },
];

const bodyRows = (table: HTMLElement) => Array.from(table.querySelectorAll("tbody > tr")).filter((tr) => !(tr as HTMLElement).hidden) as HTMLTableRowElement[];
const numbers = (table: HTMLElement) => bodyRows(table).map((tr) => tr.cells[0].textContent);
const arrow = (name: RegExp) => screen.getByRole("button", { name });

async function pickValues(col: string, values: string[]) {
  await act(async () => { fireEvent.click(arrow(new RegExp(`فلتر وترتيب عمود ${col}`))); });
  const dialog = await screen.findByText("تحديد الكل");
  const pane = dialog.closest("[data-xf-ui]") as HTMLElement;
  // start from nothing, then tick the wanted values
  await act(async () => { fireEvent.click(within(pane).getByLabelText("تحديد الكل")); });
  for (const v of values) await act(async () => { fireEvent.click(within(pane).getByText(v)); });
  await act(async () => { fireEvent.click(within(pane).getByRole("button", { name: "تطبيق" })); });
}

beforeEach(() => { window.localStorage.clear(); });

describe("Excel filter on the shared table (DataTable)", () => {
  it("shows an arrow on each data column, none on actions", () => {
    render(<DataTable columns={COLS as any} rows={SALES} getRowKey={(r: any) => r.id} />);
    expect(arrow(/فلتر وترتيب عمود العميل/)).toBeInTheDocument();
    expect(arrow(/فلتر وترتيب عمود المبلغ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /فلتر وترتيب عمود إجراءات/ })).toBeNull();
  });

  it("the owner's example: customer, then amount > 20,000 — AND between columns, totals of what is shown", async () => {
    const { container } = render(<DataTable columns={COLS as any} rows={SALES} getRowKey={(r: any) => r.id} />);
    const table = container.querySelector("table") as HTMLElement;
    // totals row from the start (all 6)
    expect(table.querySelector("tfoot[data-xf-totals]")!.textContent).toContain("196,700 ج.م");

    await pickValues("العميل", ["اسامة الراعى الصالح"]);
    expect(numbers(table)).toEqual(["IN04506", "IN04512", "IN04539"]);
    expect(screen.getByText("ظاهر 3 من 6")).toBeInTheDocument();

    // cascading: the class list now only offers «آجل (3)»
    await act(async () => { fireEvent.click(arrow(/فلتر وترتيب عمود التصنيف/)); });
    const pane = (await screen.findByText("تحديد الكل")).closest("[data-xf-ui]") as HTMLElement;
    expect(within(pane).getByText("آجل")).toBeInTheDocument();
    expect(within(pane).queryByText("نقدي")).toBeNull();
    expect(within(pane).getByText("(3)")).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(pane).getByRole("button", { name: "إلغاء" })); });

    // number condition
    await act(async () => { fireEvent.click(arrow(/فلتر وترتيب عمود المبلغ/)); });
    const gt = await screen.findByRole("radio", { name: "أكبر من" });
    await act(async () => { fireEvent.click(gt); });
    await act(async () => { fireEvent.change(screen.getByLabelText("الرقم"), { target: { value: "20000" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تطبيق" })); });
    expect(numbers(table)).toEqual(["IN04506", "IN04539"]);
    expect(screen.getByText("ظاهر 2 من 6")).toBeInTheDocument();
    expect(screen.getByText("المبلغ أكبر من 20,000")).toBeInTheDocument();
    expect(table.querySelector("tfoot[data-xf-totals]")!.textContent).toContain("129,200 ج.م");

    // remove the customer chip: the amount filter stays
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "شيل فلتر العميل" })); });
    expect(numbers(table)).toEqual(["IN04506", "IN04539", "IN04540", "IN04560"]);
  });

  it("OR inside one column, sorting, blanks and «مسح الكل»", async () => {
    const { container } = render(<DataTable columns={COLS as any} rows={SALES} getRowKey={(r: any) => r.id} />);
    const table = container.querySelector("table") as HTMLElement;
    await pickValues("العميل", ["جارحي", "المخزن الرئيسي"]);
    expect(numbers(table)).toEqual(["IN04540", "IN04551", "IN04560"]);

    await act(async () => { fireEvent.click(arrow(/فلتر وترتيب عمود المبلغ/)); });
    const desc = await screen.findByRole("button", { name: /من الأكبر للأصغر/ });
    await act(async () => { fireEvent.click(desc); });
    expect(numbers(table)).toEqual(["IN04560", "IN04540", "IN04551"]);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "مسح الكل" })); });
    expect(numbers(table)).toEqual(SALES.map((s) => s.invoice_number)); // back to the original order

    await pickValues("الملاحظات", ["(فاضي)"]);
    expect(numbers(table)).toEqual(["IN04506", "IN04539", "IN04540", "IN04551"]);
  });

  it("dates: one day from the tree", async () => {
    const { container } = render(<DataTable columns={COLS as any} rows={SALES} getRowKey={(r: any) => r.id} />);
    const table = container.querySelector("table") as HTMLElement;
    await act(async () => { fireEvent.click(arrow(/فلتر وترتيب عمود تاريخ الفاتورة/)); });
    const pane = (await screen.findByLabelText("كل الأيام")).closest("[data-xf-ui]") as HTMLElement;
    await act(async () => { fireEvent.click(within(pane).getByLabelText("كل الأيام")); });
    // one month only: it opens by itself
    await act(async () => { fireEvent.click(within(pane).getByText("9 يونيو 2026")); });
    await act(async () => { fireEvent.click(within(pane).getByRole("button", { name: "تطبيق" })); });
    expect(numbers(table)).toEqual(["IN04539", "IN04540"]);
  });

  it("remembers the filters of the table on this device («زي ما سبتها»)", async () => {
    const first = render(<DataTable columns={COLS as any} rows={SALES} getRowKey={(r: any) => r.id} />);
    await pickValues("العميل", ["جارحي"]);
    first.unmount();
    const { container } = render(<DataTable columns={COLS as any} rows={SALES} getRowKey={(r: any) => r.id} />);
    const table = container.querySelector("table") as HTMLElement;
    await act(async () => {});
    expect(numbers(table)).toEqual(["IN04540", "IN04560"]);
    expect(screen.getByText("العميل: جارحي")).toBeInTheDocument();
  });

  it("new rows from a reload are filtered too", async () => {
    const { container, rerender } = render(<DataTable columns={COLS as any} rows={SALES} getRowKey={(r: any) => r.id} />);
    const table = container.querySelector("table") as HTMLElement;
    await pickValues("العميل", ["جارحي"]);
    rerender(<DataTable columns={COLS as any} rows={[...SALES, { id: "g", invoice_number: "IN04600", customer: "جارحي", total: 1000, klass: "نقدي", date: "20 يونيو 2026", notes: "" }, { id: "h", invoice_number: "IN04601", customer: "يسري", total: 900, klass: "نقدي", date: "20 يونيو 2026", notes: "" }]} getRowKey={(r: any) => r.id} />);
    await act(async () => {});
    expect(numbers(table)).toEqual(["IN04540", "IN04560", "IN04600"]);
  });

  it("can be switched off for forms", () => {
    render(<DataTable columns={COLS as any} rows={SALES} excel={false} />);
    expect(screen.queryByRole("button", { name: /فلتر وترتيب عمود/ })).toBeNull();
  });
});

describe("Excel filter on hand-made tables (PermTable / ui Table)", () => {
  const Hand = ({ noFilter }: { noFilter?: boolean }) => (
    <PermTable noFilter={noFilter}>
      <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>غسالة توشيبا</td><td>2</td><td>9,000</td><td>18,000 ج.م</td></tr>
        <tr><td>2</td><td>شاشة سامسونج</td><td>1</td><td>21,000</td><td>21,000 ج.م</td></tr>
        <tr><td>3</td><td>غسالة فريش</td><td>3</td><td>4,000</td><td>12,000 ج.م</td></tr>
        <tr><td colSpan={5}>ملاحظة على الفاتورة</td></tr>
      </tbody>
    </PermTable>
  );
  it("filters, sorts, renumbers «#» and sums amounts (not unit prices)", async () => {
    const { container } = render(<Hand />);
    const table = container.querySelector("table") as HTMLElement;
    const foot = () => table.querySelector("tfoot[data-xf-totals]")!.textContent!;
    expect(foot()).toContain("51,000 ج.م");
    expect(foot()).toContain("6");
    expect(foot()).not.toContain("34,000");

    await act(async () => { fireEvent.click(arrow(/فلتر وترتيب عمود الإجمالي/)); });
    const desc = await screen.findByRole("button", { name: /من الأكبر للأصغر/ });
    await act(async () => { fireEvent.click(desc); });
    const names = () => bodyRows(table).map((tr) => tr.cells[1]?.textContent ?? tr.textContent);
    expect(names()).toEqual(["شاشة سامسونج", "غسالة توشيبا", "غسالة فريش"]);
    expect(bodyRows(table).map((tr) => tr.cells[0].textContent)).toEqual(["1", "2", "3"]);

    await pickValues("المنتج", ["غسالة توشيبا", "غسالة فريش"]);
    expect(names()).toEqual(["غسالة توشيبا", "غسالة فريش"]);
    expect(foot()).toContain("30,000 ج.م");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "مسح الكل" })); });
    expect(names()).toEqual(["غسالة توشيبا", "شاشة سامسونج", "غسالة فريش", "ملاحظة على الفاتورة"]);
    expect(bodyRows(table).map((tr) => tr.cells[0].textContent)).toEqual(["1", "2", "3", "ملاحظة على الفاتورة"]);
  });
  it("noFilter leaves a form / preview table alone", () => {
    const { container } = render(<Hand noFilter />);
    expect(screen.queryByRole("button", { name: /فلتر وترتيب عمود/ })).toBeNull();
    expect(container.querySelector("tfoot[data-xf-totals]")).toBeNull();
  });
});
