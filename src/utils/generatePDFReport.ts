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

    // Footer removed intentionally — jsPDF cannot shape Arabic text and produced garbled output.


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

    // Footer removed intentionally — jsPDF cannot shape Arabic text.

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

// ============================================================================
// ================== SHARED render pipeline (RTL, A4 portrait) ===============
// ============================================================================
async function renderSectionsToPdf(opts: {
  sectionsHtml: string;
  fileName: string;
  branchName: string;
}): Promise<void> {
  await ensureArabicFont();
  const container = document.createElement("div");
  container.style.cssText = `
    position:fixed;left:-99999px;top:0;width:794px;padding:36px 40px;
    background:#ffffff;color:${C.text};font-family:'CairoPDF','Cairo','Noto Naskh Arabic','Segoe UI','Tahoma',Arial,sans-serif;
    direction:rtl;text-align:right;box-sizing:border-box;
    font-feature-settings:"liga","calt","kern";text-rendering:optimizeLegibility;
  `;
  container.innerHTML = opts.sectionsHtml;
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

  // Footer removed intentionally — jsPDF cannot shape Arabic text.
  pdf.save(opts.fileName);
}

// small reusable pieces for return/transfer cards
function kv(label: string, value: string, color = C.ink) {
  return `<div style="display:flex;gap:6px;align-items:baseline;">
    <span style="color:${C.muted};font-size:11px;">${label}:</span>
    <span style="color:${color};font-size:12px;font-weight:700;">${value}</span>
  </div>`;
}
function pill(text: string, color: string, bg: string) {
  return `<span style="background:${bg};color:${color};font-weight:700;font-size:11px;padding:2px 10px;border-radius:10px;">${text}</span>`;
}

// ============================================================================
// ========================  SALE RETURNS REPORT  =============================
// ============================================================================

function saleReturnCardHtml(r: { ret: any; items: any[] }) {
  const cancelled = r.ret.status === "cancelled";
  const method = PAY_LABELS[r.ret.refund_method] ?? r.ret.refund_method ?? "—";
  const customer = r.ret.invoices?.contacts?.name ?? "عميل نقدي";
  const phone = r.ret.invoices?.contacts?.phone ?? "";
  const invNo = r.ret.invoices?.invoice_number ?? "—";
  const totalQty = r.items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  const total = Number(r.ret.total_refund || 0);

  const rows = r.items.map((it) => {
    const q = Number(it.quantity || 0);
    const tot = Number(it.refund || 0);
    const unit = q > 0 ? tot / q : 0;
    return `<tr>
      <td style="padding:10px 12px;border-top:1px solid ${C.border};text-align:right;font-size:11px;color:${C.text};">${it.products?.name ?? "—"}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.muted};white-space:nowrap;">${it.products?.sku ?? "—"}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(q)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(unit)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;font-weight:700;color:${C.warn};white-space:nowrap;">${fmtNum(tot)}</td>
    </tr>`;
  }).join("");

  return `
    <div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin-bottom:18px;background:${C.cardBg};${cancelled ? "opacity:0.75;" : ""}page-break-inside:avoid;">
      <div style="padding:14px 18px;background:${C.softBg};border-bottom:1px solid ${C.border};display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 20px;">
        ${kv("رقم المرتجع", r.ret.return_number ?? "—", C.ink)}
        ${kv("الفاتورة الأصلية", invNo)}
        ${kv("تاريخ المرتجع", fmtDate(r.ret.invoice_date || r.ret.created_at))}
        ${kv("العميل", customer)}
        ${kv("تليفون", phone || "—")}
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="color:${C.muted};font-size:11px;">طريقة الاسترداد:</span>
          ${pill(method, C.warn, "#fff7ed")}
          ${cancelled ? pill("ملغي", C.bad, "#fee2e2") : ""}
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:${C.ink};">
            <th style="padding:11px 12px;text-align:right;color:#fff;font-size:11px;font-weight:700;">اسم الصنف</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:100px;">الكود</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:80px;">الكمية</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:110px;">سعر الوحدة</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:120px;">قيمة الاسترداد</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="5" style="padding:16px;text-align:center;color:${C.muted};font-size:11px;">لا توجد أصناف</td></tr>`}
          <tr style="background:${C.accentSoft};">
            <td colspan="2" style="padding:11px 12px;border-top:2px solid ${C.ink};text-align:right;font-size:12px;font-weight:800;color:${C.ink};">إجمالي المرتجع</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};">${fmtNum(totalQty)}</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;color:${C.muted};">—</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.warn};white-space:nowrap;">${fmtNum(total)}</td>
          </tr>
        </tbody>
      </table>
      ${r.ret.reason ? `<div style="padding:10px 16px;border-top:1px solid ${C.border};background:#fafbfc;font-size:11px;color:${C.muted};"><b style="color:${C.text};">السبب:</b> ${r.ret.reason}</div>` : ""}
    </div>
  `;
}

export type SaleReturnsReportInput = {
  branchName: string;
  returns: any[];
  filters: { from?: string; to?: string };
  userName: string;
};
export async function generateSaleReturnsReport(input: SaleReturnsReportInput): Promise<void> {
  const t1 = toast.loading("⏳ جاري تحضير البيانات...");
  try {
    const ids = input.returns.map((r) => r.id);
    const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    const batches = ids.length
      ? await Promise.all(chunk(ids, 100).map((xs) => supabase.from("return_items").select("*, products(name, sku)").in("return_id", xs)))
      : [];
    const allItems: any[] = batches.flatMap((b) => b.data ?? []);
    const byRet = new Map<string, any[]>();
    allItems.forEach((it) => { const arr = byRet.get(it.return_id) ?? []; arr.push(it); byRet.set(it.return_id, arr); });
    toast.dismiss(t1);
    const t2 = toast.loading("📄 جاري إنشاء ملف PDF...");

    let totalRefund = 0, totalQty = 0, cancelledCount = 0;
    const rows = input.returns.map((ret) => {
      const items = byRet.get(ret.id) ?? [];
      if (ret.status !== "cancelled") totalRefund += Number(ret.total_refund || 0);
      else cancelledCount++;
      totalQty += items.reduce((s, it) => s + Number(it.quantity || 0), 0);
      return { ret, items };
    });

    const header = headerHtml({ title: "تقرير تفصيلي بمرتجعات البيع", branchName: input.branchName, userName: input.userName, fromDate: input.filters.from, toDate: input.filters.to });
    const summary = sectionTitle("ملخص مرتجعات البيع") + kpiCardsHtml([
      { label: "عدد المرتجعات", value: fmtNum(input.returns.length) },
      { label: "إجمالي قيمة الاسترداد", value: fmtEGP(totalRefund), highlight: true, color: C.warn },
      { label: "إجمالي الأصناف المرتجعة", value: fmtNum(totalQty) },
      { label: "متوسط قيمة المرتجع", value: input.returns.length ? fmtEGP(totalRefund / Math.max(1, input.returns.length - cancelledCount)) : fmtEGP(0) },
      { label: "مرتجعات نشطة", value: fmtNum(input.returns.length - cancelledCount), color: C.good },
      { label: "مرتجعات ملغاة", value: fmtNum(cancelledCount), color: cancelledCount > 0 ? C.bad : C.muted },
    ]);
    const details = sectionTitle("تفاصيل المرتجعات");
    const empty = `<div style="text-align:center;padding:40px;color:${C.muted};font-size:12px;border:1px dashed ${C.border};border-radius:10px;">لا توجد مرتجعات في الفترة المحددة</div>`;
    const html = [
      `<div data-pdf-section="header">${header}</div>`,
      `<div data-pdf-section="summary">${summary}</div>`,
      `<div data-pdf-section="details-title">${details}</div>`,
      ...(rows.length ? rows.map((r) => `<div data-pdf-section="return" style="margin-bottom:14px;">${saleReturnCardHtml(r)}</div>`) : [`<div data-pdf-section="empty">${empty}</div>`]),
    ].join("");

    await renderSectionsToPdf({ sectionsHtml: html, branchName: input.branchName, fileName: `تقرير-مرتجعات-البيع-${input.branchName}-${input.filters.from || "الكل"}-${input.filters.to || "الكل"}.pdf` });
    toast.dismiss(t2);
    toast.success("✅ تم إنشاء التقرير بنجاح");
  } catch (e: any) {
    console.error("[generateSaleReturnsReport]", e);
    toast.dismiss();
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  }
}

// ============================================================================
// =======================  PURCHASE RETURNS REPORT  ==========================
// ============================================================================

function purchaseReturnCardHtml(r: { ret: any; items: any[] }) {
  const cancelled = r.ret.status === "cancelled";
  const method = PAY_LABELS[r.ret.refund_method] ?? r.ret.refund_method ?? "—";
  const totalQty = r.items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  const total = Number(r.ret.total_amount || 0);

  const rows = r.items.map((it) => {
    const q = Number(it.quantity || 0);
    const uc = Number(it.unit_cost || 0);
    const tot = Number(it.total || uc * q);
    return `<tr>
      <td style="padding:10px 12px;border-top:1px solid ${C.border};text-align:right;font-size:11px;color:${C.text};">${it.product_name ?? "—"}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.muted};white-space:nowrap;">${it.products?.sku ?? "—"}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(q)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(uc)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;font-weight:700;color:${C.warn};white-space:nowrap;">${fmtNum(tot)}</td>
    </tr>`;
  }).join("");

  return `
    <div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin-bottom:18px;background:${C.cardBg};${cancelled ? "opacity:0.75;" : ""}page-break-inside:avoid;">
      <div style="padding:14px 18px;background:${C.softBg};border-bottom:1px solid ${C.border};display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 20px;">
        ${kv("رقم المرتجع", r.ret.return_number ?? "—", C.ink)}
        ${kv("المورد", r.ret.contacts?.name ?? "—")}
        ${kv("تاريخ المرتجع", fmtDate(r.ret.invoice_date || r.ret.created_at))}
        ${kv("الشحنة الأصلية", r.ret.shipments?.shipment_number ?? "—")}
        ${kv("تليفون المورد", r.ret.contacts?.phone ?? "—")}
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="color:${C.muted};font-size:11px;">طريقة الاسترداد:</span>
          ${pill(method, C.warn, "#fff7ed")}
          ${cancelled ? pill("ملغي", C.bad, "#fee2e2") : ""}
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:${C.ink};">
            <th style="padding:11px 12px;text-align:right;color:#fff;font-size:11px;font-weight:700;">اسم الصنف</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:100px;">الكود</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:80px;">الكمية</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:110px;">سعر التكلفة</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:120px;">قيمة الاسترداد</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="5" style="padding:16px;text-align:center;color:${C.muted};font-size:11px;">لا توجد أصناف</td></tr>`}
          <tr style="background:${C.accentSoft};">
            <td colspan="2" style="padding:11px 12px;border-top:2px solid ${C.ink};text-align:right;font-size:12px;font-weight:800;color:${C.ink};">إجمالي المرتجع</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};">${fmtNum(totalQty)}</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;color:${C.muted};">—</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.warn};white-space:nowrap;">${fmtNum(total)}</td>
          </tr>
        </tbody>
      </table>
      ${r.ret.reason ? `<div style="padding:10px 16px;border-top:1px solid ${C.border};background:#fafbfc;font-size:11px;color:${C.muted};"><b style="color:${C.text};">السبب:</b> ${r.ret.reason}</div>` : ""}
    </div>
  `;
}

