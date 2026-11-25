import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DataTable } from "./DataTable";

/**
 * «إجراءات» column: buttons with words («موافقة» / «رفض») must keep their width — the old rule squeezed every button
 * into a 32px square, so the icon sat on top of the word (owner screenshot of «طلبات الموافقة», 25/11).
 */
describe("DataTable actions column", () => {
  const rows = [{ id: "1", name: "سند PV-7651" }];
  const ui = () => render(
    <MemoryRouter>
      <DataTable rows={rows as any} columns={[
        { key: "name", header: "العنصر" },
        { key: "actions", header: "إجراءات", render: () => (
          <div className="flex gap-1"><button type="button">موافقة</button><button type="button">رفض</button></div>
        ) },
      ]} />
    </MemoryRouter>,
  );

  it("does not force word buttons into a fixed 32px square", () => {
    ui();
    const cell = screen.getByText("موافقة").closest("td")!;
    expect(cell.className).not.toContain("[&_button]:w-8");
    expect(cell.className).not.toContain("[&_button]:p-0");
  });

  it("keeps icon buttons at least 32px and lets the buttons wrap instead of overlapping", () => {
    ui();
    const cell = screen.getByText("رفض").closest("td")!;
    expect(cell.className).toContain("[&_button]:min-w-8");
    expect(cell.className).toContain("[&_button]:whitespace-nowrap");
    expect(cell.className).toContain("[&>div]:flex-wrap");
  });
});
