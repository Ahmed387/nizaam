// Harness for e2e/mobile-cards.ui.cjs: the real DataTable / PermTable with mobileCards, no database.
import "@/index.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { DataTable } from "@/components/DataTable";
import { PermTable } from "@/components/PermTable";

const rows = [
  { id: "1", no: "IN05001", name: "أحمد معتز", amount: 15745, date: "2026-11-14" },
  { id: "2", no: "IN05002", name: "نقابة المعلمين", amount: 250622.75, date: "2026-11-15" },
  { id: "3", no: "IN05003", name: "مايكل الجمل", amount: 3500, date: "2026-11-16" },
];
function App() {
  return (
    <div style={{ padding: 8 }}>
      <DataTable mobileCards rows={rows} indexColumn minTableWidth="900px" getRowKey={(r) => r.id} excel={{ id: "h" }}
        columns={[
          { key: "no", header: "رقم الفاتورة" },
          { key: "name", header: "اسم الحساب" },
          { key: "amount", header: "المبلغ", numeric: true, render: (r) => r.amount.toLocaleString("en-US") },
          { key: "date", header: "التاريخ" },
        ]} />
      <div style={{ height: 16 }} />
      <PermTable mobileCards id="pt" className="w-full min-w-[1150px] text-sm table-fixed">
        <thead><tr><th>الكود</th><th>الصنف</th><th>الكمية</th></tr></thead>
        <tbody>
          <tr><td>1478</td><td>مروحة</td><td>12</td></tr>
          <tr><td>1613</td><td>غسالة فريش</td><td>4</td></tr>
        </tbody>
      </PermTable>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
