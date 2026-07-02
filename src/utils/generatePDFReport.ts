/**
 * Shared PDF report generator (RTL Arabic) — elegant card-style layout.
 * Renders a hidden HTML report to a multi-page A4 (portrait) PDF via html2canvas + jsPDF.
 */
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
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

// section title with accent bar (bar on right for RTL)
function sectionTitle(text: string) {
  return `
    <div style="display:flex;align-items:center;justify-content:flex-start;gap:10px;margin:8px 0 14px;">
      <div style="font-size:16px;font-weight:800;color:${C.ink};">${text}</div>
      <div style="width:4px;height:22px;background:${C.accent};border-radius:2px;"></div>
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
            <div style="border:1px solid ${border};background:${bg};border-radius:10px;padding:16px 18px;min-height:74px;">
              <div style="font-size:11px;color:${C.muted};margin-bottom:8px;text-align:center;">${c.label}</div>
              <div style="font-size:17px;font-weight:800;color:${valColor};text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.value}</div>
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

    const details = sectionTitle("تفاصيل الفواتير المحقّقة") +
      (invRows.length
        ? invRows.map(invoiceCardHtml).join("")
        : `<div style="text-align:center;padding:40px;color:${C.muted};font-size:12px;border:1px dashed ${C.border};border-radius:10px;">لا توجد فواتير في الفترة المحددة</div>`);

    // A4 portrait: 210 × 297mm → 96dpi ≈ 794 × 1123 px
    const container = document.createElement("div");
    container.style.cssText = `
      position:fixed;left:-99999px;top:0;width:794px;padding:36px 40px;
      background:#ffffff;color:${C.text};font-family:'Cairo','Segoe UI','Tahoma',sans-serif;
      direction:rtl;text-align:right;box-sizing:border-box;
    `;
    container.innerHTML = header + summary + details;
    document.body.appendChild(container);

    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    document.body.removeChild(container);

    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const footerH = 24;
    const usableH = pageH - margin * 2 - footerH;
    const imgW = pageW - margin * 2;
    const ratio = canvas.width / imgW;
    const pageCanvasH = usableH * ratio;
    const totalPages = Math.max(1, Math.ceil(canvas.height / pageCanvasH));

    for (let i = 0; i < totalPages; i++) {
      if (i > 0) pdf.addPage();
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.min(pageCanvasH, canvas.height - i * pageCanvasH);
      const ctx = slice.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, i * pageCanvasH, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      const imgH = slice.height / ratio;
      pdf.addImage(slice.toDataURL("image/jpeg", 0.93), "JPEG", margin, margin, imgW, imgH);

      // Footer
      pdf.setDrawColor(226, 232, 238);
      pdf.setLineWidth(0.6);
      pdf.line(margin, pageH - footerH, pageW - margin, pageH - footerH);
      pdf.setFontSize(9);
      pdf.setTextColor(107, 122, 134);
      pdf.text(input.branchName, margin, pageH - 10);
      pdf.text(`صفحة ${i + 1} من ${totalPages}`, pageW - margin, pageH - 10, { align: "right" });
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
