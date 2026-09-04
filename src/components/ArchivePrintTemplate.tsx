/**
 * قالب طباعة مستقل تمامًا لموديول الأرشيف التاريخي.
 *
 * نسخة بصرية طبق الأصل من فاتورة النظام الحرارية (ThermalReceiptPrint)
 * لكنه معزول 100%: مالوش أي علاقة بمكوّن الطباعة الحي ولا ببياناته،
 * فأي تعديل هنا لا يؤثر على الفواتير الحية إطلاقًا.
 *
 * يقرأ فقط جدول `settings` (اللوجو / اسم الشركة / ملاحظة التذييل) للعرض.
 */
import { supabase } from "@/integrations/supabase/client";

export type ArchivePrintItem = {
  item_code?: string | null;
  item_name: string;
  qty: number;
  price: number;
  total: number;
};

export type ArchivePrintDoc = {
  title: string;
  invoice_no: string | null;
  date: string;
  branch_name: string;
  party_name?: string | null;
  party_label?: string;
  payment_method?: string | null;
  total_qty?: number;
  discount?: number;
  total_amount: number;
  paid_cash?: number;
  due?: number;
};

type PrintSettings = {
  company?: { name?: string; logo_url?: string; phone?: string; address?: string; tax_number?: string; tax_id?: string };
  invoice?: { footer_note?: string; show_logo?: boolean };
};

let archiveSettingsCache: PrintSettings | null = null;