export type PurchaseReturnsReportInput = {
  branchName: string;
  returns: any[];
  filters: { from?: string; to?: string };
  userName: string;
};
export async function generatePurchaseReturnsReport(input: PurchaseReturnsReportInput): Promise<void> {
  const t1 = toast.loading("⏳ جاري تحضير البيانات...");
  try {
    const ids = input.returns.map((r) => r.id);
    const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    const shipIds = Array.from(new Set(input.returns.map((r) => r.shipment_id).filter(Boolean)));
    const [itemBatches, shipmentsRes] = await Promise.all([
      ids.length ? Promise.all(chunk(ids, 100).map((xs) => supabase.from("purchase_return_items").select("*, products(sku)").in("purchase_return_id", xs))) : Promise.resolve([]),
      shipIds.length ? supabase.from("shipments").select("id, shipment_number").in("id", shipIds) : Promise.resolve({ data: [] } as any),
    ]);
    const allItems: any[] = (itemBatches as any[]).flatMap((b) => b.data ?? []);
    const byRet = new Map<string, any[]>();
    allItems.forEach((it) => { const arr = byRet.get(it.purchase_return_id) ?? []; arr.push(it); byRet.set(it.purchase_return_id, arr); });
    const shipMap = new Map<string, any>();
    ((shipmentsRes as any).data ?? []).forEach((s: any) => shipMap.set(s.id, s));

    toast.dismiss(t1);
    const t2 = toast.loading("📄 جاري إنشاء ملف PDF...");

    let totalAmount = 0, totalQty = 0, cancelledCount = 0;
    const rows = input.returns.map((ret) => {
      const items = byRet.get(ret.id) ?? [];
      if (ret.status !== "cancelled") totalAmount += Number(ret.total_amount || 0);
      else cancelledCount++;
      totalQty += items.reduce((s, it) => s + Number(it.quantity || 0), 0);
      const enriched = { ...ret, shipments: shipMap.get(ret.shipment_id) ?? ret.shipments };
      return { ret: enriched, items };
    });

    const header = headerHtml({ title: "تقرير تفصيلي بمرتجعات الشراء", branchName: input.branchName, userName: input.userName, fromDate: input.filters.from, toDate: input.filters.to });
    const summary = sectionTitle("ملخص مرتجعات الشراء") + kpiCardsHtml([
      { label: "عدد المرتجعات", value: fmtNum(input.returns.length) },
      { label: "إجمالي قيمة الاسترداد", value: fmtEGP(totalAmount), highlight: true, color: C.warn },
      { label: "إجمالي الأصناف المرتجعة", value: fmtNum(totalQty) },
      { label: "متوسط قيمة المرتجع", value: (input.returns.length - cancelledCount) > 0 ? fmtEGP(totalAmount / (input.returns.length - cancelledCount)) : fmtEGP(0) },
      { label: "مرتجعات نشطة", value: fmtNum(input.returns.length - cancelledCount), color: C.good },
      { label: "مرتجعات ملغاة", value: fmtNum(cancelledCount), color: cancelledCount > 0 ? C.bad : C.muted },
    ]);
    const details = sectionTitle("تفاصيل المرتجعات");
    const empty = `<div style="text-align:center;padding:40px;color:${C.muted};font-size:12px;border:1px dashed ${C.border};border-radius:10px;">لا توجد مرتجعات في الفترة المحددة</div>`;
    const html = [
      `<div data-pdf-section="header">${header}</div>`,
      `<div data-pdf-section="summary">${summary}</div>`,
      `<div data-pdf-section="details-title">${details}</div>`,
      ...(rows.length ? rows.map((r) => `<div data-pdf-section="return" style="margin-bottom:14px;">${purchaseReturnCardHtml(r)}</div>`) : [`<div data-pdf-section="empty">${empty}</div>`]),
    ].join("");

    await renderSectionsToPdf({ sectionsHtml: html, branchName: input.branchName, fileName: `تقرير-مرتجعات-الشراء-${input.branchName}-${input.filters.from || "الكل"}-${input.filters.to || "الكل"}.pdf` });
    toast.dismiss(t2);
    toast.success("✅ تم إنشاء التقرير بنجاح");
  } catch (e: any) {
    console.error("[generatePurchaseReturnsReport]", e);
    toast.dismiss();
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  }
}

// ============================================================================
// =======================  STOCK TRANSFERS REPORT  ===========================
// ============================================================================

