import { supabase } from "@/integrations/supabase/client";

/**
 * «ابعت الفاتورة PDF على الواتساب» (migration 0278, owner 2026-11-19 «لينك للـ PDF في الرسالة بس»): the document on
 * screen is turned into an A4 PDF, saved in the private bucket `shared-docs` as ONE file per document
 * (<tenant>/<kind>-<id>.pdf, replaced on every send) and the message carries a signed link valid 7 days.
 * The PDF is the PRINTED invoice (owner 2026-11-19 «نفس الفاتورة اللي بتتطبع بس بصيغة pdf»): the 80mm receipt
 * (#invoice-print-area) laid out with the printer's own rules, one page as long as the receipt.
 */
export const SHARED_DOCS_BUCKET = "shared-docs";
export const LINK_DAYS = 7;

export function sharedDocPath(tenantId: string, kind: string, docId: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "");
  return `${safe(tenantId)}/${safe(kind)}-${safe(docId)}.pdf`;
}

/** The WhatsApp text with the PDF link under it. */
export function withPdfLink(text: string, url: string, label = "الفاتورة"): string {
  return `${text.trimEnd()}\n\n📄 ${label} PDF:\n${url}\n(اللينك شغال ${LINK_DAYS} أيام)`;
}

/**
 * The 80mm receipt as a PDF: a visible copy off screen with the printer's rules, photographed by the BROWSER's own
 * layout (html-to-image draws the DOM through an SVG, so Arabic shaping, fonts and table borders are exactly the
 * printed ones — html2canvas laid them out itself and misplaced lines), one page as long as the receipt.
 */
export async function receiptPdf(receipt: HTMLElement): Promise<Blob> {
  const [{ toCanvas }, { default: jsPDF }, { THERMAL_RECEIPT_CSS }] = await Promise.all([
    import("html-to-image"), import("jspdf"), import("@/components/ThermalReceiptPrint")]);
  const host = document.createElement("div");
  host.className = "tr-pdf-host";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:0;top:0;width:80mm;background:#fff;padding:3mm 0;z-index:-1;pointer-events:none;";
  const style = document.createElement("style");
  style.textContent = THERMAL_RECEIPT_CSS.replace(/#invoice-print-area/g, ".tr-pdf-host #invoice-print-area");
  host.appendChild(style);
  host.appendChild(receipt.cloneNode(true));
  document.body.appendChild(host);
  try {
    await (document as any).fonts?.ready;
    await Promise.all(Array.from(host.querySelectorAll("img")).map((img) =>
      img.complete ? null : new Promise((r) => { img.onload = img.onerror = () => r(null); })));
    // a logo that cannot be fetched becomes a blank pixel instead of failing the whole PDF
    const canvas = await toCanvas(host, { pixelRatio: 3, backgroundColor: "#ffffff", cacheBust: true,
      imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" });
    const wMm = 80;
    const hMm = Math.max(60, (canvas.height / canvas.width) * wMm);
    const pdf = new jsPDF({ unit: "mm", format: [wMm, hMm], orientation: "portrait" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, wMm, hMm);
    return pdf.output("blob");
  } finally {
    host.remove();
  }
}

/** Builds the PDF of the printed receipt, uploads it and returns the signed link. Throws an Arabic message when it fails. */
export async function pdfLinkFor(el: HTMLElement, tenantId: string, kind: string, docId: string): Promise<string> {
  const blob = await receiptPdf(el);
  const path = sharedDocPath(tenantId, kind, docId);
  const up = await supabase.storage.from(SHARED_DOCS_BUCKET).upload(path, blob, { upsert: true, contentType: "application/pdf" });
  if (up.error) throw new Error(`ما قدرتش أرفع الـ PDF: ${up.error.message}`);
  const { data, error } = await supabase.storage.from(SHARED_DOCS_BUCKET).createSignedUrl(path, LINK_DAYS * 24 * 3600);
  if (error || !data?.signedUrl) throw new Error(`ما قدرتش أعمل لينك الـ PDF: ${error?.message ?? ""}`);
  return data.signedUrl;
}
