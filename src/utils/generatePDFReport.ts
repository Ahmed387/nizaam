/**
 * Shared PDF report generator (RTL Arabic).
 * Renders a hidden HTML report to a multi-page A4 PDF via html2canvas + jsPDF.
 *
 * Currently exposes:
 *  - generateSalesReport(): تقرير تفصيلي بالمبيعات
 *
 * Additional per-tab reports will be added here as prototypes are approved.
 */
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

// ---------- shared header/footer HTML ----------
function headerHtml(opts: {
  tenantName: string; tenantLogo?: string | null; branchName: string;
  title: string; fromDate?: string; toDate?: string; userName: string;
}) {
  const period =
    opts.fromDate || opts.toDate
      ? `من ${opts.fromDate ? fmtDate(opts.fromDate) : "البداية"} إلى ${opts.toDate ? fmtDate(opts.toDate) : "اليوم"}`
      : "كل الفترات المتاحة";
  const logo = opts.tenantLogo
    ? `<img src="${opts.tenantLogo}" crossorigin="anonymous" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #2d3748;background:#fff;" />`
    : `<div style="width:56px;height:56px;border-radius:50%;background:#2d3748;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;">${(opts.tenantName || "?").slice(0, 1)}</div>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:10px;">
      <div style="display:flex;gap:10px;align-items:center;">
        ${logo}
        <div>
          <div style="font-size:16px;font-weight:800;color:#1a202c;">${opts.tenantName}</div>
          <div style="font-size:11px;color:#4a5568;">فرع: ${opts.branchName}</div>
        </div>
      </div>
      <div style="text-align:center;flex:1;">
        <div style="font-size:18px;font-weight:800;color:#1a202c;">${opts.title}</div>
        <div style="font-size:11px;color:#4a5568;margin-top:2px;">الفترة: ${period}</div>
      </div>
      <div style="text-align:left;font-size:10px;color:#4a5568;line-height:1.6;">
        <div>تاريخ الطباعة: ${fmtDateTime(new Date().toISOString())}</div>
        <div>المستخدم: ${opts.userName}</div>
      </div>
    </div>
    <div style="border-bottom:2px solid #2d3748;margin-bottom:12px;"></div>
  `;
}

function summaryCardsHtml(cards: { label: string; value: string; color?: string }[]) {
  return `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px;">
      ${cards
        .map(
          (c) => `
        <div style="border:1.5px solid #2d3748;border-radius:6px;padding:10px 12px;background:#fff;min-width:0;">
          <div style="font-size:10px;color:#4a5568;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.label}</div>
          <div style="font-size:13px;font-weight:800;color:${c.color ?? "#1a202c"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.value}</div>
        </div>`
        )
        .join("")}
    </div>
  `;
}

// ---------- sales report ----------
export type SalesReportInput = {
  branchId: string;
  branchName: string;
  invoices: any[]; // filteredRows from screen (already-filtered invoices w/ contacts:contact_id(name))
  filters: { from?: string; to?: string };
  userName: string;
};

