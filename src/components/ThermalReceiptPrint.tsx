import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ThermalReceiptItem {
  name: string;
  qty: number;
  unit_price: number;
  total: number;
}

export interface ThermalReceiptProps {
  kind: "sale" | "purchase";
  companyName?: string;
  branchName?: string;
  invoiceNumber: string;
  createdAt: string | Date;
  paymentType?: string;
  dueDate?: string | null;
  cashier?: string | null;
  partyName?: string | null;
  notes?: string | null;
  items: ThermalReceiptItem[];
  subtotal: number;
  discount?: number;
  total: number;
  paid?: number;
  previousBalance?: number | null;
  currentBalance?: number | null;
  remaining?: number;
  paymentMethodLabel?: string;
}

interface CompanyInfo {
  name?: string;
  logo_url?: string;
  phone?: string;
  address?: string;
  tax_id?: string;
}
interface InvoiceSettingsRow {
  footer_note?: string;
}
interface VatSettings {
  enabled?: boolean;
  rate?: number;
}

let cache: { company?: CompanyInfo; invoice?: InvoiceSettingsRow; vat?: VatSettings } | null = null;

export function useReceiptSettings() {
  const [data, setData] = useState(cache);
  useEffect(() => {
    if (cache) { setData(cache); return; }
    (async () => {
      const { data: rows } = await supabase.from("settings").select("key, value").in("key", ["company", "invoice", "vat"]);
      const next: any = {};
      for (const r of rows ?? []) {
        if (r.key === "company") next.company = r.value;
        if (r.key === "invoice") next.invoice = r.value;
        if (r.key === "vat") next.vat = r.value;
      }
      cache = next;
      setData(next);
    })();
  }, []);
  return data ?? {};
}

const fmt2 = (n: number) => {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (d: string | Date) => {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}/${pad(x.getMonth() + 1)}/${pad(x.getDate())}`;
};
const fmtTime = (d: string | Date) => {
  const x = typeof d === "string" ? new Date(d) : d;
  let h = x.getHours();
  const m = pad(x.getMinutes());
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${m} ${ap}`;
};

const paymentLabel = (t?: string) => {
  if (!t) return "—";
  const map: Record<string, string> = {
    cash: "نقدي", credit: "آجل", visa: "فيزا",
    instapay: "Instapay", vodafone_cash: "فودافون كاش",
    bank_transfer: "تحويل بنكي",
  };
  return map[t] ?? t;
};

