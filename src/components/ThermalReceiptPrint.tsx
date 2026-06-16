import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ThermalReceiptItem {
  name: string;
  qty: number;
  unit_price: number;
  total: number;
}

export interface ThermalReceiptProps {
  kind: "sale" | "purchase" | "quote";
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
  vatAmount?: number;
  vatRate?: number;
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


  const title = props.kind === "sale" ? "فاتورة بيع" : props.kind === "purchase" ? "فاتورة شراء" : "عرض سعر";
  const partyLabel = props.kind === "purchase" ? "المورد" : "العميل";
  const cashierLabel = props.kind === "purchase" ? "أمين المخزن" : props.kind === "quote" ? "أصدر العرض" : "الكاشير";
  const vatAmount = Number(props.vatAmount ?? 0);
  const vatRate = Number(props.vatRate ?? 0);
  const totalRows: Array<{ label: string; value: ReactNode; highlight?: boolean; balance?: boolean }> = [
    { label: "الإجمالى", value: fmt2(props.subtotal) },
    ...(discount > 0 ? [{ label: "خصم", value: fmt2(discount) }] : []),
    ...(vatAmount > 0 ? [{ label: `ض.ق.م ${vatRate ? `(${vatRate}%)` : ""}`.trim(), value: fmt2(vatAmount) }] : []),
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
            <th>{props.kind === "quote" ? "رقم العرض" : "رقم الفاتورة"}</th>
          </tr>
          <tr>
            <td className="tr-meta-value">{fmtTime(props.createdAt)}</td>
            <th>الوقت</th>
            <td className="tr-meta-gap" />
            <td className="tr-meta-value">{props.kind === "quote" ? "—" : paymentLabel(props.paymentType)}</td>
            <th>{props.kind === "quote" ? "النوع" : "نوع الفاتورة"}</th>
          </tr>
          <tr>
            <td className="tr-meta-value">{props.dueDate ? fmtDate(props.dueDate) : fmtDate(props.createdAt)}</td>
            <th>{props.kind === "quote" ? "صالح حتى" : "تستحق"}</th>
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
  @page { size: 80mm 297mm; margin: 0; }
  html, body {
    width: 80mm; min-height: 297mm; margin: 0 !important; padding: 0 !important;
    background: #fff !important; color: #000 !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body { display: block !important; overflow: hidden !important; }
  #invoice-print-area {
    display: block !important; position: static !important;
    width: 72.1mm !important; max-width: 72.1mm !important; min-width: 72.1mm !important;
    margin: 0 auto !important; padding: 0 !important;
    box-sizing: border-box !important;
    font-family: "Vazir","Vazirmatn",Arial,Tahoma,sans-serif !important;
    direction: rtl !important;
    font-size: 11pt !important; line-height: 1.35 !important;
    color: #000 !important; background: #fff !important;
  }
  #invoice-print-area .tr-logo { width: 24mm !important; height: 24mm !important; }
  #invoice-print-area .tr-header { margin-bottom: 2mm !important; }
  #invoice-print-area .tr-company-bar { font-size: 14pt !important; line-height: 1.15 !important; padding: 1mm 0 !important; }
  #invoice-print-area .tr-title { font-size: 12pt !important; padding-bottom: 1mm !important; }
  #invoice-print-area .tr-tax { font-size: 9pt !important; }
  #invoice-print-area .tr-meta-grid th,
  #invoice-print-area .tr-meta-grid td { font-size: 9pt !important; padding: 0.7mm 0.6mm !important; line-height: 1.3 !important; }
  #invoice-print-area table.tr-items { table-layout: fixed !important; width: 100% !important; }
  #invoice-print-area table.tr-items th,
  #invoice-print-area table.tr-items td { font-size: 9.5pt !important; padding: 1.6mm 0.8mm !important; border: 0.3mm solid #000 !important; line-height: 1.25 !important; word-wrap: break-word !important; overflow-wrap: anywhere !important; white-space: normal !important; }
  #invoice-print-area table.tr-items th { font-size: 9.5pt !important; font-weight: 800 !important; }
  #invoice-print-area table.tr-items .tr-name { text-align: right !important; }
  #invoice-print-area .tr-totals th,
  #invoice-print-area .tr-totals td { font-size: 10.5pt !important; padding: 1.2mm 1mm !important; border: 0.3mm solid #000 !important; line-height: 1.22 !important; }
  #invoice-print-area .tr-total-highlight th,
  #invoice-print-area .tr-total-highlight td { font-size: 14pt !important; font-weight: 800 !important; border: 0.5mm solid #000 !important; }
  #invoice-print-area .tr-total-balance th,
  #invoice-print-area .tr-total-balance td { font-size: 10pt !important; }
  #invoice-print-area .tr-pay-method { font-size: 9.5pt !important; }
  #invoice-print-area .tr-footer { font-size: 9pt !important; line-height: 1.35 !important; }
  #invoice-print-area .tr-thanks { font-size: 11pt !important; }
  #invoice-print-area .tr-phone { font-size: 9pt !important; }
  /* Make sure nothing inherits visibility:hidden from the host @media print rules */
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
        win.focus();
        win.print();
      } finally {
        // Give the browser time to open its print dialog before removing the iframe.
        setTimeout(cleanup, 1500);
      }
    };
    if (fonts?.ready) fonts.ready.then(start, start); else start();
  };

  if (doc.readyState === "complete") trigger();
  else iframe.addEventListener("load", trigger, { once: true });
}
