import { fetchTreasuryLinks } from "@/lib/treasuryLinks";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import type { BulkKind } from "@/lib/bulkDocs";

export type PrintFormat = "a4" | "thermal";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(v)) : "—");
const money = (v: unknown) => esc(formatEGP(Number(v) || 0));

const TITLE: Record<BulkKind, string> = {
  sale: "فاتورة بيع", purchase: "فاتورة شراء", sale_return: "مرتجع بيع", purchase_return: "مرتجع شراء", income: "سند قبض", expense: "سند صرف",
};

type Line = { name: string; qty: number; price: number; total: number };
type Doc = {
  number: string; date: string | null; party: string; partyLabel: string; recipient?: string | null; notes?: string | null;
  lines: Line[]; rows: [string, string][]; total: number; status?: string | null; branch?: string | null;
};

const SELECT: Record<BulkKind, string> = {
  sale: "id, invoice_number, invoice_date, created_at, total, subtotal, discount_amount, vat_amount, notes, recipient_name, status, branches:branch_id(name), contacts:contact_id(name, phone), invoice_items(product_name, quantity, final_price, selling_price, total)",
  purchase: "id, shipment_number, invoice_date, created_at, total_cost, discount_amount, vat_amount, total_extra_costs, notes, received_by, status, branches:branch_id(name), contacts:contact_id(name, phone), shipment_items(product_name, quantity, cost_price, total)",
  sale_return: "id, return_number, invoice_date, created_at, total_refund, reason, notes, recipient_name, status, refund_cash_amount, refund_transfer_amount, refund_balance_amount, branches:branch_id(name), invoices(invoice_number, contacts:contact_id(name, phone)), return_items(quantity, refund, products(name))",
  purchase_return: "id, return_number, invoice_date, created_at, total_amount, reason, notes, recipient_name, status, refund_cash_amount, refund_transfer_amount, refund_balance_amount, branches:branch_id(name), contacts:contact_id(name, phone), shipments(shipment_number), purchase_return_items(product_name, quantity, unit_cost, total)",
  income: "id, voucher_number, type, voucher_date, created_at, amount, payment_method, fee_amount, reference_number, party_name, treasury_id, description, recipient_name, status, branches:branch_id(name), voucher_categories(name)",
  expense: "id, voucher_number, type, voucher_date, created_at, amount, payment_method, fee_amount, reference_number, party_name, treasury_id, description, recipient_name, status, branches:branch_id(name), voucher_categories(name)",
};
const TABLE: Record<BulkKind, string> = {
  sale: "invoices", purchase: "shipments", sale_return: "returns", purchase_return: "purchase_returns", income: "vouchers", expense: "vouchers",
};