export function ThermalReceiptPrint(props: ThermalReceiptProps) {
  const settings = useReceiptSettings();
  const company = settings.company ?? {};
  const invoiceSettings = settings.invoice ?? {};

  const settingsCompanyName = company.name && !/^nexa\s*store$/i.test(company.name.trim()) ? company.name : "";
  const companyName = props.companyName || settingsCompanyName;
  const phone = company.phone || "";
  const address = company.address || "";
  const footerNote = invoiceSettings.footer_note || "";
  const discount = Number(props.discount ?? 0);
  const remaining = Number(props.remaining ?? Math.max(props.total - (props.paid ?? 0), 0));


  const title = props.kind === "sale" ? "فاتورة بيع" : "فاتورة شراء";
  const partyLabel = props.kind === "sale" ? "العميل" : "المورد";
  const cashierLabel = props.kind === "sale" ? "الكاشير" : "أمين المخزن";
  const totalRows: Array<{ label: string; value: ReactNode; highlight?: boolean; balance?: boolean }> = [
    { label: "الإجمالى", value: fmt2(props.subtotal) },
    ...(discount > 0 ? [{ label: "خصم", value: fmt2(discount) }] : []),
    { label: "المطلوب", value: fmt2(props.total), highlight: true },
    ...(typeof props.paid === "number" ? [{ label: "المدفوع", value: fmt2(props.paid) }] : []),
    ...(remaining > 0 && props.paymentType !== "credit" ? [{ label: "الباقى", value: fmt2(remaining) }] : []),
    ...(remaining > 0 && props.paymentType === "credit" ? [{ label: "الآجل", value: fmt2(remaining) }] : []),
    ...(typeof props.previousBalance === "number" ? [{ label: "الرصيد السابق", value: fmt2(props.previousBalance), balance: true }] : []),
    ...(typeof props.currentBalance === "number" ? [{ label: "الرصيد الحالى", value: fmt2(props.currentBalance), balance: true }] : []),
  ];

  return (
    <div id="invoice-print-area" className="thermal-print" dir="rtl">
      <div className="tr-header">
        {company.logo_url ? (
          <img
            src={company.logo_url}
            alt=""
            referrerPolicy="no-referrer"
            className="tr-logo"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
        {companyName && <div className="tr-company-bar">{companyName}</div>}
        <div className="tr-title">{title}</div>
        {company.tax_id && <div className="tr-tax">رقم ضريبى {company.tax_id}</div>}
      </div>

      <table className="tr-meta-grid" dir="ltr">
        <tbody>
          <tr>
            <td className="tr-meta-value">{fmtDate(props.createdAt)}</td>
            <th>التاريخ</th>
            <td className="tr-meta-gap" />
            <td className="tr-meta-value">{props.invoiceNumber}</td>
            <th>رقم الفاتورة</th>
          </tr>
          <tr>
            <td className="tr-meta-value">{fmtTime(props.createdAt)}</td>
            <th>الوقت</th>
            <td className="tr-meta-gap" />
            <td className="tr-meta-value">{paymentLabel(props.paymentType)}</td>
            <th>نوع الفاتورة</th>
          </tr>
          <tr>
            <td className="tr-meta-value">{props.dueDate ? fmtDate(props.dueDate) : fmtDate(props.createdAt)}</td>
            <th>تستحق</th>
            <td className="tr-meta-gap" />
            <td className="tr-meta-value">{props.cashier || "—"}</td>
            <th>{cashierLabel}</th>
          </tr>
          {props.partyName && (
            <tr>
              <td />
              <th />
              <td className="tr-meta-gap" />
              <td className="tr-meta-value">{props.partyName}</td>
              <th>{partyLabel}</th>
            </tr>
          )}
          {props.notes && (
            <tr className="tr-notes-row">
              <td colSpan={4} className="tr-notes-value">{props.notes}</td>
              <th>ملاحظات</th>
            </tr>
          )}
        </tbody>
      </table>

      <table className="tr-items" dir="ltr">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "21%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "44%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>الإجمالى</th>
            <th>السعر</th>
            <th>كمية</th>
            <th>اسم الصنف</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((it, i) => (
            <tr key={i}>
              <td className="tr-num">{fmt2(it.total)}</td>
              <td className="tr-num">{fmt2(it.unit_price)}</td>
              <td className="tr-num">{it.qty}</td>
              <td className="tr-name">{it.name}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="tr-totals" dir="ltr">
        <tbody>
          {totalRows.map((row) => (
            <tr key={row.label} className={row.highlight ? "tr-total-highlight" : row.balance ? "tr-total-balance" : undefined}>
              <td className="tr-total-value">{row.value}</td>
              <th>{row.label}</th>
            </tr>
          ))}
        </tbody>
      </table>

      {props.paymentMethodLabel && (
        <div className="tr-pay-method">طريقة الدفع: {props.paymentMethodLabel}</div>
      )}

      <div className="tr-footer">
        <div className="tr-thanks">شكراً لزيارتكم</div>
        {phone && <div className="tr-phone">ت: {phone}</div>}
        {address && <div>{address}</div>}
        {footerNote && <div>{footerNote}</div>}
      </div>
    </div>
  );
}

/**
 * Print the thermal receipt inside an isolated iframe.
 * - Empty <title> removes the "Nexa Store" / URL headers the browser adds.
 * - @page size 80mm + zero margins forces the content to fill the thermal roll.
 * - The iframe auto-prints and removes itself; the print dialog opens straight
 *   on the receipt with no extra options page.
 */
export function printThermalInvoice() {
  const source = document.getElementById("invoice-print-area");
  if (!source) { window.print(); return; }

  // Collect all stylesheets / inline <style> tags so the iframe matches the app styling.
  const headStyles = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style')
  ).map((n) => n.outerHTML).join("\n");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title></title>
<base href="${location.origin}/" />
${headStyles}
<style>
  /* Continuous thermal page — grows with content (XP-80C cuts at end). */
  @page { size: 80mm auto; margin: 0; }
  html, body {
    width: 80mm; margin: 0 !important; padding: 0 !important;
    background: #fff !important; color: #000 !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body { display: block !important; }
  /* Only the container avoids breaks — applying break-inside:avoid to every
     descendant actually *forces* the browser to break early. */
  #invoice-print-area {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    display: block !important; position: static !important;
    width: 80mm !important; max-width: 80mm !important; min-width: 80mm !important;
    margin: 0 !important; padding: 1.5mm 2mm !important;
    box-sizing: border-box !important;
    font-family: "Vazir","Vazirmatn",Arial,Tahoma,sans-serif !important;
    direction: rtl !important;
    line-height: 1.3 !important;
    color: #000 !important; background: #fff !important;
    /* --tr-scale is set by JS auto-shrink below; 1 = full size */
    font-size: calc(12pt * var(--tr-scale, 1)) !important;
  }
  #invoice-print-area table { page-break-inside: avoid !important; break-inside: avoid !important; }
  #invoice-print-area tr    { page-break-inside: avoid !important; break-inside: avoid !important; }

  #invoice-print-area .tr-logo { width: calc(26mm * var(--tr-scale, 1)) !important; height: calc(26mm * var(--tr-scale, 1)) !important; }
  #invoice-print-area .tr-header { margin-bottom: 2mm !important; }
  #invoice-print-area .tr-company-bar { font-size: calc(15pt * var(--tr-scale, 1)) !important; line-height: 1.15 !important; padding: 1mm 0 !important; }
  #invoice-print-area .tr-title { font-size: calc(13pt * var(--tr-scale, 1)) !important; padding-bottom: 1mm !important; }
  #invoice-print-area .tr-tax { font-size: calc(10pt * var(--tr-scale, 1)) !important; }
  #invoice-print-area .tr-meta-grid th,
  #invoice-print-area .tr-meta-grid td { font-size: calc(10pt * var(--tr-scale, 1)) !important; padding: 0.7mm 0.6mm !important; line-height: 1.3 !important; }
  #invoice-print-area table.tr-items { table-layout: fixed !important; width: 100% !important; }
  #invoice-print-area table.tr-items th,
  #invoice-print-area table.tr-items td { font-size: calc(10.5pt * var(--tr-scale, 1)) !important; padding: 1.5mm 0.8mm !important; border: 0.3mm solid #000 !important; line-height: 1.25 !important; word-wrap: break-word !important; overflow-wrap: anywhere !important; white-space: normal !important; }
  #invoice-print-area table.tr-items th { font-weight: 800 !important; }
  #invoice-print-area table.tr-items .tr-name { text-align: right !important; }
  #invoice-print-area .tr-totals th,
  #invoice-print-area .tr-totals td { font-size: calc(11pt * var(--tr-scale, 1)) !important; padding: 1.2mm 1mm !important; border: 0.3mm solid #000 !important; line-height: 1.22 !important; }
  #invoice-print-area .tr-total-highlight th,
  #invoice-print-area .tr-total-highlight td { font-size: calc(15pt * var(--tr-scale, 1)) !important; font-weight: 800 !important; border: 0.5mm solid #000 !important; }
  #invoice-print-area .tr-total-balance th,
  #invoice-print-area .tr-total-balance td { font-size: calc(10.5pt * var(--tr-scale, 1)) !important; }
  #invoice-print-area .tr-pay-method { font-size: calc(10pt * var(--tr-scale, 1)) !important; }
  #invoice-print-area .tr-footer { font-size: calc(10pt * var(--tr-scale, 1)) !important; line-height: 1.35 !important; }
  #invoice-print-area .tr-thanks { font-size: calc(12pt * var(--tr-scale, 1)) !important; }
  #invoice-print-area .tr-phone { font-size: calc(10pt * var(--tr-scale, 1)) !important; }
  #invoice-print-area, #invoice-print-area * { visibility: visible !important; }
</style>
</head>
<body>${source.outerHTML}</body>
</html>`);
  doc.close();

  const cleanup = () => { try { iframe.remove(); } catch {} };
  const trigger = () => {
    const win = iframe.contentWindow!;
    const fonts = (doc as any).fonts;
    const start = () => {
      try {
        // Auto-shrink: if the rendered receipt would exceed one printer page
        // (driver might be set to A4 = ~297mm or Letter), scale down a CSS
        // variable until everything fits in a single physical page.
        const area = doc.getElementById("invoice-print-area") as HTMLElement | null;
        if (area) {
          // Convert mm -> px using the iframe's own DPI.
          const probe = doc.createElement("div");
          probe.style.cssText = "position:absolute;width:100mm;height:0;visibility:hidden;";
          doc.body.appendChild(probe);
          const pxPerMm = probe.getBoundingClientRect().width / 100;
          probe.remove();
          const maxHeightPx = 290 * pxPerMm; // safe single-page budget
          let scale = 1;
          area.style.setProperty("--tr-scale", String(scale));
          // Force reflow then measure
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          area.offsetHeight;
          while (area.scrollHeight > maxHeightPx && scale > 0.55) {
            scale -= 0.05;
            area.style.setProperty("--tr-scale", scale.toFixed(2));
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            area.offsetHeight;
          }
        }
        win.focus();
        win.print();
      } finally {
        setTimeout(cleanup, 1500);
      }
    };
    if (fonts?.ready) fonts.ready.then(start, start); else start();
  };

  if (doc.readyState === "complete") trigger();
  else iframe.addEventListener("load", trigger, { once: true });
}
