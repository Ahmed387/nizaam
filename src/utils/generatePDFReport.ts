/**
 * Shared PDF report generator (RTL Arabic) — elegant card-style layout.
 * Renders a hidden HTML report to a multi-page A4 (portrait) PDF via html2canvas + jsPDF.
 */
import jsPDF from "jspdf";
import { toCanvas as htiToCanvas } from "html-to-image";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ---------- theme ----------
const C = {
  ink: "#0f2c3f",        // deep navy for headings
  text: "#1f3a4d",       // body text
  muted: "#6b7a86",      // secondary labels
  border: "#e2e8ee",     // hairline
  accent: "#0f766e",     // teal accent (bar + highlighted values)
  accentSoft: "#e6f4f1", // teal soft bg
  good: "#0f766e",       // profit/paid
  warn: "#c2410c",       // remaining
  bad: "#b91c1c",        // cancelled/loss
  cardBg: "#ffffff",
  softBg: "#f8fafc",
  pill: "#eef7f5",
};

// ---------- Arabic font loader ----------
// html2canvas rasterizes DOM using whatever font the browser actually has available.
// Default system fallbacks often lack proper Arabic ligature/shaping tables, which
// produces the "disconnected letters" look. We inject Cairo from Google Fonts once
// and wait for it to load before rendering.
let __arabicFontPromise: Promise<void> | null = null;
async function fetchAsDataUrl(url: string, mime: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    let binary = ""; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${mime};base64,${btoa(binary)}`;
  } catch { return null; }
}
function ensureArabicFont(): Promise<void> {
  if (__arabicFontPromise) return __arabicFontPromise;
  __arabicFontPromise = (async () => {
    if (document.querySelector('style[data-arabic-font="cairo-inline"]')) return;
    // Use a stable Google Fonts mirror on jsdelivr — TTF files with full Arabic shaping.
    // Base64-inlined so html2canvas sees a self-contained font (no async network fetch during raster).
    const base = "https://cdn.jsdelivr.net/gh/google/fonts/ofl/cairo/static";
    const files: { weight: number; file: string }[] = [
      { weight: 400, file: "Cairo-Regular.ttf" },
      { weight: 600, file: "Cairo-SemiBold.ttf" },
      { weight: 700, file: "Cairo-Bold.ttf" },
      { weight: 800, file: "Cairo-ExtraBold.ttf" },
    ];
    const results = await Promise.all(
      files.map((f) => fetchAsDataUrl(`${base}/${f.file}`, "font/ttf").then((u) => ({ ...f, url: u })))
    );
    const faces = results
      .filter((r) => r.url)
      .map((r) => `@font-face{font-family:'CairoPDF';font-style:normal;font-weight:${r.weight};font-display:block;src:url(${r.url}) format('truetype');}`)
      .join("\n");
    if (!faces) return; // network failure — will fall back to system fonts
    const style = document.createElement("style");
    style.setAttribute("data-arabic-font", "cairo-inline");
    style.textContent = faces;
    document.head.appendChild(style);
    const fonts: any = (document as any).fonts;
    if (fonts?.load) {
      try {
        await Promise.all([
          fonts.load('400 14px "CairoPDF"'),
          fonts.load('700 14px "CairoPDF"'),
          fonts.load('800 22px "CairoPDF"'),
        ]);
        if (fonts.ready) await fonts.ready;
      } catch {}
    } else {
      await new Promise((r) => setTimeout(r, 800));
    }
  })();
  return __arabicFontPromise;
}

// ---------- helpers ----------
const fmtEGP = (n: number) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ج.م";
const fmtNum = (n: number) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtPct = (n: number) => (Number(n) || 0).toFixed(1) + "%";
const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear()}`;
};
const fmtDateTime = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return `${fmtDate(d)} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
};

const PAY_LABELS: Record<string, string> = {
  cash: "نقدي", transfer: "تحويل بنكي", card: "فيزا",
  wallet: "محفظة", instapay: "انستاباي", vodafone_cash: "فودافون كاش",
  bank_transfer: "تحويل بنكي", credit: "آجل", balance: "خصم من الرصيد",
};

// ---------- header ----------
function headerHtml(opts: {
  title: string; branchName: string; userName: string;
  fromDate?: string; toDate?: string;
}) {
  const period =
    opts.fromDate || opts.toDate
      ? `من ${opts.fromDate ? fmtDate(opts.fromDate) : "البداية"} إلى ${opts.toDate ? fmtDate(opts.toDate) : "اليوم"}`
      : "جميع الفترات المتاحة";
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:14px;border-bottom:1px solid ${C.border};margin-bottom:22px;">
      <div style="font-size:11px;color:${C.muted};line-height:2;text-align:right;min-width:220px;">
        <div><b style="color:${C.text};">تاريخ التقرير:</b> ${fmtDateTime(new Date().toISOString())}</div>
        <div><b style="color:${C.text};">المستخدم:</b> ${opts.userName}</div>
        <div><b style="color:${C.text};">الفترة:</b> ${period}</div>
      </div>
      <div style="text-align:left;flex:1;">
        <div style="font-size:24px;font-weight:800;color:${C.ink};letter-spacing:-0.3px;">${opts.title}</div>
        <div style="font-size:13px;color:${C.accent};margin-top:6px;font-weight:600;">${opts.branchName}</div>
      </div>
    </div>
  `;
}