export async function generateSalesReport(input: SalesReportInput): Promise<void> {
  const t1 = toast.loading("⏳ جاري تحضير البيانات...");
  try {
    // Company info from tenants (via first invoice's tenant_id, or from settings)
    const tenantId = (input.invoices[0] as any)?.tenant_id;
    let tenantName = "—";
    let tenantLogo: string | null = null;
    if (tenantId) {
      const { data: t } = await supabase.from("tenants").select("name, logo_url").eq("id", tenantId).maybeSingle();
      tenantName = t?.name ?? "—";
      tenantLogo = (t as any)?.logo_url ?? null;
    }

    const invIds = input.invoices.map((r) => r.id);

    // Fetch line items and payments in parallel (batch by 100 to avoid URL length limits)
    const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    const itemBatches = await Promise.all(
      chunk(invIds, 100).map((ids) =>
        supabase.from("invoice_items").select("*").in("invoice_id", ids)
      )
    );
    const paymentBatches = await Promise.all(
      chunk(invIds, 100).map((ids) =>
        supabase.from("invoice_payments").select("invoice_id, amount, payment_method").in("invoice_id", ids)
      )
    );
    const allItems: any[] = itemBatches.flatMap((r) => r.data ?? []);
    const allPayments: any[] = paymentBatches.flatMap((r) => r.data ?? []);
    const itemsByInv = new Map<string, any[]>();
    allItems.forEach((it) => {
      const arr = itemsByInv.get(it.invoice_id) ?? [];
      arr.push(it); itemsByInv.set(it.invoice_id, arr);
    });
    const paidByInv = new Map<string, number>();
    const paidMethodTotals: Record<string, number> = {};
    allPayments.forEach((p) => {
      paidByInv.set(p.invoice_id, (paidByInv.get(p.invoice_id) ?? 0) + Number(p.amount || 0));
      const key = p.payment_method || "other";
      paidMethodTotals[key] = (paidMethodTotals[key] ?? 0) + Number(p.amount || 0);
    });

    toast.dismiss(t1);
    const t2 = toast.loading("📄 جاري إنشاء ملف PDF...");

    // ---- Compute totals ----
    let totalSales = 0, totalPaid = 0, totalRemaining = 0, totalProfit = 0;
    let totalDiscount = 0, totalVat = 0;
    let activeCount = 0, activeAmount = 0, cancelledCount = 0, cancelledAmount = 0;
    let hasAnyCostData = false;

    const invRows = input.invoices.map((inv) => {
      const items = itemsByInv.get(inv.id) ?? [];
      const paid = paidByInv.get(inv.id) ?? 0;
      const total = Number(inv.total || 0);
      const remaining = Math.max(0, total - paid);

      // Profit calc — only if cost data is trustworthy (not fully migrated with zero costs)
      let cost = 0; let hasCost = false;
      items.forEach((it) => {
        const unitCost = Number(it.unit_cost_at_sale || it.cost_price || 0);
        if (unitCost > 0) hasCost = true;
        cost += unitCost * Number(it.quantity || 0);
      });
      const isMigratedNoCost = inv.is_migrated && !hasCost;
      const profit = isMigratedNoCost ? null : total - cost;
      if (profit !== null) { totalProfit += profit; hasAnyCostData = true; }

      totalSales += total;
      totalDiscount += Number(inv.discount_amount || 0);
      totalVat += Number(inv.vat_amount || 0);
      if (inv.status === "cancelled") { cancelledCount++; cancelledAmount += total; }
      else {
        activeCount++; activeAmount += total;
        totalPaid += paid; totalRemaining += remaining;
      }

      return { inv, items, paid, remaining, profit, cost, hasCost };
    });

    const marginPct = hasAnyCostData && totalSales > 0 ? (totalProfit / totalSales) * 100 : null;

    // ---- Build HTML ----
    const cards = summaryCardsHtml([
      { label: "إجمالي المبيعات", value: fmtEGP(totalSales), color: "#2b6cb0" },
      { label: "عدد الفواتير", value: fmtNum(input.invoices.length) },
      { label: "إجمالي الربح", value: hasAnyCostData ? fmtEGP(totalProfit) : "غير متاح", color: hasAnyCostData ? (totalProfit >= 0 ? "#276749" : "#c53030") : "#4a5568" },
      { label: "إجمالي المحصّل", value: fmtEGP(totalPaid), color: "#276749" },
      { label: "إجمالي المتبقي", value: fmtEGP(totalRemaining), color: totalRemaining > 0 ? "#c05621" : "#276749" },
      { label: "هامش الربح", value: marginPct !== null ? fmtPct(marginPct) : "غير متاح", color: marginPct !== null ? (marginPct >= 0 ? "#276749" : "#c53030") : "#4a5568" },
    ]);

    const invoiceRowsHtml = invRows
      .map((r, i) => {
        const cancelled = r.inv.status === "cancelled";
        const bg = cancelled ? "#fed7d7" : i % 2 === 0 ? "#ffffff" : "#f7fafc";
        const textColor = cancelled ? "#c53030" : "#1a202c";
        const remainingColor = r.remaining > 0 ? "#c05621" : textColor;
        const profitStr = r.profit === null ? "غير متاح" : fmtEGP(r.profit);
        const profitColor = r.profit === null ? "#4a5568" : r.profit >= 0 ? "#276749" : "#c53030";
        const marginStr = r.profit === null ? "—" : fmtPct(Number(r.inv.total) > 0 ? (r.profit / Number(r.inv.total)) * 100 : 0);
        const statusLabel = cancelled ? "ملغاة" : "نشطة";

        const linesHtml = r.items.length
          ? `<tr style="background:${bg};"><td colspan="10" style="padding:0 0 0 24px;border:0;">
              <table style="width:100%;border-collapse:collapse;margin:0;table-layout:fixed;">
                <colgroup>
                  <col style="width:26%" />
                  <col style="width:7%" />
                  <col style="width:11%" />
                  <col style="width:9%" />
                  <col style="width:12%" />
                  <col style="width:11%" />
                  <col style="width:12%" />
                  <col style="width:12%" />
                </colgroup>
                <thead>
                  <tr style="background:#e2e8f0;color:#1a202c;font-size:9px;">
                    <th style="padding:5px 6px;border:0.5px solid #a0aec0;text-align:right;">اسم الصنف</th>
                    <th style="padding:5px 6px;border:0.5px solid #a0aec0;">كمية</th>
                    <th style="padding:5px 6px;border:0.5px solid #a0aec0;">سعر الوحدة</th>
                    <th style="padding:5px 6px;border:0.5px solid #a0aec0;">خصم</th>
                    <th style="padding:5px 6px;border:0.5px solid #a0aec0;">الإجمالي</th>
                    <th style="padding:5px 6px;border:0.5px solid #a0aec0;">التكلفة</th>
                    <th style="padding:5px 6px;border:0.5px solid #a0aec0;">الربح</th>
                    <th style="padding:5px 6px;border:0.5px solid #a0aec0;">هامش%</th>
                  </tr>
                </thead>
                <tbody>
                  ${r.items
                    .map((it) => {
                      const q = Number(it.quantity || 0);
                      const up = Number(it.selling_price || 0);
                      const disc = Number(it.line_discount || 0);
                      const tot = Number(it.total || 0);
                      const uc = Number(it.unit_cost_at_sale || it.cost_price || 0);
                      const lineCost = uc * q;
                      const noCost = r.inv.is_migrated && uc === 0;
                      const lineProfit = noCost ? null : tot - lineCost;
                      const lineMargin = lineProfit === null ? null : (tot > 0 ? (lineProfit / tot) * 100 : 0);
                      const lpColor = lineProfit === null ? "#4a5568" : lineProfit >= 0 ? "#276749" : "#c53030";
                      return `<tr style="font-size:9px;color:#2d3748;">
                        <td style="padding:4px 6px;border:0.5px solid #cbd5e0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.product_name ?? "—"}</td>
                        <td style="padding:4px 6px;border:0.5px solid #cbd5e0;text-align:center;white-space:nowrap;">${fmtNum(q)}</td>
                        <td style="padding:4px 6px;border:0.5px solid #cbd5e0;text-align:center;white-space:nowrap;">${fmtEGP(up)}</td>
                        <td style="padding:4px 6px;border:0.5px solid #cbd5e0;text-align:center;white-space:nowrap;">${fmtEGP(disc)}</td>
                        <td style="padding:4px 6px;border:0.5px solid #cbd5e0;text-align:center;font-weight:700;white-space:nowrap;">${fmtEGP(tot)}</td>
                        <td style="padding:4px 6px;border:0.5px solid #cbd5e0;text-align:center;white-space:nowrap;">${noCost ? "غير متاح" : fmtEGP(lineCost)}</td>
                        <td style="padding:4px 6px;border:0.5px solid #cbd5e0;text-align:center;color:${lpColor};font-weight:700;white-space:nowrap;">${lineProfit === null ? "غير متاح" : fmtEGP(lineProfit)}</td>
                        <td style="padding:4px 6px;border:0.5px solid #cbd5e0;text-align:center;color:${lpColor};white-space:nowrap;">${lineMargin === null ? "—" : fmtPct(lineMargin)}</td>
                      </tr>`;
                    })
                    .join("")}
                </tbody>
              </table>
            </td></tr>`
          : "";

        return `
          <tr style="background:${bg};color:${textColor};font-size:10px;">
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;font-family:monospace;white-space:nowrap;">${r.inv.invoice_number ?? "—"}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;white-space:nowrap;">${fmtDate(r.inv.invoice_date || r.inv.created_at)}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.inv.contacts?.name ?? "عميل نقدي"}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;white-space:nowrap;">${PAY_LABELS[r.inv.payment_method] ?? r.inv.payment_method ?? "—"}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;font-weight:700;white-space:nowrap;">${fmtEGP(r.inv.total)}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;white-space:nowrap;">${fmtEGP(r.paid)}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;color:${remainingColor};font-weight:${r.remaining > 0 ? 700 : 400};white-space:nowrap;">${fmtEGP(r.remaining)}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;color:${profitColor};font-weight:700;white-space:nowrap;">${profitStr}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;color:${profitColor};white-space:nowrap;">${marginStr}</td>
            <td style="padding:7px 6px;border:0.5px solid #a0aec0;text-align:center;font-weight:700;white-space:nowrap;">${statusLabel}</td>
          </tr>
          ${linesHtml}
        `;
      })
      .join("");

    const tableHtml = `
      <div style="font-weight:800;font-size:13px;color:#1a202c;text-decoration:underline;margin-bottom:6px;">تفاصيل الفواتير</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;table-layout:fixed;">
        <colgroup>
          <col style="width:9%" />
          <col style="width:8%" />
          <col style="width:15%" />
          <col style="width:9%" />
          <col style="width:10%" />
          <col style="width:10%" />
          <col style="width:10%" />
          <col style="width:10%" />
          <col style="width:8%" />
          <col style="width:7%" />
        </colgroup>
        <thead>
          <tr style="background:#2d3748;color:#ffffff;font-size:10px;">
            <th style="padding:8px 4px;border:2px solid #2d3748;">رقم الفاتورة</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">التاريخ</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">العميل</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">طريقة الدفع</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">الإجمالي</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">المدفوع</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">المتبقي</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">الربح</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">هامش%</th>
            <th style="padding:8px 4px;border:2px solid #2d3748;">الحالة</th>
          </tr>
        </thead>
        <tbody>${invoiceRowsHtml || `<tr><td colspan="10" style="text-align:center;padding:20px;">لا توجد فواتير</td></tr>`}</tbody>
      </table>
    `;

    const totalsRows: string[] = [];
    const addTotal = (label: string, value: string, color?: string) =>
      totalsRows.push(`<div style="display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #cbd5e0;font-size:11px;">
        <span style="color:#4a5568;">${label}</span>
        <span style="font-weight:700;color:${color ?? "#1a202c"};">${value}</span>
      </div>`);

    addTotal("الفواتير النشطة", `${fmtNum(activeCount)} فاتورة — ${fmtEGP(activeAmount)}`, "#276749");
    addTotal("الفواتير الملغاة", `${fmtNum(cancelledCount)} فاتورة — ${fmtEGP(cancelledAmount)}`, "#c53030");
    addTotal("إجمالي المبيعات", fmtEGP(totalSales));
    addTotal("إجمالي الخصومات", fmtEGP(totalDiscount), "#c05621");
    addTotal("إجمالي ض.ق.م", fmtEGP(totalVat));
    Object.entries(paidMethodTotals).forEach(([k, v]) => {
      addTotal(`محصّل — ${PAY_LABELS[k] ?? k}`, fmtEGP(v), "#276749");
    });
    addTotal("إجمالي المتبقي", fmtEGP(totalRemaining), totalRemaining > 0 ? "#c05621" : "#276749");
    if (hasAnyCostData) {
      addTotal("إجمالي الربح الصافي", fmtEGP(totalProfit), totalProfit >= 0 ? "#276749" : "#c53030");
      if (marginPct !== null) addTotal("هامش الربح الإجمالي", fmtPct(marginPct), marginPct >= 0 ? "#276749" : "#c53030");
    } else {
      addTotal("إجمالي الربح الصافي", "غير متاح (كل الفواتير مستوردة بدون بيانات تكلفة)", "#4a5568");
    }

    const totalsHtml = `
      <div style="border-top:2px solid #2d3748;padding-top:10px;margin-top:6px;">
        <div style="font-weight:800;font-size:13px;color:#1a202c;text-decoration:underline;margin-bottom:6px;">الإجماليات النهائية</div>
        <div style="border:1.5px solid #2d3748;border-radius:6px;overflow:hidden;background:#f7fafc;">${totalsRows.join("")}</div>
      </div>
    `;

    const header = headerHtml({
      tenantName, tenantLogo, branchName: input.branchName,
      title: "تقرير تفصيلي بالمبيعات", fromDate: input.filters.from, toDate: input.filters.to,
      userName: input.userName,
    });

    // A4 landscape: 297mm × 210mm → at 96dpi ≈ 1123 × 794 px
    const container = document.createElement("div");
    container.style.cssText = `
      position:fixed;left:-99999px;top:0;width:1123px;padding:40px 40px 40px 40px;
      background:#ffffff;color:#1a202c;font-family:'Cairo','Segoe UI','Tahoma',sans-serif;
      direction:rtl;text-align:right;box-sizing:border-box;
    `;
    container.innerHTML = header + cards + tableHtml + totalsHtml;
    document.body.appendChild(container);

    // Render → PDF
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    document.body.removeChild(container);

    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const footerH = 22;
    const usableH = pageH - margin * 2 - footerH;
    const imgW = pageW - margin * 2;
    const ratio = canvas.width / imgW;
    const pageCanvasH = usableH * ratio;
    const totalPages = Math.max(1, Math.ceil(canvas.height / pageCanvasH));
    const ts = fmtDateTime(new Date().toISOString());

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
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, imgW, imgH);

      // Footer line + text
      pdf.setDrawColor(45, 55, 72);
      pdf.setLineWidth(1.5);
      pdf.line(margin, pageH - footerH - 4, pageW - margin, pageH - footerH - 4);
      pdf.setFontSize(9);
      pdf.setTextColor(74, 85, 104);
      pdf.text(`Page ${i + 1} / ${totalPages}  |  ${tenantName}  |  ${ts}`, pageW / 2, pageH - 10, { align: "center" });
    }

    const fromStr = input.filters.from || "الكل";
    const toStr = input.filters.to || "الكل";
    pdf.save(`فواتير-البيع-${input.branchName}-${fromStr}-${toStr}.pdf`);
    toast.dismiss(t2);
    toast.success("✅ تم إنشاء التقرير بنجاح");
  } catch (e: any) {
    console.error("[generateSalesReport]", e);
    toast.dismiss();
    toast.error(`❌ حدث خطأ: ${e?.message ?? "غير معروف"}`);
  }
}
