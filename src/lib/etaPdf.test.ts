import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { readFileSync } from "fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { base64ToBytes, chunk, etaBundleName, etaPdfName, fetchEtaPdfs, mergePdfs, uniqueNames, zipPdfs, type EtaPdfDoc } from "./etaPdf";

const doc = (n: number, o: Partial<EtaPdfDoc> = {}): EtaPdfDoc =>
  ({ id: `d${n}`, eta_uuid: `UUIDXXXXXX${String(n).padStart(4, "0")}`, internal_id: `INV-${n}`, type_name: "I", issuer_name: "شركة فريش للأجهزة", date_issued: "2026-11-03T10:00:00Z", ...o });

async function pdfOf(pages: number): Promise<Uint8Array> {
  const p = await PDFDocument.create();
  for (let i = 0; i < pages; i++) p.addPage([200, 200]);
  return p.save();
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("e-invoice PDF: names", () => {
  it("type · day · supplier · its number", () => {
    expect(etaPdfName(doc(1))).toBe("فاتورة 2026-11-03 شركة فريش للأجهزة INV-1.pdf");
    expect(etaPdfName(doc(2, { type_name: "C", internal_id: null }))).toBe(`إشعار دائن 2026-11-03 شركة فريش للأجهزة UUIDXXXXXX0002.pdf`);
  });
  it("letters a file name can't hold are removed", () => {
    expect(etaPdfName(doc(3, { internal_id: "A/B:C*?", issuer_name: 'x"y<z>' }))).toBe("فاتورة 2026-11-03 x y z A B C.pdf");
  });
  it("two files with one name inside a ZIP get (2)", () => {
    expect(uniqueNames(["a.pdf", "b.pdf", "A.pdf", "a.pdf"])).toEqual(["a.pdf", "b.pdf", "A (2).pdf", "a (3).pdf"]);
  });
  it("bundle name", () => expect(etaBundleName(12, "2026-11-27", "zip")).toBe("فواتير إلكترونية 12 فاتورة 2026-11-27.zip"));
});

describe("e-invoice PDF: batches of 5", () => {
  it("chunk", () => expect(chunk([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([[1, 2, 3, 4, 5], [6, 7]]));
  it("base64 round trip", () => expect(Array.from(base64ToBytes(b64(new Uint8Array([37, 80, 68, 70]))))).toEqual([37, 80, 68, 70]));
});

describe("e-invoice PDF: fetching from the portal", () => {
  beforeEach(() => { invoke.mockReset(); });
  it("asks 5 at a time, keeps the order, and a failed invoice does not stop the rest", async () => {
    const one = await pdfOf(1);
    invoke.mockImplementation(async (...a: any[]) => { const body = a[1].body; return {
      data: { ok: true, files: body.uuids.map((u: string) => u.endsWith("0003") ? { uuid: u, ok: false, error: "المنظومة مش لاقية ملف الفاتورة دي" } : { uuid: u, ok: true, pdf: b64(one) }) },
      error: null,
    }; });
    const steps: string[] = [];
    const docs = [1, 2, 3, 4, 5, 6, 7].map((n) => doc(n));
    const res = await fetchEtaPdfs(docs, "ar", (d, t) => steps.push(`${d}/${t}`));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][1].body).toMatchObject({ mode: "pdf", lang: "ar" });
    expect(invoke.mock.calls[0][1].body.uuids).toHaveLength(5);
    expect(res.map((r) => r.doc.id)).toEqual(docs.map((d) => d.id));
    expect(res.filter((r) => r.bytes).length).toBe(6);
    expect(res[2].error).toContain("مش لاقية");
    expect(steps).toEqual(["0/7", "5/7", "7/7"]);
  });
  it("a whole call that failed marks its invoices with the reason", async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: "Client ID أو Client Secret غلط" }, error: null });
    const res = await fetchEtaPdfs([doc(1), doc(2)], "en");
    expect(res.every((r) => r.error?.includes("Client Secret"))).toBe(true);
    expect(invoke.mock.calls[0][1].body.lang).toBe("en");
  });
  it("cancel stops the next calls", async () => {
    const sig = { cancelled: false };
    invoke.mockImplementation(async (...a: any[]) => { const body = a[1].body; sig.cancelled = true; return { data: { ok: true, files: body.uuids.map((u: string) => ({ uuid: u, ok: false, error: "x" })) }, error: null }; });
    const res = await fetchEtaPdfs([1, 2, 3, 4, 5, 6].map((n) => doc(n)), "ar", undefined, sig);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(res[5].error).toBe("اتلغى");
  });
});

describe("e-invoice PDF: one file / one ZIP", () => {
  it("the portal's encrypted PDFs (RC4 128, empty password) merge readable — not garbage", async () => {
    const one = new Uint8Array(readFileSync("src/test/fixtures/eta-rc4-1page.pdf"));
    const three = new Uint8Array(readFileSync("src/test/fixtures/eta-rc4-3pages.pdf"));
    const merged = await mergePdfs([one, three]);
    const doc = await PDFDocument.load(merged);   // no password needed any more
    expect(doc.getPageCount()).toBe(4);
    expect(new TextDecoder("latin1").decode(merged)).not.toContain("/Encrypt");
    // every page's text is readable again: inflate the content streams and find the drawn words (hex-encoded)
    const { inflateSync } = await import("zlib");
    const { PDFRawStream } = await import("@cantoo/pdf-lib");
    let text = "";
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) { try { text += inflateSync(Buffer.from(obj.contents)).toString("latin1"); } catch { /* not flate */ } }
    }
    const hex = (w: string) => Buffer.from(w).toString("hex").toUpperCase();
    expect(text).toContain(hex("INVOICE 1"));
    expect(text).toContain(hex("PAGE 3"));
  });
  it("merge keeps every page of every invoice in order", async () => {
    const merged = await mergePdfs([await pdfOf(1), await pdfOf(2), await pdfOf(3)]);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(6);
  });
  it("ZIP holds each invoice under its name", async () => {
    const z = zipPdfs([{ doc: doc(1), bytes: await pdfOf(1) }, { doc: doc(1), bytes: await pdfOf(1) }]);
    const text = new TextDecoder().decode(z);
    expect(text).toContain("فاتورة 2026-11-03 شركة فريش للأجهزة INV-1.pdf");
    expect(text).toContain("INV-1 (2).pdf");
    expect(new DataView(z.buffer).getUint32(0, true)).toBe(0x04034b50);
  });
});