// section title — centered, prominent, with accent underline
function sectionTitle(text: string) {
  return `
    <div style="text-align:center;margin:16px 0 18px;padding:12px 0;border-top:1px solid ${C.border};border-bottom:1px solid ${C.border};background:${C.softBg};">
      <div style="font-size:20px;font-weight:800;color:${C.ink};letter-spacing:-0.2px;">${text}</div>
      <div style="width:90px;height:3px;background:${C.accent};border-radius:2px;margin:8px auto 0;"></div>
    </div>
  `;
}

// ---------- KPI cards ----------
type Card = { label: string; value: string; highlight?: boolean; color?: string };
function kpiCardsHtml(cards: Card[]) {
  return `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:26px;">
      ${cards
        .map((c) => {
          const bg = c.highlight ? C.accentSoft : C.softBg;
          const border = c.highlight ? C.accent : C.border;
          const valColor = c.color ?? (c.highlight ? C.accent : C.ink);
          return `
            <div style="border:1px solid ${border};background:${bg};border-radius:10px;padding:18px 14px;min-height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
              <div style="font-size:12px;color:${C.muted};margin-bottom:10px;font-weight:600;line-height:1.3;">${c.label}</div>
              <div style="font-size:19px;font-weight:800;color:${valColor};line-height:1.2;direction:ltr;unicode-bidi:isolate;">${c.value}</div>
            </div>`;
        })
        .join("")}
    </div>
  `;
}

