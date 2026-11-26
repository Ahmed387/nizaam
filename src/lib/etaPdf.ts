// «تحميل الفاتورة الإلكترونية PDF» (owner 2026-11-27 «عاوز اقدر احددها واجمعها في PDF واحد … او احدد اللي انا عاوزه
// وانزله مرة واحده … نفس ال PDF اللي علي المنصة»): the portal's own printout (eta-sync mode 'pdf' → GET
// documents/{uuid}/pdf), fetched 5 at a time, then ONE merged PDF, or every invoice its own file inside one ZIP.
// Nothing is stored and nothing is sent to the ETA.
import { supabase } from "@/integrations/supabase/client";
import { zipStore } from "@/lib/zipWrite";
import { etaTypeLabel, type EtaDoc } from "@/lib/etaInvoices";

export type EtaPdfLang = "ar" | "en";
export type EtaPdfDoc = Pick<EtaDoc, "id" | "eta_uuid" | "internal_id" | "type_name" | "issuer_name" | "date_issued">;
export type EtaPdfResult = { doc: EtaPdfDoc; bytes?: Uint8Array; error?: string };

export const ETA_PDF_BATCH = 5;

export function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();

/** «فاتورة 2026-11-03 فريش INV-123.pdf» — type, day, supplier (first 30 letters), its number (or the ETA id). */
export function etaPdfName(d: EtaPdfDoc): string {
  const parts = [
    etaTypeLabel(d.type_name),
    (d.date_issued ?? "").slice(0, 10),
    clean(d.issuer_name ?? "").slice(0, 30),
    clean(d.internal_id || d.eta_uuid),
  ].filter(Boolean);
  return `${clean(parts.join(" "))}.pdf`;
}

/** Names inside one ZIP must differ: a second «x.pdf» becomes «x (2).pdf». */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? n : n.replace(/\.pdf$/i, "") + ` (${c}).pdf`;
  });
}

/** Today's file name for a bundle: «فواتير إلكترونية 12 فاتورة 2026-11-27». */
export const etaBundleName = (count: number, day: string, ext: "pdf" | "zip") => `فواتير إلكترونية ${count} فاتورة ${day}.${ext}`;

/** Fetches the portal printouts, 5 per call, in the docs' order. A failed one carries its error; the rest go on. */
export async function fetchEtaPdfs(
  docs: EtaPdfDoc[], lang: EtaPdfLang, onProgress?: (done: number, total: number) => void, signal?: { cancelled: boolean },
): Promise<EtaPdfResult[]> {
  const out: EtaPdfResult[] = [];
  let done = 0;
  onProgress?.(0, docs.length);
  for (const part of chunk(docs, ETA_PDF_BATCH)) {
    if (signal?.cancelled) {
      for (const d of part) out.push({ doc: d, error: "اتلغى" });
      continue;
    }
    const { data, error } = await supabase.functions.invoke("eta-sync", { body: { mode: "pdf", uuids: part.map((d) => d.eta_uuid), lang } });
    const files: { uuid: string; ok: boolean; pdf?: string; error?: string }[] = (data as any)?.files ?? [];
    const whole = error ? (await errorText(error)) : (data as any)?.ok === false ? String((data as any)?.error ?? "") : "";
    for (const d of part) {
      const f = files.find((x) => x.uuid === d.eta_uuid);
      if (f?.ok && f.pdf) out.push({ doc: d, bytes: base64ToBytes(f.pdf) });
      else out.push({ doc: d, error: f?.error || whole || "المنظومة مردّتش" });
    }
    done += part.length;
    onProgress?.(done, docs.length);
  }
  return out;
}

async function errorText(e: any): Promise<string> {
  try {
    const body = await e?.context?.json?.();
    if (body?.error) return String(body.error);
  } catch { /* not JSON */ }
  return String(e?.message ?? "مش قادرين نوصل للسيرفر");
}

/**
 * One PDF with every page of every file, in order. The portal's PDFs are encrypted (RC4 128, empty open password, no
 * editing): plain pdf-lib copies their pages still encrypted and the merged file shows garbage, so the fork
 * @cantoo/pdf-lib opens each with the empty password (= decrypts) before copying. Loaded only when needed.
 */
export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("@cantoo/pdf-lib");
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(f, { password: "" });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out.save();
}

export function zipPdfs(results: { doc: EtaPdfDoc; bytes: Uint8Array }[]): Uint8Array {
  const names = uniqueNames(results.map((r) => etaPdfName(r.doc)));
  return zipStore(results.map((r, i) => ({ name: names[i], bytes: r.bytes })));
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const LANG_KEY = "eta_pdf_lang";
export function savedEtaPdfLang(): EtaPdfLang {
  try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "ar"; } catch { return "ar"; }
}
export function saveEtaPdfLang(l: EtaPdfLang) {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
}
