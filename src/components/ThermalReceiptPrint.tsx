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

  const companyName = props.companyName || company.name || "";
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
            <tr key={row.label} className={row.highlight ? "tr-total-highlight" : undefined}>
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
        {phone && <div>ت: {phone}</div>}
        {address && <div>{address}</div>}
        {footerNote && <div>{footerNote}</div>}
      </div>
    </div>
  );
}

/** Inject @page sized for XP-80C 80mm thermal paper before printing. */
export function printThermalInvoice() {
  const id = "__thermal_page_style__";
  document.getElementById(id)?.remove();
  const style = document.createElement("style");
  style.id = id;
  // XP 80-C uses 80mm paper; inner receipt padding leaves the real printable
  // content near 72mm without making Chrome render a smaller custom page.
  style.textContent = `
    @media print {
      @page { size: 80mm auto !important; margin: 0 !important; }
      html, body { width: 80mm !important; margin: 0 !important; padding: 0 !important; }
    }
  `;
  document.head.appendChild(style);
  const cleanup = () => { document.getElementById(id)?.remove(); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  const startPrint = () => setTimeout(() => window.print(), 80);
  document.fonts?.load('16px "Vazir"').then(() => document.fonts.ready).finally(startPrint) ?? startPrint();
}