function transferGroupCardHtml(g: {
  rows: any[]; fromName: string; toName: string; createdAt: string; reason: string | null;
}) {
  const totalQtyReq = g.rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const totalQtyRec = g.rows.reduce((s, r) => s + Number(r.received_quantity ?? r.quantity ?? 0), 0);
  const totalValue = g.rows.reduce((s, r) => s + Number(r.total_value_at_transfer ?? (Number(r.cost_price_at_transfer || 0) * Number(r.quantity || 0))), 0);
  const pending = g.rows.filter((r) => r.status === "pending").length;
  const confirmed = g.rows.filter((r) => r.status === "confirmed").length;
  const rejected = g.rows.filter((r) => r.status === "rejected").length;

  const statusPill = (s: string) =>
    s === "confirmed" ? pill("تم الاستلام", C.good, "#ecfdf5")
    : s === "rejected" ? pill("مرفوض", C.bad, "#fee2e2")
    : pill("قيد الانتظار", C.warn, "#fff7ed");

  const rowsHtml = g.rows.map((r) => {
    const q = Number(r.quantity || 0);
    const rec = Number(r.received_quantity ?? 0);
    const uc = Number(r.cost_price_at_transfer || 0);
    const val = Number(r.total_value_at_transfer ?? uc * q);
    return `<tr>
      <td style="padding:10px 12px;border-top:1px solid ${C.border};text-align:right;font-size:11px;color:${C.text};">${r.products?.name ?? "—"}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(q)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${rec === q ? C.good : rec === 0 ? C.bad : C.warn};font-weight:700;white-space:nowrap;">${r.status === "pending" ? "—" : fmtNum(rec)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${uc > 0 ? fmtNum(uc) : "—"}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;font-weight:700;color:${C.ink};white-space:nowrap;">${val > 0 ? fmtNum(val) : "—"}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;white-space:nowrap;">${statusPill(r.status)}</td>
    </tr>`;
  }).join("");

  return `
    <div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin-bottom:18px;background:${C.cardBg};page-break-inside:avoid;">
      <div style="padding:14px 18px;background:${C.softBg};border-bottom:1px solid ${C.border};display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 20px;">
        ${kv("من فرع", g.fromName || "—", C.ink)}
        ${kv("إلى فرع", g.toName || "—", C.accent)}
        ${kv("التاريخ", fmtDate(g.createdAt))}
        ${kv("عدد الأصناف", fmtNum(g.rows.length))}
        ${kv("قيد الانتظار / مستلم / مرفوض", `${pending} / ${confirmed} / ${rejected}`)}
        ${kv("إجمالي قيمة النقل", fmtEGP(totalValue), C.accent)}
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:${C.ink};">
            <th style="padding:11px 12px;text-align:right;color:#fff;font-size:11px;font-weight:700;">اسم الصنف</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:80px;">الكمية المرسلة</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:80px;">المستلم فعلياً</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:100px;">تكلفة الوحدة</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:110px;">قيمة الصنف</th>
            <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:110px;">الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr style="background:${C.accentSoft};">
            <td style="padding:11px 12px;border-top:2px solid ${C.ink};text-align:right;font-size:12px;font-weight:800;color:${C.ink};">الإجمالي</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};">${fmtNum(totalQtyReq)}</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};">${fmtNum(totalQtyRec)}</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;color:${C.muted};">—</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.accent};white-space:nowrap;">${fmtNum(totalValue)}</td>
            <td style="padding:11px 8px;border-top:2px solid ${C.ink};"></td>
          </tr>
        </tbody>
      </table>
      ${g.reason ? `<div style="padding:10px 16px;border-top:1px solid ${C.border};background:#fafbfc;font-size:11px;color:${C.muted};"><b style="color:${C.text};">السبب:</b> ${g.reason}</div>` : ""}
    </div>
  `;
}

