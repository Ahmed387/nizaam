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
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
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

    // Footer
    pdf.setFontSize(9);
    pdf.setTextColor(100);
    const footer = `Page ${i + 1} / ${totalPages}  |  Session: ${opts.sessionId.slice(0, 8)}  |  ${ts}`;
    pdf.text(footer, pageW / 2, pageH - 12, { align: "center" });
  }

  pdf.save(opts.filename);
}
