// The daily activity report as an A4 PDF (owner 2026-11-16: «PDF … مقسوم بالفرع … بالعربي»).
// pdf-lib and fontkit are passed in (Deno: npm: imports in index.ts; Node: the test script), so this file has no imports
// but format.ts. Every line is drawn right to left in pieces (`rtlPieces`): fontkit shapes the Arabic ones.
import { rtlPieces, money, timeText, dayTitle, docSummary, pagesSummary, entityLabel, auditActLabel, docLabel, actLabel } from "./format.ts";
import type { ReportUser } from "./format.ts";

export interface DailyReport {
  company: string; day: string; totals: any;
  branches: { branch: string; users: ReportUser[] }[];
}

export async function buildReportPdf(lib: any, fontkit: any, fonts: { regular: Uint8Array; bold: Uint8Array }, r: DailyReport): Promise<Uint8Array> {
  const { PDFDocument, rgb } = lib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  doc.setTitle(`تقرير نشاط ${r.day}`);

  const W = 595.28, H = 841.89, M = 36, RIGHT = W - M, LEFT = M;
  const ink = rgb(0.06, 0.17, 0.25), muted = rgb(0.42, 0.48, 0.53), accent = rgb(0.06, 0.46, 0.43), soft = rgb(0.9, 0.96, 0.95), line = rgb(0.88, 0.91, 0.93);
  let page = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;

  const width = (t: string, f: any, s: number) => rtlPieces(t).reduce((w, p) => w + f.widthOfTextAtSize(p, s), 0);
  const textR = (t: string, x: number, yy: number, f: any, s: number, color = ink) => {
    let cx = x;
    for (const p of rtlPieces(t)) {
      const w = f.widthOfTextAtSize(p, s);
      cx -= w;
      page.drawText(p, { x: cx, y: yy, size: s, font: f, color });
    }
  };
  const textL = (t: string, x: number, yy: number, f: any, s: number, color = ink) => textR(t, x + width(t, f, s), yy, f, s, color);
  const footer = () => textL(`صفحة ${pageNo} — ${dayTitle(r.day)} — ${r.company}`, LEFT, 18, reg, 8, muted);
  const newPage = () => { footer(); page = doc.addPage([W, H]); pageNo++; y = H - M; };
  const need = (h: number) => { if (y - h < 40) newPage(); };

  // wrap a paragraph into lines that fit `maxW` (by words)
  const wrap = (t: string, f: any, s: number, maxW: number): string[] => {
    const words = t.split(/\s+/);
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (width(next, f, s) <= maxW || !cur) cur = next; else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out;
  };
  const para = (t: string, f: any, s: number, color = ink, indent = 0) => {
    for (const l of wrap(t, f, s, RIGHT - LEFT - indent)) { need(s + 4); textR(l, RIGHT - indent, y - s, f, s, color); y -= s + 4; }
  };

  // ---- header
  page.drawRectangle({ x: LEFT, y: y - 46, width: RIGHT - LEFT, height: 46, color: soft });
  textR(`تقرير نشاط يوم ${dayTitle(r.day)}`, RIGHT - 10, y - 22, bold, 16, accent);
  textR(r.company, RIGHT - 10, y - 38, reg, 10, muted);
  y -= 58;
  const t = r.totals ?? {};
  para(`${t.users ?? 0} مستخدم دخلوا — ${t.documents ?? 0} مستند جديد — ${t.sales_n ?? 0} فاتورة بيع بإجمالي ${money(t.sales_total)} — ${t.cancels ?? 0} إلغاء — ${t.edits ?? 0} تعديل`, reg, 10, ink);
  y -= 6;

  // columns of the movements table (right to left)
  const cols = [
    { title: "الوقت", w: 52 }, { title: "الحركة", w: 150 }, { title: "الرقم", w: 72 }, { title: "الحساب", w: 150 }, { title: "المبلغ", w: 0 },
  ];
  cols[4].w = (RIGHT - LEFT) - cols.slice(0, 4).reduce((s, c) => s + c.w, 0);
  const fit = (s: string, f: any, size: number, w: number) => {
    let out = s;
    while (out.length > 1 && width(out, f, size) > w - 6) out = out.slice(0, -1);
    return out === s ? s : out + "…";
  };
  const row = (vals: string[], f: any, size: number, color = ink, bg?: any) => {
    need(size + 8);
    if (bg) page.drawRectangle({ x: LEFT, y: y - size - 5, width: RIGHT - LEFT, height: size + 7, color: bg });
    let x = RIGHT;
    vals.forEach((v, i) => {
      const c = cols[i];
      const txt = fit(v ?? "", f, size, c.w);
      if (i === 4) textL(txt, x - c.w + 3, y - size, f, size, color);
      else textR(txt, x - 3, y - size, f, size, color);
      x -= c.w;
    });
    y -= size + 7;
  };

  for (const b of r.branches ?? []) {
    need(60);
    y -= 4;
    page.drawRectangle({ x: LEFT, y: y - 22, width: RIGHT - LEFT, height: 22, color: accent });
    textR(b.branch, RIGHT - 8, y - 16, bold, 12, rgb(1, 1, 1));
    y -= 30;

    for (const u of b.users ?? []) {
      need(50);
      textR(u.name, RIGHT, y - 12, bold, 12, ink);
      const when = `أول نشاط ${timeText(u.first_at)} — آخر نشاط ${timeText(u.last_at)}`;
      textL(when, LEFT, y - 11, reg, 9, muted);
      y -= 18;
      page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.5, color: line });
      y -= 6;

      if (u.docs?.length) {
        para("عمل:", bold, 10, accent);
        for (const d of u.docs) para("• " + docSummary(d), reg, 10, ink, 8);
      }
      if (u.items?.length) {
        y -= 2;
        row(cols.map((c) => c.title), bold, 9, muted, soft);
        for (const it of u.items) {
          row([timeText(it.at), `${actLabel(it.action)} ${docLabel(it.doc_type)}`, it.number ?? "—", it.party ?? "—",
               it.amount != null ? money(it.amount) : "—"], reg, 9);
        }
        if (u.items_total > u.items.length) para(`و ${u.items_total - u.items.length} حركة كمان`, reg, 9, muted, 8);
        y -= 2;
      }
      if (u.other?.length) {
        para("تغييرات تانية:", bold, 10, accent);
        para(u.other.map((o) => `${auditActLabel(o.action)} ${entityLabel(o.entity)} (${o.n})`).join("، "), reg, 10, ink, 8);
      }
      if (u.pages?.length) {
        para("فتح الصفحات:", bold, 10, accent);
        para(pagesSummary(u.pages), reg, 10, ink, 8);
      }
      if (!u.docs?.length && !u.other?.length && !u.pages?.length) para("دخل السيستم بس", reg, 10, muted, 8);
      y -= 10;
    }
  }
  footer();
  return await doc.save();
}