function toDoc(k: BulkKind, r: any): Doc {
  const branch = r.branches?.name ?? null;
  const status = r.status === "cancelled" ? "ملغي" : null;
  const refundRows = (): [string, string][] => [
    ...(Number(r.refund_cash_amount) > 0 ? [["اترد كاش", money(r.refund_cash_amount)] as [string, string]] : []),
    ...(Number(r.refund_transfer_amount) > 0 ? [["اترد تحويل", money(r.refund_transfer_amount)] as [string, string]] : []),
    ...(Number(r.refund_balance_amount) > 0 ? [["على الحساب", money(r.refund_balance_amount)] as [string, string]] : []),
  ];
  switch (k) {
    case "sale": return {
      number: r.invoice_number, date: r.invoice_date ?? r.created_at, party: r.contacts?.name ?? "نقدي", partyLabel: "العميل",
      recipient: r.recipient_name, notes: r.notes, status, branch,
      lines: (r.invoice_items ?? []).map((i: any) => ({ name: i.product_name, qty: Number(i.quantity), price: Number(i.final_price ?? i.selling_price), total: Number(i.total) })),
      rows: [
        ["الإجمالي قبل الخصم", money(r.subtotal)],
        ...(Number(r.discount_amount) > 0 ? [["الخصم", money(r.discount_amount)] as [string, string]] : []),
        ...(Number(r.vat_amount) > 0 ? [["الضريبة", money(r.vat_amount)] as [string, string]] : []),
      ],
      total: Number(r.total) || 0,
    };
    case "purchase": return {
      number: r.shipment_number, date: r.invoice_date ?? r.created_at, party: r.contacts?.name ?? "—", partyLabel: "المورد",
      recipient: r.received_by, notes: r.notes, status, branch,
      lines: (r.shipment_items ?? []).map((i: any) => ({ name: i.product_name, qty: Number(i.quantity), price: Number(i.cost_price), total: Number(i.total) })),
      rows: [
        ...(Number(r.discount_amount) > 0 ? [["الخصم", money(r.discount_amount)] as [string, string]] : []),
        ...(Number(r.total_extra_costs) > 0 ? [["مصاريف إضافية", money(r.total_extra_costs)] as [string, string]] : []),
        ...(Number(r.vat_amount) > 0 ? [["الضريبة", money(r.vat_amount)] as [string, string]] : []),
      ],
      total: Number(r.total_cost) || 0,
    };
    case "sale_return": return {
      number: r.return_number, date: r.invoice_date ?? r.created_at, party: r.invoices?.contacts?.name ?? "نقدي", partyLabel: "العميل",
      recipient: r.recipient_name, notes: [r.reason, r.notes].filter(Boolean).join(" — "), status, branch,
      lines: (r.return_items ?? []).map((i: any) => ({ name: i.products?.name ?? "—", qty: Number(i.quantity), price: Number(i.quantity) ? Number(i.refund) / Number(i.quantity) : 0, total: Number(i.refund) })),
      rows: [["على فاتورة", esc(r.invoices?.invoice_number ?? "—")], ...refundRows()],
      total: Number(r.total_refund) || 0,
    };
    case "purchase_return": return {
      number: r.return_number, date: r.invoice_date ?? r.created_at, party: r.contacts?.name ?? "—", partyLabel: "المورد",
      recipient: r.recipient_name, notes: [r.reason, r.notes].filter(Boolean).join(" — "), status, branch,
      lines: (r.purchase_return_items ?? []).map((i: any) => ({ name: i.product_name, qty: Number(i.quantity), price: Number(i.unit_cost), total: Number(i.total) })),
      rows: [["على فاتورة", esc(r.shipments?.shipment_number ?? "—")], ...refundRows()],
      total: Number(r.total_amount) || 0,
    };
    default: return {
      number: r.voucher_number, date: r.voucher_date ?? r.created_at, party: r.__account ?? r.party_name ?? "—", partyLabel: "اسم الحساب",
      recipient: r.recipient_name, notes: r.description, status, branch, lines: [],
      rows: [
        ["التصنيف", esc(r.voucher_categories?.name ?? "—")],
        ["طريقة الدفع", esc((PAYMENT_METHOD_LABELS as any)[r.payment_method] ?? r.payment_method ?? "—")],
        ...(r.reference_number ? [["رقم العملية", esc(r.reference_number)] as [string, string]] : []),
        ...(Number(r.fee_amount) > 0 ? [["عمولة التحويل", money(r.fee_amount)] as [string, string]] : []),
      ],
      total: Number(r.amount) || 0,
    };
  }
}

