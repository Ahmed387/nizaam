import { supabase } from "@/integrations/supabase/client";

/**
 * «ابعت الفاتورة PDF على الواتساب» (migration 0278, owner 2026-11-19 «لينك للـ PDF في الرسالة بس»): the document on
 * screen is turned into an A4 PDF, saved in the private bucket `shared-docs` as ONE file per document
 * (<tenant>/<kind>-<id>.pdf, replaced on every send) and the message carries a signed link valid 7 days.
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

/** Renders the element, uploads it and returns the signed link. Throws an Arabic message when it fails. */
export async function pdfLinkFor(el: HTMLElement, tenantId: string, kind: string, docId: string): Promise<string> {
  const { elementToPdf } = await import("@/lib/inventoryPdf");
  const pdf = await elementToPdf(el, (n) =>
    n.classList?.contains("no-print") || n.classList?.contains("print:hidden") || n.hasAttribute?.("data-pdf-skip"));
  const blob = pdf.output("blob");
  const path = sharedDocPath(tenantId, kind, docId);
  const up = await supabase.storage.from(SHARED_DOCS_BUCKET).upload(path, blob, { upsert: true, contentType: "application/pdf" });
  if (up.error) throw new Error(`ما قدرتش أرفع الـ PDF: ${up.error.message}`);
  const { data, error } = await supabase.storage.from(SHARED_DOCS_BUCKET).createSignedUrl(path, LINK_DAYS * 24 * 3600);
  if (error || !data?.signedUrl) throw new Error(`ما قدرتش أعمل لينك الـ PDF: ${error?.message ?? ""}`);
  return data.signedUrl;
}
