import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Convert a DOM element to a multi-page A4 PDF (RTL Arabic safe — rendered as image).
 * Adds a footer to each page: page number + session id + generation timestamp.
 */
export async function exportElementToPdf(
  el: HTMLElement,
  opts: { filename: string; sessionId: string }
) {
  (await elementToPdf(el)).save(opts.filename);
}

/**
 * The same A4 rendering as an object, for callers that upload it (the WhatsApp PDF link, 0278). `skip` leaves out
 * elements such as on-screen badges / buttons (`.no-print`).
 */
export async function elementToPdf(el: HTMLElement, skip?: (node: Element) => boolean): Promise<jsPDF> {
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    ignoreElements: skip,
    // parts written only for the PDF (e.g. the purchase invoice's number line) are hidden on screen
    onclone: (doc) => doc.querySelectorAll<HTMLElement>("[data-pdf-only]").forEach((n) => { n.classList.remove("hidden"); n.style.display = "block"; }),
  });

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const footerH = 24;
  const usableH = pageH - margin * 2 - footerH;

  const imgW = pageW - margin * 2;
  const ratio = canvas.width / imgW;
  const pageCanvasH = usableH * ratio;

  const totalPages = Math.ceil(canvas.height / pageCanvasH);
  const ts = new Date().toLocaleString("ar-EG");

  for (let i = 0; i < totalPages; i++) {
    if (i > 0) pdf.addPage();
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = Math.min(pageCanvasH, canvas.height - i * pageCanvasH);
    const ctx = sliceCanvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(
      canvas,
      0,
      i * pageCanvasH,
      canvas.width,
      sliceCanvas.height,
      0,
      0,
      canvas.width,
      sliceCanvas.height
    );
    const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
    const imgH = sliceCanvas.height / ratio;
    pdf.addImage(imgData, "JPEG", margin, margin, imgW, imgH);
    // Footer removed intentionally — jsPDF cannot shape Arabic text and produced garbled output.
  }
  return pdf;
}