function docHtml(k: BulkKind, d: Doc, company: any): string {
  const lines = d.lines.length ? `
    <table class="items"><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
      ${d.lines.map((l, i) => `<tr><td>${i + 1}</td><td class="name">${esc(l.name)}</td><td>${esc(l.qty)}</td><td>${money(l.price)}</td><td>${money(l.total)}</td></tr>`).join("")}
    </tbody></table>` : "";
  return `<section class="doc">
    <header>
      ${company?.name ? `<div class="company">${esc(company.name)}</div>` : ""}
      ${[company?.phone, company?.address].filter(Boolean).length ? `<div class="muted">${esc([company?.phone, company?.address].filter(Boolean).join(" • "))}</div>` : ""}
      <div class="title">${TITLE[k]} <span class="num">${esc(d.number)}</span>${d.status ? ` <span class="cancel">${d.status}</span>` : ""}</div>
    </header>
    <div class="meta">
      <div><span>التاريخ</span><b>${day(d.date)}</b></div>
      ${d.branch ? `<div><span>الفرع</span><b>${esc(d.branch)}</b></div>` : ""}
      <div><span>${d.partyLabel}</span><b>${esc(d.party)}</b></div>
      ${d.recipient ? `<div><span>المستلم</span><b>${esc(d.recipient)}</b></div>` : ""}
    </div>
    ${lines}
    <div class="totals">
      ${d.rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("")}
      <div class="grand"><span>${k === "income" || k === "expense" ? "المبلغ" : "الإجمالي"}</span><b>${money(d.total)}</b></div>
    </div>
    ${d.notes ? `<div class="notes"><span>ملاحظات:</span> ${esc(d.notes)}</div>` : ""}
    <div class="sign"><span>توقيع المستلم</span><span>توقيع المسؤول</span></div>
  </section>`;
}

const CSS_COMMON = `
  * { box-sizing: border-box; }
  body { font-family: "Cairo", "Segoe UI", Tahoma, sans-serif; color: #111; margin: 0; }
  .doc { page-break-after: always; break-after: page; }
  .doc:last-child { page-break-after: auto; break-after: auto; }
  header { text-align: center; margin-bottom: 8px; }
  .company { font-weight: 800; }
  .muted { color: #555; }
  .title { font-weight: 800; margin-top: 4px; }
  .num { font-family: monospace; }
  .cancel { color: #b91c1c; border: 1px solid #b91c1c; border-radius: 4px; padding: 0 4px; }
  .meta div, .totals div { display: flex; justify-content: space-between; gap: 8px; }
  .meta span, .totals span { color: #555; }
  table.items { width: 100%; border-collapse: collapse; margin: 8px 0; }
  table.items th, table.items td { border-bottom: 1px solid #ddd; padding: 3px 4px; text-align: center; }
  table.items td.name { text-align: right; }
  .totals .grand { border-top: 2px solid #111; margin-top: 4px; padding-top: 4px; font-weight: 800; }
  .notes { margin-top: 8px; }
  .sign { display: flex; justify-content: space-between; margin-top: 28px; color: #555; }
  .print-bar { position: fixed; bottom: 12px; left: 12px; display: flex; gap: 8px; }
  .print-bar button { padding: 8px 14px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; font-family: inherit; }
  @media print { .print-bar { display: none; } }
`;
const CSS: Record<PrintFormat, string> = {
  a4: `@page { size: A4 portrait; margin: 14mm 12mm; }
    body { font-size: 13px; } .company { font-size: 20px; } .title { font-size: 17px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 10px 0; }
    .totals { width: 45%; margin-right: auto; }`,
  thermal: `@page { size: 80mm auto; margin: 3mm; }
    body { width: 74mm; font-size: 11px; } .company { font-size: 14px; } .title { font-size: 13px; }
    .meta { margin: 6px 0; } table.items th, table.items td { padding: 2px; font-size: 10px; }
    .sign { margin-top: 18px; }`,
};

