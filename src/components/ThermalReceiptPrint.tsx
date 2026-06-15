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
  const vat = settings.vat ?? { enabled: false, rate: 0 };

  const companyName = props.companyName || company.name || "";
  const phone = company.phone || "";
  const footerNote = invoiceSettings.footer_note || "";
  const vatEnabled = !!vat.enabled;
  const vatRate = Number(vat.rate ?? 0);
  const discount = Number(props.discount ?? 0);
  const taxable = Math.max(props.subtotal - discount, 0);
  const vatAmount = vatEnabled ? taxable * (vatRate / 100) : 0;
  const remaining = Number(props.remaining ?? Math.max(props.total - (props.paid ?? 0), 0));

  const title = props.kind === "sale" ? "فاتورة بيع" : "فاتورة شراء";
  const partyLabel = props.kind === "sale" ? "العميل" : "المورد";
  const cashierLabel = props.kind === "sale" ? "الكاشير" : "أمين المخزن";

  const Row = ({ label, value, bold }: { label: string; value: ReactNode; bold?: boolean }) => (
    <div className="tr-row" style={bold ? { fontWeight: 700 } : undefined}>
      <span className="tr-label">{label}</span>
      <span className="tr-value">{value}</span>
    </div>
  );

  return (
    <div id="invoice-print-area" className="thermal-print" dir="rtl">
      {/* Header */}
      <div className="tr-header">
        {company.logo_url ? (
          <img
            src={company.logo_url}
            alt=""
            crossOrigin="anonymous"
            className="tr-logo"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
        {companyName && <div className="tr-company">{companyName}</div>}
        {props.branchName && <div className="tr-branch">{props.branchName}</div>}
      </div>

      <div className="tr-sep" />
      <div className="tr-title">{title}</div>
      <div className="tr-sep" />

      {/* Meta */}
      <div className="tr-meta">
        <Row label="رقم الفاتورة:" value={props.invoiceNumber} />
        <Row label="التاريخ:" value={fmtDate(props.createdAt)} />
        <Row label="الوقت:" value={fmtTime(props.createdAt)} />
        <Row label="نوع الفاتورة:" value={paymentLabel(props.paymentType)} />
        {props.paymentType === "credit" && props.dueDate && (
          <Row label="تستحق:" value={fmtDate(props.dueDate)} />
        )}
        {props.cashier && <Row label={`${cashierLabel}:`} value={props.cashier} />}
        {props.partyName && <Row label={`${partyLabel}:`} value={props.partyName} />}
        {props.notes && <Row label="ملاحظات:" value={props.notes} />}
      </div>

      <div className="tr-sep" />

      {/* Items table */}
      <table className="tr-items">
        <colgroup>
          <col style={{ width: "44%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "23%" }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: "right" }}>اسم الصنف</th>
            <th style={{ textAlign: "center" }}>كمية</th>
            <th style={{ textAlign: "center" }}>سعر الوحدة</th>
            <th style={{ textAlign: "center" }}>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((it, i) => (
            <tr key={i}>
              <td className="tr-name">{it.name}</td>
              <td className="tr-num">{it.qty}</td>
              <td className="tr-num">{fmt2(it.unit_price)}</td>
              <td className="tr-num">{fmt2(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="tr-sep" />

      {/* Totals */}
      <div className="tr-totals">
        <Row label="الإجمالي:" value={`${fmt2(props.subtotal)} ج.م`} />
        {discount > 0 && <Row label="الخصم:" value={`- ${fmt2(discount)} ج.م`} />}
        {vatEnabled && vatAmount > 0 && (
          <Row label={`ضريبة القيمة المضافة (${vatRate}%):`} value={`+ ${fmt2(vatAmount)} ج.م`} />
        )}
        <div className="tr-required">
          <span>المطلوب:</span>
          <span>{fmt2(props.total + vatAmount)} ج.م</span>
        </div>
        {typeof props.paid === "number" && <Row label="المدفوع:" value={`${fmt2(props.paid)} ج.م`} />}
        {typeof props.previousBalance === "number" && (
          <Row label="الرصيد السابق:" value={`${fmt2(props.previousBalance)} ج.م`} />
        )}
        {typeof props.currentBalance === "number" && (
          <Row label="الرصيد الحالي:" value={`${fmt2(props.currentBalance)} ج.م`} />
        )}
        {remaining > 0 && <Row label="المتبقي:" value={`${fmt2(remaining)} ج.م`} />}
      </div>

      {props.paymentMethodLabel && (
        <div className="tr-pay-method">طريقة الدفع: {props.paymentMethodLabel}</div>
      )}

      <div className="tr-sep" />
      <div className="tr-footer">
        <div className="tr-thanks">شكراً لزيارتكم</div>
        {phone && <div>ت: {phone}</div>}
        {footerNote && <div>{footerNote}</div>}
        {props.kind === "sale" && (
          <>
            <div className="tr-policy">سياسة الاسترجاع (خلال 14 يوم ضد عيوب الصناعة)</div>
            <div className="tr-policy">إذا كان المنتج (ثلاجة أو ديب فريزر) يجب تشغيلها خلال 8 ساعات</div>
          </>
        )}
      </div>
      <div className="tr-sep" />
    </div>
  );
}

/** Inject @page 80mm before printing, then trigger window.print(). */
export function printThermalInvoice() {
  const id = "__thermal_page_style__";
  document.getElementById(id)?.remove();
  const style = document.createElement("style");
  style.id = id;
  style.textContent = "@media print { @page { size: 80mm auto !important; margin: 0 !important; } }";
  document.head.appendChild(style);
  const cleanup = () => { document.getElementById(id)?.remove(); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 50);
}