export async function loadArchivePrintSettings(): Promise<PrintSettings> {
  const { data: rows } = await supabase.from("settings").select("key, value").in("key", ["company", "invoice"]);
  const next: PrintSettings = {};
  for (const r of rows ?? []) {
    if (r.key === "company") next.company = r.value as any;
    if (r.key === "invoice") next.invoice = r.value as any;
  }
  archiveSettingsCache = next;
  return next;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const fmt2 = (n: unknown) =>
  Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CSS = `
  @page { size: 80mm 297mm; margin: 0; }
  html, body { width: 80mm; margin: 0; padding: 0; background: #fff; color: #000;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ar { width: 72.1mm; margin: 0 auto; box-sizing: border-box;
    font-family: "Vazir","Vazirmatn",Arial,Tahoma,sans-serif; direction: rtl;
    font-size: 11pt; line-height: 1.35; }
  .ar-header { text-align: center; margin-bottom: 2mm; }
  .ar-logo { width: 26mm; height: 26mm; object-fit: contain; display: block; margin: 0 auto 1mm; }
  .ar-company { font-size: 14pt; font-weight: 800; padding: 1mm 0; border-bottom: 0.4mm solid #000; }
  .ar-title { font-size: 12pt; font-weight: 700; padding-bottom: 1mm; }
  .ar-no { font-size: 15pt; font-weight: 900; letter-spacing: 0.4pt; padding: 1mm 0; border: 0.5mm solid #000; margin: 1mm 0; }
  .ar-tax { font-size: 9pt; }
  .ar-badge { font-size: 8.5pt; border: 0.3mm dashed #000; display: inline-block; padding: 0.4mm 1.4mm; margin-top: 1mm; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .ar-meta th, .ar-meta td { font-size: 9pt; padding: 0.7mm 0.6mm; line-height: 1.3; text-align: right; }
  .ar-meta th { font-weight: 700; width: 26%; }
  .ar-items th, .ar-items td { font-size: 9.5pt; padding: 1.6mm 0.8mm; border: 0.3mm solid #000;
    line-height: 1.25; word-wrap: break-word; overflow-wrap: break-word; text-align: center; }
  .ar-items th { font-weight: 800; }
  .ar-items .name { text-align: right; }
  .ar-totals th, .ar-totals td { font-size: 10.5pt; padding: 1.2mm 1mm; border: 0.3mm solid #000; }
  .ar-totals th { text-align: right; }
  .ar-totals td { text-align: left; font-variant-numeric: tabular-nums; }
  .ar-hi th, .ar-hi td { font-size: 14pt; font-weight: 800; border: 0.5mm solid #000; }
  .ar-footer { text-align: center; margin-top: 2mm; font-size: 9pt; line-height: 1.35; }
  .ar-thanks { font-size: 11pt; font-weight: 700; }
`;

export function buildArchiveInvoiceHtml(doc: ArchivePrintDoc, items: ArchivePrintItem[], settings: PrintSettings): string {
  const company = settings.company ?? {};
  const inv = settings.invoice ?? {};
  const companyName = company.name && !/^nexa\s*store$/i.test(company.name.trim()) ? company.name : "";
  const showLogo = company.logo_url && inv.show_logo !== false;
  const taxNo = company.tax_number || company.tax_id;
  const partyLabel = doc.party_label ?? "الطرف";
  const discount = Number(doc.discount ?? 0);

  const itemRows = items.map((it) => `
    <tr>
      <td>${fmt2(it.total)}</td>
      <td>${fmt2(it.price)}</td>
      <td>${Number(it.qty ?? 0)}</td>
      <td class="name">${esc(it.item_name)}</td>
    </tr>`).join("");

  const totals: Array<[string, string, boolean?]> = [
    ["الإجمالى", fmt2(doc.total_amount)],
    ...(discount > 0 ? [["خصم", fmt2(discount)] as [string, string]] : []),
    ["المطلوب", fmt2(doc.total_amount), true],
    ...(doc.paid_cash !== undefined ? [["المدفوع", fmt2(doc.paid_cash)] as [string, string]] : []),
    ...(Number(doc.due ?? 0) !== 0 ? [["الباقى", fmt2(doc.due)] as [string, string]] : []),
  ];

  return `<!doctype html>
<html dir="rtl" lang="ar"><head><meta charset="utf-8" /><title></title><style>${CSS}</style></head>
<body><div class="ar">
  <div class="ar-header">
    ${showLogo ? `<img class="ar-logo" src="${esc(company.logo_url)}" alt="" referrerpolicy="no-referrer" />` : ""}
    ${companyName ? `<div class="ar-company">${esc(companyName)}</div>` : ""}
    <div class="ar-title">${esc(doc.title)}</div>
    <div class="ar-no">رقم: ${esc(doc.invoice_no ?? "—")}</div>
    ${taxNo ? `<div class="ar-tax">رقم ضريبى ${esc(taxNo)}</div>` : ""}
    <div class="ar-badge">مستند أرشيف تاريخى</div>
  </div>

  <table class="ar-meta"><tbody>
    <tr><th>التاريخ</th><td>${esc(doc.date)}</td><th>الفرع</th><td>${esc(doc.branch_name)}</td></tr>
    <tr><th>${esc(partyLabel)}</th><td colspan="3">${esc(doc.party_name ?? "—")}</td></tr>
    <tr><th>السداد</th><td>${esc(doc.payment_method ?? "—")}</td><th>عدد القطع</th><td>${Number(doc.total_qty ?? 0)}</td></tr>
  </tbody></table>

  <table class="ar-items">
    <colgroup><col style="width:24%" /><col style="width:21%" /><col style="width:13%" /><col style="width:42%" /></colgroup>
    <thead><tr><th>الإجمالى</th><th>السعر</th><th>كمية</th><th>اسم الصنف</th></tr></thead>
    <tbody>${itemRows || `<tr><td colspan="4">لا توجد أصناف مسجلة</td></tr>`}</tbody>
  </table>

  <table class="ar-totals"><tbody>
    ${totals.map(([l, v, hi]) => `<tr class="${hi ? "ar-hi" : ""}"><th>${esc(l)}</th><td>${v}</td></tr>`).join("")}
  </tbody></table>

  <div class="ar-footer">
    <div class="ar-thanks">شكراً لزيارتكم</div>
    ${company.phone ? `<div>ت: ${esc(company.phone)}</div>` : ""}
    ${company.address ? `<div>${esc(company.address)}</div>` : ""}
    ${inv.footer_note ? `<div>${esc(inv.footer_note)}</div>` : ""}
  </div>
</div></body></html>`;
}

/** يطبع مستند أرشيفى داخل iframe معزول تمامًا عن الصفحة والفواتير الحية. */
export async function printArchiveInvoice(doc: ArchivePrintDoc, items: ArchivePrintItem[]) {
  const settings = archiveSettingsCache ?? (await loadArchivePrintSettings());
  const html = buildArchiveInvoiceHtml(doc, items, settings);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const d = iframe.contentDocument!;
  d.open(); d.write(html); d.close();

  const start = () => {
    try {
      iframe.contentWindow!.focus();
      iframe.contentWindow!.print();
    } finally {
      setTimeout(() => { try { iframe.remove(); } catch { /* noop */ } }, 1500);
    }
  };
  if (d.readyState === "complete") start();
  else iframe.addEventListener("load", start, { once: true });
}