/** One print job with every selected document, each on its own page (A4) or its own receipt (80mm). */
export async function printDocuments(k: BulkKind, ids: string[], format: PrintFormat) {
  // open the window inside the click so the browser does not block it, then fill it
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) throw new Error("المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة للموقع");
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طباعة</title></head><body style="font-family:sans-serif;padding:24px">جاري تجهيز ${ids.length} مستند للطباعة...</body></html>`);
  try {
    const rows: any[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from(TABLE[k] as any).select(SELECT[k]).in("id", ids.slice(i, i + 100));
      if (error) throw error;
      rows.push(...(data ?? []));
    }
    if (k === "income" || k === "expense") {
      // «اسم الحساب» of an automatic voucher = the customer / supplier of its document (0099)
      const links = await fetchTreasuryLinks(rows.map((r: any) => r.treasury_id)).catch(() => new Map());
      for (const r of rows) r.__account = (links.get(r.treasury_id) as any)?.account_name ?? r.party_name ?? null;
    }
    const byId = new Map(rows.map((r: any) => [r.id, r]));
    const { data: settings } = await supabase.from("settings").select("key, value").eq("key", "company");
    const company = (settings ?? []).map((s: any) => s.value).find(Boolean) ?? {};
    const body = ids.map((id) => byId.get(id)).filter(Boolean).map((r) => docHtml(k, toDoc(k, r), company)).join("");
    w.document.open();
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(TITLE[k])} — ${ids.length}</title>
      <style>${CSS_COMMON}${CSS[format]}</style></head><body>${body}
      <div class="print-bar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button><button onclick="window.close()" style="background:#6b7280">إغلاق</button></div>
      <script>setTimeout(function(){ window.focus(); window.print(); }, 300);</script></body></html>`);
    w.document.close();
  } catch (e) {
    w.close();
    throw e;
  }
}

/** Statements of several customers / suppliers in one print job (A4), each side on its own page — no netting. */
export async function printStatements(contacts: { id: string; name: string; type: string }[], branchId: string | null, branchName?: string | null) {
  const { fetchContactStatement } = await import("@/lib/ledger");
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) throw new Error("المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة للموقع");
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طباعة</title></head><body style="font-family:sans-serif;padding:24px">جاري تجهيز كشوف ${contacts.length} حساب...</body></html>`);
  try {
    const { data: settings } = await supabase.from("settings").select("key, value").eq("key", "company");
    const company: any = (settings ?? []).map((s: any) => s.value).find(Boolean) ?? {};
    const parts: string[] = [];
    for (const c of contacts) {
      const sides: ("customer" | "supplier")[] = c.type === "both" ? ["customer", "supplier"] : c.type === "supplier" ? ["supplier"] : ["customer"];
      for (const side of sides) {
        const lines = await fetchContactStatement(c.id, side, branchId, null, null);
        const last = lines.length ? lines[lines.length - 1].balance : 0;
        const label = side === "customer"
          ? (last > 0.005 ? "لينا عنده" : last < -0.005 ? "له عندنا (مقدم)" : "مسدد")
          : (last > 0.005 ? "علينا له" : last < -0.005 ? "لينا عنده (مقدم)" : "مسدد");
        parts.push(`<section class="doc">
          <header>
            ${company?.name ? `<div class="company">${esc(company.name)}</div>` : ""}
            <div class="title">كشف حساب ${side === "customer" ? "عميل" : "مورد"} — ${esc(c.name)}</div>
            <div class="muted">${branchName ? `فرع ${esc(branchName)}` : "كل الفروع"} • حتى ${day(new Date().toISOString())}</div>
          </header>
          <table class="items"><thead><tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>
            ${lines.map((l) => `<tr><td>${day(l.line_date)}</td><td class="name">${esc(l.description ?? l.line_type)}</td><td>${esc(l.reference ?? "")}</td>
              <td>${l.debit ? money(l.debit) : ""}</td><td>${l.credit ? money(l.credit) : ""}</td><td>${money(l.balance)}</td></tr>`).join("")}
          </tbody></table>
          <div class="totals"><div class="grand"><span>${label}</span><b>${money(Math.abs(last))}</b></div></div>
        </section>`);
      }
    }
    w.document.open();
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشوف حساب — ${contacts.length}</title>
      <style>${CSS_COMMON}${CSS.a4} .totals { width: 45%; }</style></head><body>${parts.join("")}
      <div class="print-bar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button><button onclick="window.close()" style="background:#6b7280">إغلاق</button></div>
      <script>setTimeout(function(){ window.focus(); window.print(); }, 300);</script></body></html>`);
    w.document.close();
  } catch (e) {
    w.close();
    throw e;
  }
}