export type StockTransfersReportInput = {
  branchId: string;
  branchName: string;
  transfers: any[]; // individual transfer rows (with group_id)
  branchNames: Record<string, string>;
  filters: { from?: string; to?: string };
  userName: string;
};
export async function generateStockTransfersReport(input: StockTransfersReportInput): Promise<void> {
  const t1 = toast.loading("⏳ جاري تحضير البيانات...");
  try {
    // Enrich with product names if missing
    const productIds = Array.from(new Set(input.transfers.map((t) => t.product_id).filter(Boolean)));
    const productMap = new Map<string, any>();
    if (productIds.length) {
      const { data } = await supabase.from("products").select("id, name").in("id", productIds);
      (data ?? []).forEach((p: any) => productMap.set(p.id, p));
    }
    const enriched = input.transfers.map((t) => ({
      ...t,
      products: t.products ?? productMap.get(t.product_id) ?? null,
    }));

    // Group by group_id (fallback single)
    const groups = new Map<string, any[]>();
    for (const t of enriched) {
      const key = t.group_id ?? `single-${t.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const gList = Array.from(groups.entries()).map(([key, rows]) => ({
      key, rows,
      fromName: input.branchNames[rows[0].from_branch_id] ?? "—",
      toName: input.branchNames[rows[0].to_branch_id] ?? "—",
      createdAt: rows[0].created_at,
      reason: rows[0].reason,
    })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    toast.dismiss(t1);
    const t2 = toast.loading("📄 جاري إنشاء ملف PDF...");

    let totalValue = 0, totalItems = 0, pending = 0, confirmed = 0, rejected = 0, incomingCount = 0, outgoingCount = 0;
    for (const t of enriched) {
      const q = Number(t.quantity || 0);
      const uc = Number(t.cost_price_at_transfer || 0);
      const val = Number(t.total_value_at_transfer ?? uc * q);
      totalValue += val;
      totalItems += q;
      if (t.status === "pending") pending++;
      else if (t.status === "confirmed") confirmed++;
      else if (t.status === "rejected") rejected++;
      if (t.to_branch_id === input.branchId) incomingCount++;
      if (t.from_branch_id === input.branchId) outgoingCount++;
    }

    const header = headerHtml({ title: "تقرير تفصيلي بتحويلات المخازن", branchName: input.branchName, userName: input.userName, fromDate: input.filters.from, toDate: input.filters.to });
    const summary = sectionTitle("ملخص تحويلات المخازن") + kpiCardsHtml([
      { label: "عدد المجموعات", value: fmtNum(gList.length) },
      { label: "إجمالي عدد الأصناف المحوّلة", value: fmtNum(enriched.length) },
      { label: "إجمالي الكميات", value: fmtNum(totalItems) },
      { label: "إجمالي قيمة النقل", value: fmtEGP(totalValue), highlight: true, color: C.accent },
      { label: "تحويلات صادرة", value: fmtNum(outgoingCount) },
      { label: "تحويلات واردة", value: fmtNum(incomingCount) },
      { label: "قيد الانتظار", value: fmtNum(pending), color: pending > 0 ? C.warn : C.muted },
      { label: "تم الاستلام", value: fmtNum(confirmed), color: C.good },
      { label: "مرفوض", value: fmtNum(rejected), color: rejected > 0 ? C.bad : C.muted },
    ]);
    const details = sectionTitle("تفاصيل التحويلات");
    const empty = `<div style="text-align:center;padding:40px;color:${C.muted};font-size:12px;border:1px dashed ${C.border};border-radius:10px;">لا توجد تحويلات في الفترة المحددة</div>`;
    const html = [
      `<div data-pdf-section="header">${header}</div>`,
      `<div data-pdf-section="summary">${summary}</div>`,
      `<div data-pdf-section="details-title">${details}</div>`,
      ...(gList.length ? gList.map((g) => `<div data-pdf-section="transfer" style="margin-bottom:14px;">${transferGroupCardHtml(g)}</div>`) : [`<div data-pdf-section="empty">${empty}</div>`]),
    ].join("");

    await renderSectionsToPdf({ sectionsHtml: html, branchName: input.branchName, fileName: `تقرير-تحويلات-المخازن-${input.branchName}-${input.filters.from || "الكل"}-${input.filters.to || "الكل"}.pdf` });
    toast.dismiss(t2);
    toast.success("✅ تم إنشاء التقرير بنجاح");
  } catch (e: any) {
    console.error("[generateStockTransfersReport]", e);
    toast.dismiss();
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  }
}


// ============================================================================
// ========================  SALES PROFIT REPORT  =============================
// ============================================================================
// Unified profit report — uses profitEngine (single source of truth).
// Works for a specific branch OR all branches. Shows KPIs + delta vs previous
// window + per-branch breakdown (when scope = all branches).

import { fetchProfitWindow, rangeForDates, type ProfitWindow } from "@/lib/profitEngine";

export interface ProfitReportInput {
  tenantId: string;
  branchId: string | null;      // null = all branches
  branchName: string;           // "كل الفروع" if null
  from: string;                 // YYYY-MM-DD
  to: string;                   // YYYY-MM-DD
  userName: string;
}

function deltaPill(cur: number, prev: number): string {
  const diff = cur - prev;
  const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : (cur > 0 ? 100 : 0);
  const up = diff >= 0;
  const color = up ? C.good : C.bad;
  const bg = up ? "#e6f4f1" : "#fee2e2";
  const arrow = up ? "▲" : "▼";
  return `<span style="background:${bg};color:${color};font-weight:800;font-size:11px;padding:3px 10px;border-radius:10px;direction:ltr;display:inline-block;">${arrow} ${fmtEGP(Math.abs(diff))} (${pct.toFixed(1)}%)</span>`;
}

function profitBranchTableHtml(rows: ProfitWindow["perBranch"]) {
  const sorted = [...rows].sort((a, b) => b.net - a.net);
  const totalNet = sorted.reduce((s, r) => s + r.net, 0);
  const totalRev = sorted.reduce((s, r) => s + r.revenue, 0);
  const totalCost = sorted.reduce((s, r) => s + r.cost, 0);
  const totalExp = sorted.reduce((s, r) => s + r.expenses, 0);

  const body = sorted.map((r, i) => {
    const margin = r.revenue > 0 ? (r.net / r.revenue) * 100 : 0;
    const netColor = r.net >= 0 ? C.good : C.bad;
    return `<tr>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.muted};">${i + 1}</td>
      <td style="padding:10px 12px;border-top:1px solid ${C.border};text-align:right;font-size:12px;font-weight:700;color:${C.ink};">${r.name}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(r.revenue)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtNum(r.cost)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.warn};white-space:nowrap;">${fmtNum(r.expenses)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:12px;font-weight:800;color:${netColor};white-space:nowrap;">${fmtNum(r.net)}</td>
      <td style="padding:10px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;font-weight:700;color:${netColor};white-space:nowrap;">${margin.toFixed(1)}%</td>
    </tr>`;
  }).join("");

  const totalMargin = totalRev > 0 ? (totalNet / totalRev) * 100 : 0;
  const totalColor = totalNet >= 0 ? C.good : C.bad;
  const totalRow = `<tr style="background:${C.softBg};">
    <td colspan="2" style="padding:11px 12px;border-top:2px solid ${C.ink};text-align:right;font-size:12px;font-weight:800;color:${C.ink};">الإجمالي</td>
    <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};white-space:nowrap;">${fmtNum(totalRev)}</td>
    <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.ink};white-space:nowrap;">${fmtNum(totalCost)}</td>
    <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${C.warn};white-space:nowrap;">${fmtNum(totalExp)}</td>
    <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:13px;font-weight:800;color:${totalColor};white-space:nowrap;">${fmtNum(totalNet)}</td>
    <td style="padding:11px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:12px;font-weight:800;color:${totalColor};white-space:nowrap;">${totalMargin.toFixed(1)}%</td>
  </tr>`;

  return `<div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;background:${C.cardBg};margin-bottom:18px;">
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:${C.ink};">
          <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:40px;">#</th>
          <th style="padding:11px 12px;text-align:right;color:#ffffff;font-size:11px;font-weight:700;">الفرع</th>
          <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:100px;">الإيراد</th>
          <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:100px;">التكلفة</th>
          <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:100px;">المصروفات</th>
          <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:110px;">صافي الربح</th>
          <th style="padding:11px 8px;text-align:center;color:#ffffff;font-size:11px;font-weight:700;width:70px;">الهامش</th>
        </tr>
      </thead>
      <tbody>${body || `<tr><td colspan="7" style="padding:16px;text-align:center;color:${C.muted};font-size:11px;">لا توجد بيانات</td></tr>`}${sorted.length ? totalRow : ""}</tbody>
    </table>
  </div>`;
}

function profitFormulaHtml(t: ProfitWindow["totals"]) {
  return `<div style="border:1px solid ${C.border};background:${C.softBg};border-radius:10px;padding:16px 20px;margin-bottom:18px;">
    <div style="font-size:12px;font-weight:800;color:${C.ink};margin-bottom:10px;text-align:center;">معادلة صافي الربح</div>
    <div style="display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:6px 10px;font-size:12px;color:${C.text};direction:ltr;">
      <span style="background:${C.accentSoft};color:${C.accent};font-weight:800;padding:4px 10px;border-radius:8px;">Revenue ${fmtEGP(t.revenue)}</span>
      <span style="font-weight:800;color:${C.muted};">−</span>
      <span style="background:#fef3c7;color:#b45309;font-weight:800;padding:4px 10px;border-radius:8px;">COGS ${fmtEGP(t.cost)}</span>
      <span style="font-weight:800;color:${C.muted};">−</span>
      <span style="background:#fee2e2;color:${C.bad};font-weight:800;padding:4px 10px;border-radius:8px;">Expenses ${fmtEGP(t.expenses)}</span>
      <span style="font-weight:800;color:${C.muted};">=</span>
      <span style="background:${t.net >= 0 ? "#dcfce7" : "#fee2e2"};color:${t.net >= 0 ? C.good : C.bad};font-weight:800;padding:4px 12px;border-radius:8px;">Net ${fmtEGP(t.net)}</span>
    </div>
  </div>`;
}

export async function generateProfitReport(input: ProfitReportInput): Promise<void> {
  const t1 = toast.loading("⏳ جاري تجهيز تقرير الربحية...");
  try {
    const range = rangeForDates(input.from, input.to);
    const window = await fetchProfitWindow({ tenantId: input.tenantId, range, branchId: input.branchId });
    toast.dismiss(t1);
    const t2 = toast.loading("📄 جاري إنشاء ملف PDF...");

    const t = window.totals;
    const header = headerHtml({
      title: "تقرير ربحية المبيعات",
      branchName: input.branchName,
      userName: input.userName,
      fromDate: input.from,
      toDate: input.to,
    });

    const kpi = sectionTitle("الملخّص التنفيذي للربحية") + kpiCardsHtml([
      { label: "إجمالي الإيراد", value: fmtEGP(t.revenue), highlight: true },
      { label: "تكلفة البضاعة (COGS)", value: fmtEGP(t.cost), color: C.warn },
      { label: "إجمالي الربح (Gross)", value: fmtEGP(t.gross), color: t.gross >= 0 ? C.good : C.bad },
      { label: "المصروفات التشغيلية", value: fmtEGP(t.expenses), color: C.bad },
      { label: "صافي الربح (Net)", value: fmtEGP(t.net), color: t.net >= 0 ? C.good : C.bad, highlight: true },
      { label: "هامش صافي الربح", value: fmtPct(t.margin), color: t.margin >= 0 ? C.good : C.bad },
    ]);

    const formula = profitFormulaHtml(t);

    // Delta vs prev period
    const deltaBox = `<div style="border:1px solid ${C.border};border-radius:10px;padding:16px 20px;margin-bottom:18px;background:${C.cardBg};">
      <div style="font-size:12px;font-weight:800;color:${C.ink};margin-bottom:10px;text-align:center;">مقارنة بالفترة السابقة</div>
      <div style="display:flex;justify-content:space-around;align-items:center;flex-wrap:wrap;gap:12px;">
        <div style="text-align:center;">
          <div style="font-size:11px;color:${C.muted};margin-bottom:4px;">صافي الفترة الحالية</div>
          <div style="font-size:16px;font-weight:800;color:${t.net >= 0 ? C.good : C.bad};direction:ltr;">${fmtEGP(t.net)}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:11px;color:${C.muted};margin-bottom:4px;">صافي الفترة السابقة</div>
          <div style="font-size:16px;font-weight:800;color:${C.ink};direction:ltr;">${fmtEGP(window.prevNet)}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:11px;color:${C.muted};margin-bottom:4px;">التغيّر</div>
          <div>${deltaPill(t.net, window.prevNet)}</div>
        </div>
      </div>
    </div>`;

    const perBranchSection = !input.branchId && window.perBranch.length > 0
      ? sectionTitle("توزيع الربحية على الفروع") + profitBranchTableHtml(window.perBranch)
      : "";

    const sectionsHtml = [
      `<div data-pdf-section="header">${header}</div>`,
      `<div data-pdf-section="kpi">${kpi}</div>`,
      `<div data-pdf-section="formula">${formula}</div>`,
      `<div data-pdf-section="delta">${deltaBox}</div>`,
      ...(perBranchSection ? [`<div data-pdf-section="perbranch">${perBranchSection}</div>`] : []),
    ].join("");

    await renderSectionsToPdf({
      sectionsHtml,
      branchName: input.branchName,
      fileName: `تقرير-ربحية-المبيعات-${input.branchName}-${input.from}-${input.to}.pdf`,
    });
    toast.dismiss(t2);
    toast.success("✅ تم إنشاء تقرير الربحية");
  } catch (e: any) {
    console.error("[generateProfitReport]", e);
    toast.dismiss();
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  }
}

// ============================================================================
// ========================  VOUCHERS REPORT  =================================
// (سندات القبض والصرف — تفصيلي مع تجميع حسب التصنيف)
// ============================================================================

function voucherRowHtml(v: any, catName: string, branchName?: string, showBranch?: boolean) {
  const cancelled = v.status === "cancelled";
  const payLabel = PAY_LABELS[v.payment_method] ?? v.payment_method ?? "—";
  const amountColor = v.type === "receipt" ? C.good : C.bad;
  const amountSign = v.type === "receipt" ? "+" : "-";
  return `
    <tr style="${cancelled ? "opacity:0.55;text-decoration:line-through;" : ""}">
      <td style="padding:9px 10px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};font-family:monospace;white-space:nowrap;">${v.voucher_number ?? "—"}</td>
      <td style="padding:9px 10px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtDate(v.voucher_date)}</td>
      <td style="padding:9px 10px;border-top:1px solid ${C.border};text-align:right;font-size:11px;color:${C.text};">${v.party_name || "—"}</td>
      <td style="padding:9px 10px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.muted};white-space:nowrap;">${payLabel}</td>
      ${showBranch ? `<td style="padding:9px 10px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.muted};white-space:nowrap;">${branchName ?? "—"}</td>` : ""}
      <td style="padding:9px 10px;border-top:1px solid ${C.border};text-align:right;font-size:11px;color:${C.text};">${v.description || "—"}</td>
      <td style="padding:9px 10px;border-top:1px solid ${C.border};text-align:center;font-size:12px;font-weight:800;color:${amountColor};white-space:nowrap;direction:ltr;">${amountSign} ${fmtNum(Number(v.amount || 0))}</td>
    </tr>
  `;
}

function voucherCategoryCardHtml(opts: {
  title: string;
  typeLabel: "receipt" | "payment";
  vouchers: any[];
  branchMap?: Record<string, string>;
  showBranch?: boolean;
}) {
  const activeTotal = opts.vouchers
    .filter((v) => v.status === "active")
    .reduce((s, v) => s + Number(v.amount || 0), 0);
  const cancelledCount = opts.vouchers.filter((v) => v.status === "cancelled").length;
  const headerColor = opts.typeLabel === "receipt" ? C.good : C.bad;
  const totalBg = opts.typeLabel === "receipt" ? "#ecfdf5" : "#fef2f2";

  const rows = opts.vouchers
    .map((v) => voucherRowHtml(v, opts.title, opts.branchMap?.[v.branch_id], opts.showBranch))
    .join("");

  return `
    <div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin-bottom:16px;background:${C.cardBg};page-break-inside:avoid;">
      <div style="padding:12px 16px;background:${C.softBg};border-bottom:1px solid ${C.border};display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;gap:10px;align-items:center;">
          <span style="width:6px;height:20px;background:${headerColor};border-radius:3px;display:inline-block;"></span>
          <span style="font-size:14px;font-weight:800;color:${C.ink};">${opts.title}</span>
          <span style="font-size:11px;color:${C.muted};">(${fmtNum(opts.vouchers.length)} سند${cancelledCount ? ` — ${cancelledCount} ملغي` : ""})</span>
        </div>
        <div style="font-size:13px;font-weight:800;color:${headerColor};direction:ltr;">${fmtEGP(activeTotal)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:${C.ink};">
            <th style="padding:10px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:90px;">رقم السند</th>
            <th style="padding:10px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:80px;">التاريخ</th>
            <th style="padding:10px 8px;text-align:right;color:#fff;font-size:11px;font-weight:700;">الجهة</th>
            <th style="padding:10px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:80px;">طريقة الدفع</th>
            ${opts.showBranch ? `<th style="padding:10px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:90px;">الفرع</th>` : ""}
            <th style="padding:10px 8px;text-align:right;color:#fff;font-size:11px;font-weight:700;">الوصف</th>
            <th style="padding:10px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:100px;">المبلغ</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="${opts.showBranch ? 7 : 6}" style="padding:16px;text-align:center;color:${C.muted};font-size:11px;">لا توجد سندات</td></tr>`}
          <tr style="background:${totalBg};">
            <td colspan="${opts.showBranch ? 6 : 5}" style="padding:10px 12px;border-top:2px solid ${C.ink};text-align:right;font-size:12px;font-weight:800;color:${C.ink};">إجمالي التصنيف (النشط فقط)</td>
            <td style="padding:10px 8px;border-top:2px solid ${C.ink};text-align:center;font-size:13px;font-weight:800;color:${headerColor};direction:ltr;">${fmtEGP(activeTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

export type VouchersReportInput = {
  branchName: string;
  vouchers: any[];
  categoriesMap: Record<string, string>;
  branchesMap?: Record<string, string>;
  showBranch?: boolean;
  filters: { from?: string; to?: string; type?: "" | "receipt" | "payment" };
  userName: string;
};

export async function generateVouchersReport(input: VouchersReportInput): Promise<void> {
  const t1 = toast.loading("⏳ جاري تحضير البيانات...");
  let t2: string | number | undefined;
  try {
    const active = input.vouchers.filter((v) => v.status === "active");
    const receipts = active.filter((v) => v.type === "receipt");
    const payments = active.filter((v) => v.type === "payment");
    const totalIn = receipts.reduce((s, v) => s + Number(v.amount || 0), 0);
    const totalOut = payments.reduce((s, v) => s + Number(v.amount || 0), 0);
    const net = totalIn - totalOut;
    const cancelledCount = input.vouchers.filter((v) => v.status === "cancelled").length;

    const groupBy = (arr: any[]) => {
      const m = new Map<string, any[]>();
      arr.forEach((v) => {
        const key = v.category_id || "__none__";
        const list = m.get(key) ?? [];
        list.push(v); m.set(key, list);
      });
      return m;
    };
    const receiptsByCat = groupBy(receipts.concat(input.vouchers.filter((v) => v.type === "receipt" && v.status === "cancelled")));
    const paymentsByCat = groupBy(payments.concat(input.vouchers.filter((v) => v.type === "payment" && v.status === "cancelled")));

    toast.dismiss(t1);
    t2 = toast.loading("📄 جاري إنشاء ملف PDF...");

    const titleType =
      input.filters.type === "receipt" ? "تقرير تفصيلي بسندات القبض"
      : input.filters.type === "payment" ? "تقرير تفصيلي بسندات الصرف"
      : "تقرير تفصيلي بالسندات المالية (قبض وصرف)";

    const header = headerHtml({
      title: titleType,
      branchName: input.branchName,
      userName: input.userName,
      fromDate: input.filters.from,
      toDate: input.filters.to,
    });

    const summary = sectionTitle("الملخّص المالي") + kpiCardsHtml([
      { label: "إجمالي القبض (داخل)", value: fmtEGP(totalIn), highlight: true, color: C.good },
      { label: "إجمالي الصرف (خارج)", value: fmtEGP(totalOut), color: C.bad },
      { label: "الصافي", value: fmtEGP(net), highlight: true, color: net >= 0 ? C.good : C.bad },
      { label: "عدد سندات القبض", value: fmtNum(receipts.length), color: C.good },
      { label: "عدد سندات الصرف", value: fmtNum(payments.length), color: C.bad },
      { label: "السندات الملغاة", value: fmtNum(cancelledCount), color: cancelledCount > 0 ? C.warn : C.muted },
    ]);

    const buildTypeSection = (label: string, byCat: Map<string, any[]>, typeLabel: "receipt" | "payment") => {
      if (byCat.size === 0) return "";
      const cards = Array.from(byCat.entries()).map(([catId, list]) => {
        const catName = catId === "__none__" ? "بدون تصنيف" : (input.categoriesMap[catId] ?? "تصنيف محذوف");
        return `<div data-pdf-section="voucher-cat" style="margin-bottom:14px;">${voucherCategoryCardHtml({
          title: catName,
          typeLabel,
          vouchers: list,
          branchMap: input.branchesMap,
          showBranch: !!input.showBranch,
        })}</div>`;
      }).join("");
      return `<div data-pdf-section="type-title">${sectionTitle(label)}</div>` + cards;
    };

    const receiptsSection = (input.filters.type === "" || input.filters.type === "receipt" || !input.filters.type)
      ? buildTypeSection("تفاصيل سندات القبض حسب التصنيف", receiptsByCat, "receipt") : "";
    const paymentsSection = (input.filters.type === "" || input.filters.type === "payment" || !input.filters.type)
      ? buildTypeSection("تفاصيل سندات الصرف حسب التصنيف", paymentsByCat, "payment") : "";

    const empty = input.vouchers.length === 0
      ? `<div data-pdf-section="empty"><div style="text-align:center;padding:40px;color:${C.muted};font-size:12px;border:1px dashed ${C.border};border-radius:10px;">لا توجد سندات في الفلاتر المحددة</div></div>`
      : "";

    const html = [
      `<div data-pdf-section="header">${header}</div>`,
      `<div data-pdf-section="summary">${summary}</div>`,
      receiptsSection,
      paymentsSection,
      empty,
    ].join("");

    await renderSectionsToPdf({
      sectionsHtml: html,
      branchName: input.branchName,
      fileName: `تقرير-السندات-${input.branchName}-${input.filters.from || "الكل"}-${input.filters.to || "الكل"}.pdf`,
    });

    toast.success("✅ تم إنشاء تقرير السندات");
  } catch (e: any) {
    console.error("[generateVouchersReport]", e);
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  } finally {
    toast.dismiss(t1);
    if (t2 !== undefined) toast.dismiss(t2);
  }
}

// ============================================================================
// ================  BRANCH REPORTS — PER-TAB DETAILED PDF  ===================
// ============================================================================

export type ReportsTabKey = "charts" | "products" | "leastsold" | "expenses" | "lowstock";

export type BranchTabReportInput = {
  tab: ReportsTabKey;
  branchName: string;
  userName: string;
  from: string;
  to: string;
  // summary numbers
  totals: {
    totalSales: number; totalCost: number; grossProfit: number;
    totalExpenses: number; netProfit: number; cashIn: number; cashOut: number;
    totalReturns: number; invoicesCount: number;
  };
  daily?: { date: string; sales: number; profit: number }[];
  expensesByType?: { name: string; value: number }[];
  topProducts?: { name: string; qty: number; revenue: number; stock?: number }[];
  leastProducts?: { name: string; qty: number; revenue: number; stock?: number }[];
  expenses?: { date: string; type: string; description?: string; amount: number }[];
  lowStock?: { name: string; sku?: string; quantity: number; low_stock_alert: number }[];
};

function simpleTable(headers: string[], rows: string[][], widths?: string[]) {
  const ths = headers.map((h, i) => `<th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;${widths?.[i] ? `width:${widths[i]};` : ""}">${h}</th>`).join("");
  const trs = rows.length
    ? rows.map((r) => `<tr>${r.map((c) => `<td style="padding:9px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" style="padding:16px;text-align:center;color:${C.muted};font-size:11px;">لا توجد بيانات</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;border:1px solid ${C.border};border-radius:8px;overflow:hidden;margin-bottom:16px;">
    <thead><tr style="background:${C.ink};">${ths}</tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
}

const TAB_TITLES: Record<ReportsTabKey, string> = {
  charts: "تقرير التحليل البصري التفصيلي",
  products: "تقرير الأكثر مبيعاً التفصيلي",
  leastsold: "تقرير الأقل مبيعاً التفصيلي",
  expenses: "تقرير سندات الصرف التفصيلي",
  lowstock: "تقرير المخزون المنخفض التفصيلي",
};

export async function generateBranchTabReport(input: BranchTabReportInput): Promise<void> {
  const t1 = toast.loading("🖨️ جاري تحضير التقرير...");
  let t2: string | number | undefined;
  try {
    const header = headerHtml({
      title: TAB_TITLES[input.tab],
      branchName: input.branchName,
      userName: input.userName,
      fromDate: input.from,
      toDate: input.to,
    });

    const T = input.totals;
    const sections: string[] = [`<div data-pdf-section="header">${header}</div>`];

    if (input.tab === "charts") {
      const kpi = kpiCardsHtml([
        { label: "إجمالي المبيعات (صافي)", value: fmtEGP(T.totalSales), highlight: true },
        { label: "إجمالي التكلفة", value: fmtEGP(T.totalCost) },
        { label: "إجمالي الربح", value: fmtEGP(T.grossProfit), color: C.good },
        { label: "المصروفات", value: fmtEGP(T.totalExpenses), color: C.warn },
        { label: "صافي الربح", value: fmtEGP(T.netProfit), color: T.netProfit >= 0 ? C.good : C.bad },
        { label: "المرتجعات", value: fmtEGP(T.totalReturns), color: C.warn },
        { label: "وارد الخزنة", value: fmtEGP(T.cashIn), color: C.good },
        { label: "صادر الخزنة", value: fmtEGP(T.cashOut), color: C.bad },
        { label: "عدد الفواتير", value: fmtNum(T.invoicesCount) },
      ]);
      sections.push(`<div data-pdf-section="kpi">${kpi}</div>`);

      sections.push(`<div data-pdf-section="daily-title">${sectionTitle("المبيعات والأرباح اليومية")}</div>`);
      const dailyRows = (input.daily ?? []).map((d) => [d.date, fmtEGP(d.sales), fmtEGP(d.profit)]);
      sections.push(`<div data-pdf-section="daily">${simpleTable(["التاريخ", "المبيعات", "الربح"], dailyRows)}</div>`);

      sections.push(`<div data-pdf-section="exp-title">${sectionTitle("المصروفات حسب النوع")}</div>`);
      const totalExp = (input.expensesByType ?? []).reduce((s, e) => s + e.value, 0);
      const expRows = (input.expensesByType ?? [])
        .sort((a, b) => b.value - a.value)
        .map((e) => [e.name, fmtEGP(e.value), totalExp ? fmtPct((e.value / totalExp) * 100) : "—"]);
      sections.push(`<div data-pdf-section="exp">${simpleTable(["النوع", "المبلغ", "النسبة"], expRows)}</div>`);
    }

    if (input.tab === "products" || input.tab === "leastsold") {
      const rows = (input.tab === "products" ? input.topProducts : input.leastProducts) ?? [];
      const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
      const totalQty = rows.reduce((s, r) => s + r.qty, 0);
      sections.push(`<div data-pdf-section="kpi">${kpiCardsHtml([
        { label: "عدد الأصناف", value: fmtNum(rows.length), highlight: true },
        { label: "إجمالي الكميات المباعة", value: fmtNum(totalQty) },
        { label: "إجمالي الإيراد", value: fmtEGP(totalRev), color: C.good },
      ])}</div>`);
      const table = simpleTable(
        ["#", "المنتج", "الكمية المباعة", "المتوفر", "الإيراد", "النسبة من الإيراد"],
        rows.map((r, i) => {
          const stock = r.stock ?? 0;
          const stockCell = `<b style="color:${stock <= 0 ? C.bad : stock <= 5 ? C.warn : C.text};">${fmtNum(stock)}</b>`;
          return [String(i + 1), r.name, fmtNum(r.qty), stockCell, fmtEGP(r.revenue), totalRev ? fmtPct((r.revenue / totalRev) * 100) : "—"];
        }),
        ["36px", "", "110px", "80px", "130px", "110px"],
      );
      sections.push(`<div data-pdf-section="prods">${table}</div>`);
    }

    if (input.tab === "expenses") {
      const rows = input.expenses ?? [];
      const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
      sections.push(`<div data-pdf-section="kpi">${kpiCardsHtml([
        { label: "عدد السندات", value: fmtNum(rows.length), highlight: true },
        { label: "إجمالي المصروفات", value: fmtEGP(total), color: C.warn },
        { label: "متوسط السند", value: fmtEGP(rows.length ? total / rows.length : 0) },
      ])}</div>`);
      // by type
      const byType: Record<string, number> = {};
      rows.forEach((e) => { byType[e.type] = (byType[e.type] ?? 0) + Number(e.amount || 0); });
      sections.push(`<div data-pdf-section="by-type-title">${sectionTitle("المصروفات حسب النوع")}</div>`);
      sections.push(`<div data-pdf-section="by-type">${simpleTable(
        ["النوع", "المبلغ", "النسبة"],
        Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, fmtEGP(v), total ? fmtPct((v / total) * 100) : "—"]),
      )}</div>`);
      // full list
      sections.push(`<div data-pdf-section="full-title">${sectionTitle("تفاصيل السندات")}</div>`);
      const listRows = rows
        .slice()
        .sort((a, b) => (a.date > b.date ? -1 : 1))
        .map((e, i) => [String(i + 1), fmtDate(e.date), e.type, e.description || "—", fmtEGP(Number(e.amount || 0))]);
      sections.push(`<div data-pdf-section="full">${simpleTable(
        ["#", "التاريخ", "النوع", "الوصف", "المبلغ"],
        listRows,
        ["36px", "90px", "140px", "", "110px"],
      )}</div>`);
    }

    if (input.tab === "lowstock") {
      const rows = input.lowStock ?? [];
      const critical = rows.filter((r) => r.quantity === 0).length;
      sections.push(`<div data-pdf-section="kpi">${kpiCardsHtml([
        { label: "عدد الأصناف تحت الحد", value: fmtNum(rows.length), highlight: true, color: C.warn },
        { label: "أصناف نافذة (0)", value: fmtNum(critical), color: C.bad },
        { label: "أصناف بحاجة تجديد", value: fmtNum(rows.length - critical) },
      ])}</div>`);
      const listRows = rows
        .slice()
        .sort((a, b) => a.quantity - b.quantity)
        .map((p, i) => [
          String(i + 1),
          p.name,
          p.sku || "—",
          `<b style="color:${p.quantity === 0 ? C.bad : C.warn};">${fmtNum(p.quantity)}</b>`,
          fmtNum(p.low_stock_alert),
          fmtNum(Math.max(0, p.low_stock_alert - p.quantity)),
        ]);
      sections.push(`<div data-pdf-section="ls">${simpleTable(
        ["#", "المنتج", "الكود", "المتوفر", "حد التنبيه", "الكمية المطلوبة"],
        listRows,
        ["36px", "", "110px", "90px", "90px", "110px"],
      )}</div>`);
    }

    t2 = toast.loading("📄 جاري إنشاء ملف PDF...");
    await renderSectionsToPdf({
      sectionsHtml: sections.join(""),
      branchName: input.branchName,
      fileName: `${TAB_TITLES[input.tab]}-${input.branchName}-${input.from}-${input.to}.pdf`,
    });
    toast.success("✅ تم إنشاء التقرير");
  } catch (e: any) {
    console.error("[generateBranchTabReport]", e);
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  } finally {
    toast.dismiss(t1);
    if (t2 !== undefined) toast.dismiss(t2);
  }
}

// ============================================================================
// =====================  PARTNER STATEMENT REPORT  ===========================
// ============================================================================

const TX_LABEL: Record<string, string> = {
  contribution: "مساهمة رأس مال",
  drawing: "سحب من الرصيد",
  profit_share: "توزيع أرباح",
  capital_adjustment: "تسوية رأس المال",
};

export type PartnerStatementInput = {
  partner: {
    id: string;
    name: string;
    partner_type: string;
    capital_share: number;
    operating_share: number;
    initial_capital: number;
    current_balance: number;
    total_contributions?: number;
    total_drawings?: number;
    total_profit_share?: number;
  };
  transactions: Array<{
    id: string;
    transaction_type: string;
    amount: number;
    description?: string | null;
    month_year?: string | null;
    created_at: string;
  }>;
  openingBalance: number;
  filters: { from?: string; to?: string };
  branchName: string;
  userName: string;
  lastProfit?: {
    date: string;
    amount: number;
    monthsCount: number;
    periodLabel?: string | null;
  } | null;
  companyName?: string;
};

export async function generatePartnerStatementReport(input: PartnerStatementInput): Promise<void> {
  const t1 = toast.loading("📄 جاري إنشاء كشف الحساب...");
  try {
    const sorted = [...input.transactions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    let running = Number(input.openingBalance) || 0;
    let totalIn = 0, totalOut = 0;
    const rows = sorted.map((t) => {
      const amt = Number(t.amount) || 0;
      const isOut = t.transaction_type === "drawing";
      const debit = isOut ? amt : 0;   // مدين = خصم من الرصيد (سحب)
      const credit = isOut ? 0 : amt;  // دائن = زيادة الرصيد
      running += credit - debit;
      if (isOut) totalOut += amt; else totalIn += amt;
      return { t, debit, credit, running };
    });
    const closing = running;

    const header = headerHtml({
      title: "كشف حساب شريك",
      branchName: input.branchName,
      userName: input.userName,
      fromDate: input.filters.from,
      toDate: input.filters.to,
    });

    const typeLabel = input.partner.partner_type === "capital" ? "شريك رأس مال"
      : input.partner.partner_type === "operating" ? "شريك تشغيل" : "شريك رأس مال وتشغيل";

    // Partner identity card
    const identity = `
      <div style="border:1px solid ${C.border};border-radius:10px;background:${C.softBg};padding:16px 20px;margin-bottom:18px;display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;">
        <div style="display:flex;gap:8px;align-items:baseline;"><span style="color:${C.muted};font-size:12px;">اسم الشريك:</span><span style="color:${C.ink};font-size:16px;font-weight:800;">${input.partner.name}</span></div>
        <div style="display:flex;gap:8px;align-items:baseline;"><span style="color:${C.muted};font-size:12px;">النوع:</span><span style="color:${C.accent};font-size:13px;font-weight:700;">${typeLabel}</span></div>
        <div style="display:flex;gap:8px;align-items:baseline;"><span style="color:${C.muted};font-size:12px;">حصة رأس المال:</span><span style="color:${C.ink};font-size:13px;font-weight:700;">${(Number(input.partner.capital_share) * 100).toFixed(2)}%</span></div>
        <div style="display:flex;gap:8px;align-items:baseline;"><span style="color:${C.muted};font-size:12px;">حصة التشغيل:</span><span style="color:${C.ink};font-size:13px;font-weight:700;">${(Number(input.partner.operating_share) * 100).toFixed(2)}%</span></div>
        <div style="display:flex;gap:8px;align-items:baseline;"><span style="color:${C.muted};font-size:12px;">رأس المال المبدئي:</span><span style="color:${C.ink};font-size:13px;font-weight:700;">${fmtEGP(input.partner.initial_capital)}</span></div>
        <div style="display:flex;gap:8px;align-items:baseline;"><span style="color:${C.muted};font-size:12px;">الرصيد الحالي:</span><span style="color:${C.accent};font-size:14px;font-weight:800;">${fmtEGP(input.partner.current_balance)}</span></div>
      </div>
    `;

    // KPI summary
    const summary = sectionTitle("ملخّص الكشف") + kpiCardsHtml([
      { label: "الرصيد الافتتاحي", value: fmtEGP(input.openingBalance) },
      { label: "إجمالي الوارد (مساهمات + أرباح)", value: fmtEGP(totalIn), color: C.good },
      { label: "إجمالي المسحوب", value: fmtEGP(totalOut), color: C.bad },
      { label: "عدد الحركات", value: fmtNum(rows.length) },
      { label: "صافي الحركة", value: fmtEGP(totalIn - totalOut), color: (totalIn - totalOut) >= 0 ? C.good : C.bad },
      { label: "الرصيد الختامي", value: fmtEGP(closing), highlight: true, color: C.accent },
    ]);

    // Last profit info
    const lastProfitHtml = input.lastProfit ? `
      <div style="border:1px solid ${C.accent};background:${C.accentSoft};border-radius:10px;padding:14px 18px;margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <div style="font-size:14px;font-weight:800;color:${C.ink};">آخر توزيع أرباح</div>
          <div style="font-size:16px;font-weight:800;color:${C.accent};">${fmtEGP(input.lastProfit.amount)}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 24px;margin-top:10px;">
          <div style="font-size:12px;color:${C.muted};">التاريخ: <span style="color:${C.ink};font-weight:700;">${fmtDate(input.lastProfit.date)}</span></div>
          <div style="font-size:12px;color:${C.muted};">عدد الأشهر: <span style="color:${C.ink};font-weight:700;">${input.lastProfit.monthsCount} شهر</span></div>
          ${input.lastProfit.periodLabel ? `<div style="font-size:12px;color:${C.muted};">الفترة: <span style="color:${C.ink};font-weight:700;">${input.lastProfit.periodLabel}</span></div>` : ""}
        </div>
      </div>
    ` : "";

    // Movements table (chunk into groups of ~22 rows per page-safe section)
    const buildTable = (chunk: typeof rows) => {
      const trs = chunk.map(({ t, debit, credit, running }) => `
        <tr>
          <td style="padding:9px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};white-space:nowrap;">${fmtDate(t.created_at)}</td>
          <td style="padding:9px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.text};">${TX_LABEL[t.transaction_type] ?? t.transaction_type}</td>
          <td style="padding:9px 10px;border-top:1px solid ${C.border};text-align:right;font-size:11px;color:${C.text};">${t.description || "-"}${t.month_year ? ` <span style="color:${C.muted};">(${t.month_year})</span>` : ""}</td>
          <td style="padding:9px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${debit > 0 ? C.bad : C.muted};font-weight:${debit > 0 ? 700 : 400};white-space:nowrap;">${debit > 0 ? fmtNum(debit) : "-"}</td>
          <td style="padding:9px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${credit > 0 ? C.good : C.muted};font-weight:${credit > 0 ? 700 : 400};white-space:nowrap;">${credit > 0 ? fmtNum(credit) : "-"}</td>
          <td style="padding:9px 8px;border-top:1px solid ${C.border};text-align:center;font-size:11px;color:${C.ink};font-weight:700;white-space:nowrap;">${fmtNum(running)}</td>
        </tr>
      `).join("");
      return `
        <table style="width:100%;border-collapse:collapse;border:1px solid ${C.border};border-radius:8px;overflow:hidden;background:#fff;">
          <thead>
            <tr style="background:${C.ink};">
              <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:80px;">التاريخ</th>
              <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:110px;">النوع</th>
              <th style="padding:11px 8px;text-align:right;color:#fff;font-size:11px;font-weight:700;">الوصف</th>
              <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:90px;">مدين</th>
              <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:90px;">دائن</th>
              <th style="padding:11px 8px;text-align:center;color:#fff;font-size:11px;font-weight:700;width:100px;">الرصيد الجاري</th>
            </tr>
          </thead>
          <tbody>${trs || `<tr><td colspan="6" style="padding:16px;text-align:center;color:${C.muted};font-size:11px;">لا توجد حركات في الفترة المحددة</td></tr>`}</tbody>
        </table>
      `;
    };

    // Opening + Closing bookend rows shown as separate emphasis boxes
    const openingRow = `
      <div style="border:1px solid ${C.border};border-right:4px solid ${C.muted};border-radius:8px;padding:10px 14px;margin-bottom:10px;background:#fff;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:12px;color:${C.muted};">الرصيد الافتتاحي ${input.filters.from ? `في ${fmtDate(input.filters.from)}` : ""}</div>
        <div style="font-size:14px;color:${C.ink};font-weight:800;">${fmtEGP(input.openingBalance)}</div>
      </div>
    `;
    const closingRow = `
      <div style="border:1px solid ${C.accent};border-right:4px solid ${C.accent};border-radius:8px;padding:12px 14px;margin-top:10px;background:${C.accentSoft};display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:13px;color:${C.ink};font-weight:800;">الرصيد الختامي ${input.filters.to ? `في ${fmtDate(input.filters.to)}` : "الحالي"}</div>
        <div style="font-size:16px;color:${C.accent};font-weight:800;">${fmtEGP(closing)}</div>
      </div>
    `;

    // Split rows into pages of 22 to keep each section on a page
    const CHUNK = 22;
    const chunks: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));
    if (chunks.length === 0) chunks.push([]);

    const tableSections = chunks.map((c, i) => `
      <div data-pdf-section="tx-chunk-${i}" style="margin-bottom:12px;">
        ${i === 0 ? sectionTitle("تفاصيل الحركات") + openingRow : ""}
        ${buildTable(c)}
        ${i === chunks.length - 1 ? closingRow : ""}
      </div>
    `).join("");

    // Signature + company stamp block
    const company = input.companyName || input.branchName || "الشركة";
    const signatureHtml = `
      <div style="margin-top:22px;padding-top:14px;border-top:1px dashed ${C.border};">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;align-items:end;">
          <div style="text-align:center;">
            <div style="height:52px;border-bottom:1px solid ${C.ink};"></div>
            <div style="font-size:11px;color:${C.muted};margin-top:6px;">توقيع الشريك</div>
            <div style="font-size:12px;color:${C.ink};font-weight:700;">${input.partner.name}</div>
          </div>
          <div style="text-align:center;">
            <div style="height:52px;border-bottom:1px solid ${C.ink};"></div>
            <div style="font-size:11px;color:${C.muted};margin-top:6px;">توقيع المحاسب / المسؤول</div>
            <div style="font-size:12px;color:${C.ink};font-weight:700;">${input.userName}</div>
          </div>
          <div style="text-align:center;">
            <div style="width:104px;height:104px;margin:0 auto;border:2px solid ${C.accent};border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${C.accent};">
              <div style="font-size:12px;font-weight:800;line-height:1.4;">${company}</div>
              <div style="font-size:9px;opacity:.8;margin-top:2px;">ختم الشركة</div>
            </div>
          </div>
        </div>
        <div style="margin-top:14px;text-align:center;font-size:10px;color:${C.muted};line-height:1.8;">
          هذا الكشف صادر آليًا من نظام Nizam بتاريخ ${fmtDateTime(new Date().toISOString())} — غير معتمد إلا بالتوقيع والختم.
        </div>
      </div>
    `;

    const sectionsHtml = [
      `<div data-pdf-section="header">${header}</div>`,
      `<div data-pdf-section="identity">${identity}</div>`,
      `<div data-pdf-section="summary">${summary}</div>`,
      input.lastProfit ? `<div data-pdf-section="last-profit">${lastProfitHtml}</div>` : "",
      tableSections,
      `<div data-pdf-section="signature">${signatureHtml}</div>`,
    ].join("");


    const fromStr = input.filters.from || "الكل";
    const toStr = input.filters.to || "الكل";
    await renderSectionsToPdf({
      sectionsHtml,
      branchName: input.branchName,
      fileName: `كشف-حساب-${input.partner.name}-${fromStr}-${toStr}.pdf`,
    });
    toast.success("✅ تم إنشاء كشف الحساب");
  } catch (e: any) {
    console.error("[generatePartnerStatementReport]", e);
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  } finally {
    toast.dismiss(t1);
  }
}