// ---------- invoice card ----------
function invoiceCardHtml(r: {
  inv: any; items: any[]; paid: number; remaining: number; profit: number | null;
}) {
  const cancelled = r.inv.status === "cancelled";
  const payLabel = PAY_LABELS[r.inv.payment_method] ?? r.inv.payment_method ?? "—";
  const payColor = r.inv.payment_method === "credit" ? C.warn : C.accent;

  const headerCell = (label: string, value: string, valueColor = C.ink) => `
    <div style="display:flex;gap:6px;align-items:baseline;">
      <span style="color:${C.muted};font-size:11px;">${label}:</span>
      <span style="color:${valueColor};font-size:12px;font-weight:700;">${value}</span>
    </div>`;

  const payPill = `<span style="background:${C.pill};color:${payColor};font-weight:700;font-size:11px;padding:2px 10px;border-radius:10px;">${payLabel}</span>`;

  const itemsRows = r.items.map((it) => {
    const q = Number(it.quantity || 0);
    const up = Number(it.selling_price || 0);
    const tot = Number(it.total || 0);
    const uc = Number(it.unit_cost_at_sale || it.cost_price || 0);
    const lineCost = uc * q;
    const noCost = r.inv.is_migrated && uc === 0;
    const lineProfit = noCost ? null : tot - lineCost;
    const lpColor = lineProfit === null ? C.muted : lineProfit >= 0 ? C.good : C.bad;
    return `
      <tr>
        <td style="padding:10px 12px;border-top:1px solid ${C.border};text-align:right;font-size:11px;color:${C.text};">${it.product_name ?? "—"}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(q)}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(up)}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};font-weight:700;white-space:nowrap;">${fmtNum(tot)}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.muted};white-space:nowrap;">${noCost ? "—" : fmtNum(lineCost)}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${lpColor};font-weight:700;white-space:nowrap;">${lineProfit === null ? "—" : fmtNum(lineProfit)}</td>
      </tr>
    `;
  }).join("");

  const totalQty = r.items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  const totalRow = `
    <tr style="background:${C.softBg};">
      <td style="padding:11px 12px;border-top:2px solid ${C.ink};text-align:right;font-size:12px;font-weight:800;color:${C.ink};">إجمالي الفاتورة</td>
      <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};">${fmtNum(totalQty)}</td>
      <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;color:${C.muted};">-</td>
      <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};white-space:nowrap;">${fmtNum(Number(r.inv.total || 0))}</td>
      <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};white-space:nowrap;">${fmtNum(r.items.reduce((s, it) => s + Number(it.unit_cost_at_sale || it.cost_price || 0) * Number(it.quantity || 0), 0))}</td>
      <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${r.profit === null ? C.muted : r.profit >= 0 ? C.good : C.bad};white-space:nowrap;">${r.profit === null ? "—" : fmtNum(r.profit)}</td>
    </tr>
  `;

  return `
    <div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin-bottom:18px;background:${C.cardBg};${cancelled ? "opacity:0.75;" : ""}page-break-inside:avoid;">
      <div style="padding:14px 18px;background:${C.softBg};border-bottom:1px solid ${C.border};display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 20px;">
        ${headerCell("رقم الفاتورة", r.inv.invoice_number ?? "—", C.ink)}
        ${headerCell("العميل", r.inv.contacts?.name ?? "عميل نقدي")}
        <div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;">
          <span style="color:${C.muted};font-size:11px;">التاريخ:</span>
          <span style="color:${C.ink};font-size:12px;font-weight:700;">${fmtDate(r.inv.invoice_date || r.inv.created_at)}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="color:${C.muted};font-size:11px;">طريقة الدفع:</span>
          ${payPill}
          ${cancelled ? `<span style="background:#fee2e2;color:${C.bad};font-weight:700;font-size:11px;padding:2px 10px;border-radius:10px;">ملغاة</span>` : ""}
        </div>
        ${headerCell("المدفوع", fmtEGP(r.paid), C.good)}
        ${headerCell("المتبقي", fmtEGP(r.remaining), r.remaining > 0 ? C.warn : C.good)}
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:${C.ink};">
            <th style="padding:11px 12px;text-align:right;color:#ffffff;font-size:11px;font-weight:700;">اسم الصنف</th>
            <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:60px;">الكمية</th>
            <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:100px;">سعر الوحدة</th>
            <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:100px;">الإجمالي</th>
            <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:90px;">التكلفة</th>
            <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:90px;">صافي الربح</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows || `<tr><td colspan="6" style="padding:16px;text-align:center;color:${C.muted};font-size:11px;">لا توجد أصناف</td></tr>`}
          ${totalRow}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- sales report ----------
export type SalesReportInput = {
  branchId: string;
  branchName: string;
  invoices: any[];
  filters: { from?: string; to?: string };
  userName: string;
};

export async function generateSalesReport(input: SalesReportInput): Promise<void> {
  const t1 = toast.loading("⏳ جاري تحضير البيانات...");
  try {
    const invIds = input.invoices.map((r) => r.id);
    const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    const [itemBatches, paymentBatches] = await Promise.all([
      Promise.all(chunk(invIds, 100).map((ids) => supabase.from("invoice_items").select("*").in("invoice_id", ids))),
      Promise.all(chunk(invIds, 100).map((ids) => supabase.from("invoice_payments").select("invoice_id, amount, payment_method").in("invoice_id", ids))),
    ]);
    const allItems: any[] = itemBatches.flatMap((r) => r.data ?? []);
    const allPayments: any[] = paymentBatches.flatMap((r) => r.data ?? []);
    const itemsByInv = new Map<string, any[]>();
    allItems.forEach((it) => {
      const arr = itemsByInv.get(it.invoice_id) ?? [];
      arr.push(it); itemsByInv.set(it.invoice_id, arr);
    });
    const paidByInv = new Map<string, number>();
    allPayments.forEach((p) => {
      paidByInv.set(p.invoice_id, (paidByInv.get(p.invoice_id) ?? 0) + Number(p.amount || 0));
    });

    toast.dismiss(t1);
    const t2 = toast.loading("📄 جاري إنشاء ملف PDF...");

    // Totals
    let totalSales = 0, totalPaid = 0, totalRemaining = 0, totalProfit = 0, totalCost = 0;
    let hasAnyCostData = false;
    const invRows = input.invoices.map((inv) => {
      const items = itemsByInv.get(inv.id) ?? [];
      const paid = paidByInv.get(inv.id) ?? 0;
      const total = Number(inv.total || 0);
      const remaining = Math.max(0, total - paid);
      let cost = 0; let hasCost = false;
      items.forEach((it) => {
        const uc = Number(it.unit_cost_at_sale || it.cost_price || 0);
        if (uc > 0) hasCost = true;
        cost += uc * Number(it.quantity || 0);
      });
      const isMigratedNoCost = inv.is_migrated && !hasCost;
      const profit = isMigratedNoCost ? null : total - cost;
      if (profit !== null) { totalProfit += profit; totalCost += cost; hasAnyCostData = true; }
      if (inv.status !== "cancelled") {
        totalSales += total; totalPaid += paid; totalRemaining += remaining;
      }
      return { inv, items, paid, remaining, profit };
    });

    const marginPct = hasAnyCostData && totalSales > 0 ? (totalProfit / totalSales) * 100 : null;

    // Build HTML
    const header = headerHtml({
      title: "تقرير تفصيلي بالمبيعات والأرباح",
      branchName: input.branchName, userName: input.userName,
      fromDate: input.filters.from, toDate: input.filters.to,
    });

    const summary = sectionTitle("إجمالي الأداء المالي للفرع") + kpiCardsHtml([
      { label: "إجمالي المبيعات", value: fmtEGP(totalSales) },
      { label: "المحصّل النقدي", value: fmtEGP(totalPaid), highlight: true },
      { label: "إجمالي المتبقي (الآجل)", value: fmtEGP(totalRemaining), color: totalRemaining > 0 ? C.warn : C.good },
      { label: "إجمالي التكلفة", value: hasAnyCostData ? fmtEGP(totalCost) : "غير متاح" },
      { label: "صافي الأرباح", value: hasAnyCostData ? fmtEGP(totalProfit) : "غير متاح", color: hasAnyCostData ? (totalProfit >= 0 ? C.good : C.bad) : C.muted },
      { label: "هامش الربح الإجمالي", value: marginPct !== null ? fmtPct(marginPct) : "غير متاح", color: marginPct !== null ? (marginPct >= 0 ? C.good : C.bad) : C.muted },
    ]);

    const details = sectionTitle("تفاصيل الفواتير المحقّقة");

    // Ensure Arabic font (Cairo) is loaded so html2canvas renders proper glyph shaping.
    await ensureArabicFont();

    // Off-screen staging area — each top-level child is captured independently so we
    // never slice a card in half and every card stays crisp (rendered at scale 2).
    const container = document.createElement("div");
    container.style.cssText = `
      position:fixed;left:-99999px;top:0;width:794px;padding:36px 40px;
      background:#ffffff;color:${C.text};font-family:'CairoPDF','Cairo','Noto Naskh Arabic','Segoe UI','Tahoma',Arial,sans-serif;
      direction:rtl;text-align:right;box-sizing:border-box;
      font-feature-settings:"liga","calt","kern";text-rendering:optimizeLegibility;
    `;
    // Wrap each logical block so we can iterate as atomic sections.
    const emptyState = `<div style="text-align:center;padding:40px;color:${C.muted};font-size:12px;border:1px dashed ${C.border};border-radius:10px;">لا توجد فواتير في الفترة المحددة</div>`;
    const sectionsHtml = [
      `<div data-pdf-section="header">${header}</div>`,
      `<div data-pdf-section="summary">${summary}</div>`,
      `<div data-pdf-section="details-title">${details}</div>`,
      ...(invRows.length
        ? invRows.map((r) => `<div data-pdf-section="invoice" style="margin-bottom:14px;">${invoiceCardHtml(r)}</div>`)
        : [`<div data-pdf-section="empty">${emptyState}</div>`]),
    ].join("");
    container.innerHTML = sectionsHtml;
    document.body.appendChild(container);

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if ((document as any).fonts?.ready) { try { await (document as any).fonts.ready; } catch {} }

    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const footerH = 24;
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2 - footerH;
    let cursorY = margin;
    let pageIndex = 0;
    const pageMarkers: number[] = [];

    const addFooterMarker = () => { pageMarkers.push(pageIndex); };
    addFooterMarker();

    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-section]"));

    for (const section of sections) {
      // Render via html-to-image (SVG foreignObject) — preserves Arabic OpenType
      // shaping/ligatures that html2canvas's manual glyph layout breaks.
      const canvas = await htiToCanvas(section, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
      const drawW = usableW;
      const drawH = (canvas.height / canvas.width) * drawW;

      // If a single section is taller than a page, we have to slice it (fallback for
      // very long invoices). Otherwise, keep it atomic on a single page.
      if (drawH > usableH) {
        // Slice this oversized section into page-sized chunks.
        const ratio = canvas.width / drawW;
        const pageCanvasH = usableH * ratio;
        let offset = 0;
        while (offset < canvas.height) {
          if (cursorY > margin) { pdf.addPage(); pageIndex++; addFooterMarker(); cursorY = margin; }
          const sliceH = Math.min(pageCanvasH, canvas.height - offset);
          const slice = document.createElement("canvas");
          slice.width = canvas.width; slice.height = sliceH;
          const ctx = slice.getContext("2d")!;
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, slice.width, slice.height);
          ctx.drawImage(canvas, 0, offset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          const imgH = sliceH / ratio;
          pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, cursorY, drawW, imgH);
          cursorY += imgH;
          offset += sliceH;
          if (offset < canvas.height) { pdf.addPage(); pageIndex++; addFooterMarker(); cursorY = margin; }
        }
        continue;
      }

      // Page break if the section won't fit in remaining space.
      if (drawH > (pageH - margin - footerH) - cursorY && cursorY > margin) {
        pdf.addPage(); pageIndex++; addFooterMarker(); cursorY = margin;
      }
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, cursorY, drawW, drawH);
      cursorY += drawH + 4;
    }

    document.body.removeChild(container);

    // Draw footers on every page now that we know the total count.
    const totalPages = pdf.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      pdf.setPage(p);
      pdf.setDrawColor(226, 232, 238);
      pdf.setLineWidth(0.6);
      pdf.line(margin, pageH - footerH, pageW - margin, pageH - footerH);
      pdf.setFontSize(9);
      pdf.setTextColor(107, 122, 134);
      pdf.text(input.branchName, margin, pageH - 10);
      pdf.text(`صفحة ${p} من ${totalPages}`, pageW - margin, pageH - 10, { align: "right" });
    }


    const fromStr = input.filters.from || "الكل";
    const toStr = input.filters.to || "الكل";
    pdf.save(`تقرير-المبيعات-${input.branchName}-${fromStr}-${toStr}.pdf`);
    toast.dismiss(t2);
    toast.success("✅ تم إنشاء التقرير بنجاح");
  } catch (e: any) {
    console.error("[generateSalesReport]", e);
    toast.dismiss();
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  }
}

// ============================================================================
// ==========================  SHIPMENTS REPORT  ==============================
// ============================================================================

function shipmentCardHtml(r: {
  sh: any; items: any[]; paid: number; remaining: number;
}) {
  const total = Number(r.sh.total_cost || 0);
  const shipping = Number(r.sh.shipping_cost || 0);
  const admin = Number(r.sh.admin_cost || 0);
  const itemsSubtotal = r.items.reduce((s, it) => s + Number(it.total || Number(it.cost_price || 0) * Number(it.quantity || 0)), 0);

  const status = r.paid >= total - 0.01 && total > 0 ? "paid" : r.paid > 0 ? "partial" : "unpaid";
  const statusLabel = status === "paid" ? "مدفوعة بالكامل" : status === "partial" ? "مدفوعة جزئياً" : "غير مدفوعة";
  const statusColor = status === "paid" ? C.good : status === "partial" ? C.warn : C.bad;
  const statusBg = status === "paid" ? "#ecfdf5" : status === "partial" ? "#fff7ed" : "#fee2e2";

  const headerCell = (label: string, value: string, valueColor = C.ink) => `
    <div style="display:flex;gap:6px;align-items:baseline;">
      <span style="color:${C.muted};font-size:11px;">${label}:</span>
      <span style="color:${valueColor};font-size:12px;font-weight:700;">${value}</span>
    </div>`;

  const itemsRows = r.items.map((it) => {
    const q = Number(it.quantity || 0);
    const uc = Number(it.cost_price || 0);
    const tot = Number(it.total || uc * q);
    return `
      <tr>
        <td style="padding:10px 12px;border-top:1px solid ${C.border};text-align:right;font-size:11px;color:${C.text};">${it.product_name ?? "—"}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(q)}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(uc)}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};font-weight:700;white-space:nowrap;">${fmtNum(tot)}</td>
      </tr>
    `;
  }).join("");

  const totalQty = r.items.reduce((s, it) => s + Number(it.quantity || 0), 0);

  const totalsRows = `
    <tr style="background:${C.softBg};">
      <td style="padding:9px 12px;border-top:2px solid ${C.ink};text-align:right;font-size:11px;font-weight:700;color:${C.ink};">إجمالي الأصناف</td>
      <td style="padding:9px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:11px;font-weight:700;color:${C.ink};">${fmtNum(totalQty)}</td>
      <td style="padding:9px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:11px;color:${C.muted};">-</td>
      <td style="padding:9px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:11px;font-weight:700;color:${C.ink};white-space:nowrap;">${fmtNum(itemsSubtotal)}</td>
    </tr>
    <tr>
      <td colspan="3" style="padding:8px 12px;text-align:right;font-size:11px;color:${C.muted};">تكلفة الشحن</td>
      <td style="padding:8px 8px;text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(shipping)}</td>
    </tr>
    <tr>
      <td colspan="3" style="padding:8px 12px;text-align:right;font-size:11px;color:${C.muted};">مصاريف إدارية</td>
      <td style="padding:8px 8px;text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(admin)}</td>
    </tr>
    <tr style="background:${C.accentSoft};">
      <td colspan="3" style="padding:10px 12px;border-top:1px solid ${C.accent};text-align:right;font-size:12px;font-weight:800;color:${C.ink};">الإجمالي الكلي للشحنة</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.accent};text-align:center;font-size:12px;font-weight:800;color:${C.accent};white-space:nowrap;">${fmtNum(total)}</td>
    </tr>
  `;

  return `
    <div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin-bottom:18px;background:${C.cardBg};page-break-inside:avoid;">
      <div style="padding:14px 18px;background:${C.softBg};border-bottom:1px solid ${C.border};display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 20px;">
        ${headerCell("المورد", r.sh.contacts?.name ?? "—", C.ink)}
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="color:${C.muted};font-size:11px;">تاريخ الوصول:</span>
          <span style="color:${C.ink};font-size:12px;font-weight:700;">${fmtDate(r.sh.arrival_date)}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;">
          <span style="color:${C.muted};font-size:11px;">الحالة:</span>
          <span style="background:${statusBg};color:${statusColor};font-weight:700;font-size:11px;padding:2px 10px;border-radius:10px;">${statusLabel}</span>
        </div>
        ${headerCell("المستلم", r.sh.received_by ?? "—")}
        ${headerCell("المدفوع", fmtEGP(r.paid), C.good)}
        ${headerCell("المتبقي", fmtEGP(r.remaining), r.remaining > 0 ? C.warn : C.good)}
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:${C.ink};">
            <th style="padding:11px 12px;text-align:right;color:#ffffff;font-size:11px;font-weight:700;">اسم الصنف</th>
            <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:80px;">الكمية</th>
            <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:110px;">سعر التكلفة</th>
            <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:110px;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows || `<tr><td colspan="4" style="padding:16px;text-align:center;color:${C.muted};font-size:11px;">لا توجد أصناف</td></tr>`}
          ${totalsRows}
        </tbody>
      </table>
      ${r.sh.notes ? `<div style="padding:10px 16px;border-top:1px solid ${C.border};background:#fafbfc;font-size:11px;color:${C.muted};"><b style="color:${C.text};">ملاحظات:</b> ${r.sh.notes}</div>` : ""}
    </div>
  `;
}

export type ShipmentsReportInput = {
  branchId: string;
  branchName: string;
  shipments: any[]; // enriched rows (with _paid_amount, contacts)
  filters: { from?: string; to?: string };
  userName: string;
};

export async function generateShipmentsReport(input: ShipmentsReportInput): Promise<void> {
  const t1 = toast.loading("⏳ جاري تحضير البيانات...");
  try {
    const shIds = input.shipments.map((r) => r.id);
    const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    const itemBatches = shIds.length
      ? await Promise.all(chunk(shIds, 100).map((ids) => supabase.from("shipment_items").select("*").in("shipment_id", ids)))
      : [];
    const allItems: any[] = itemBatches.flatMap((r) => r.data ?? []);
    const itemsBySh = new Map<string, any[]>();
    allItems.forEach((it) => {
      const arr = itemsBySh.get(it.shipment_id) ?? [];
      arr.push(it); itemsBySh.set(it.shipment_id, arr);
    });

    toast.dismiss(t1);
    const t2 = toast.loading("📄 جاري إنشاء ملف PDF...");

    let totalCost = 0, totalShipping = 0, totalAdmin = 0, totalPaid = 0, totalRemaining = 0, totalItemsCount = 0;
    const rows = input.shipments.map((sh) => {
      const items = itemsBySh.get(sh.id) ?? [];
      const total = Number(sh.total_cost || 0);
      const paid = Number(sh._paid_amount ?? 0);
      const remaining = Math.max(0, total - paid);
      totalCost += total;
      totalShipping += Number(sh.shipping_cost || 0);
      totalAdmin += Number(sh.admin_cost || 0);
      totalPaid += paid;
      totalRemaining += remaining;
      totalItemsCount += items.reduce((s, it) => s + Number(it.quantity || 0), 0);
      return { sh, items, paid, remaining };
    });

    const header = headerHtml({
      title: "تقرير تفصيلي بالشحنات",
      branchName: input.branchName, userName: input.userName,
      fromDate: input.filters.from, toDate: input.filters.to,
    });

    const summary = sectionTitle("ملخص الشحنات والمشتريات") + kpiCardsHtml([
      { label: "عدد الشحنات", value: fmtNum(input.shipments.length) },
      { label: "إجمالي تكلفة المشتريات", value: fmtEGP(totalCost), highlight: true },
      { label: "إجمالي عدد الأصناف", value: fmtNum(totalItemsCount) },
      { label: "تكاليف الشحن", value: fmtEGP(totalShipping) },
      { label: "المصاريف الإدارية", value: fmtEGP(totalAdmin) },
      { label: "المدفوع للموردين", value: fmtEGP(totalPaid), color: C.good },
      { label: "المتبقي على الموردين (آجل)", value: fmtEGP(totalRemaining), color: totalRemaining > 0 ? C.warn : C.good },
      { label: "متوسط قيمة الشحنة", value: input.shipments.length ? fmtEGP(totalCost / input.shipments.length) : fmtEGP(0) },
      { label: "نسبة السداد", value: totalCost > 0 ? fmtPct((totalPaid / totalCost) * 100) : "—", color: C.accent },
    ]);

    const details = sectionTitle("تفاصيل الشحنات");

    await ensureArabicFont();

    const container = document.createElement("div");
    container.style.cssText = `
      position:fixed;left:-99999px;top:0;width:794px;padding:36px 40px;
      background:#ffffff;color:${C.text};font-family:'CairoPDF','Cairo','Noto Naskh Arabic','Segoe UI','Tahoma',Arial,sans-serif;
      direction:rtl;text-align:right;box-sizing:border-box;
      font-feature-settings:"liga","calt","kern";text-rendering:optimizeLegibility;
    `;
    const emptyState = `<div style="text-align:center;padding:40px;color:${C.muted};font-size:12px;border:1px dashed ${C.border};border-radius:10px;">لا توجد شحنات في الفترة المحددة</div>`;
    container.innerHTML = [
      `<div data-pdf-section="header">${header}</div>`,
      `<div data-pdf-section="summary">${summary}</div>`,
      `<div data-pdf-section="details-title">${details}</div>`,
      ...(rows.length
        ? rows.map((r) => `<div data-pdf-section="shipment" style="margin-bottom:14px;">${shipmentCardHtml(r)}</div>`)
        : [`<div data-pdf-section="empty">${emptyState}</div>`]),
    ].join("");
    document.body.appendChild(container);

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if ((document as any).fonts?.ready) { try { await (document as any).fonts.ready; } catch {} }

    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const footerH = 24;
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2 - footerH;
    let cursorY = margin;

    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-section]"));
    for (const section of sections) {
      const canvas = await htiToCanvas(section, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
      const drawW = usableW;
      const drawH = (canvas.height / canvas.width) * drawW;

      if (drawH > usableH) {
        const ratio = canvas.width / drawW;
        const pageCanvasH = usableH * ratio;
        let offset = 0;
        while (offset < canvas.height) {
          if (cursorY > margin) { pdf.addPage(); cursorY = margin; }
          const sliceH = Math.min(pageCanvasH, canvas.height - offset);
          const slice = document.createElement("canvas");
          slice.width = canvas.width; slice.height = sliceH;
          const ctx = slice.getContext("2d")!;
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, slice.width, slice.height);
          ctx.drawImage(canvas, 0, offset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          const imgH = sliceH / ratio;
          pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, cursorY, drawW, imgH);
          cursorY += imgH;
          offset += sliceH;
          if (offset < canvas.height) { pdf.addPage(); cursorY = margin; }
        }
        continue;
      }

      if (drawH > (pageH - margin - footerH) - cursorY && cursorY > margin) {
        pdf.addPage(); cursorY = margin;
      }
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, cursorY, drawW, drawH);
      cursorY += drawH + 4;
    }

    document.body.removeChild(container);

    const totalPages = pdf.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      pdf.setPage(p);
      pdf.setDrawColor(226, 232, 238);
      pdf.setLineWidth(0.6);
      pdf.line(margin, pageH - footerH, pageW - margin, pageH - footerH);
      pdf.setFontSize(9);
      pdf.setTextColor(107, 122, 134);
      pdf.text(input.branchName, margin, pageH - 10);
      pdf.text(`صفحة ${p} من ${totalPages}`, pageW - margin, pageH - 10, { align: "right" });
    }

    const fromStr = input.filters.from || "الكل";
    const toStr = input.filters.to || "الكل";
    pdf.save(`تقرير-الشحنات-${input.branchName}-${fromStr}-${toStr}.pdf`);
    toast.dismiss(t2);
    toast.success("✅ تم إنشاء التقرير بنجاح");
  } catch (e: any) {
    console.error("[generateShipmentsReport]", e);
    toast.dismiss();
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  }
}
