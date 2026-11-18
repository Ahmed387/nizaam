// One document as an A4 PDF for the company's Telegram group (migration 0268, owner 2026-11-18 «تضيف السند مع الفاتورة
// وترسلو في pdf مرة واحده»): header, the document's lines, its totals, and the vouchers saved WITH it (its payment /
// refund) — so one file per sale / purchase / return; a voucher on its own gets its own file.
// pdf-lib and fontkit are passed in like report.ts; every line is drawn right to left with `rtlPieces`.
import { rtlPieces, money, dayText, timeText } from "./format.ts";
import type { DocPayload } from "./format.ts";

export async function buildDocPdf(lib: any, fontkit: any, fonts: { regular: Uint8Array; bold: Uint8Array }, p: DocPayload): Promise<Uint8Array> {
  const { PDFDocument, rgb } = lib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  doc.setTitle(`${p.title} ${p.number ?? ""}`);

  const W = 595.28, H = 841.89, M = 36, RIGHT = W - M, LEFT = M;
  const ink = rgb(0.06, 0.17, 0.25), muted = rgb(0.42, 0.48, 0.53), accent = rgb(0.06, 0.46, 0.43), soft = rgb(0.9, 0.96, 0.95), line = rgb(0.88, 0.91, 0.93);
  let page = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;

  const width = (t: string, f: any, s: number) => rtlPieces(t).reduce((w, x) => w + f.widthOfTextAtSize(x, s), 0);
  const textR = (t: string, x: number, yy: number, f: any, s: number, color = ink) => {
    let cx = x;
    for (const piece of rtlPieces(t)) { const w = f.widthOfTextAtSize(piece, s); cx -= w; page.drawText(piece, { x: cx, y: yy, size: s, font: f, color }); }
  };
  const textL = (t: string, x: number, yy: number, f: any, s: number, color = ink) => textR(t, x + width(t, f, s), yy, f, s, color);
  const footer = () => textL(`صفحة ${pageNo} — ${p.title} ${p.number ?? ""} — ${p.company ?? ""}`, LEFT, 18, reg, 8, muted);
  const newPage = () => { footer(); page = doc.addPage([W, H]); pageNo++; y = H - M; };
  const need = (h: number) => { if (y - h < 44) newPage(); };
  const fit = (s: string, f: any, size: number, w: number) => {
    let out = s;
    while (out.length > 1 && width(out, f, size) > w - 6) out = out.slice(0, -1);
    return out === s ? s : out + "…";
  };
  const wrap = (t: string, f: any, s: number, maxW: number): string[] => {
    const out: string[] = []; let cur = "";
    for (const w of t.split(/\s+/)) { const next = cur ? cur + " " + w : w; if (width(next, f, s) <= maxW || !cur) cur = next; else { out.push(cur); cur = w; } }
    if (cur) out.push(cur);
    return out;
  };
  const para = (t: string, f: any, s: number, color = ink) => {
    for (const l of wrap(t, f, s, RIGHT - LEFT)) { need(s + 4); textR(l, RIGHT, y - s, f, s, color); y -= s + 4; }
  };
  /** a table: columns right to left; numeric columns drawn from the left edge of their cell */
  const table = (cols: { title: string; w: number; num?: boolean }[], rows: string[][]) => {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const k = (RIGHT - LEFT) / total;
    const ws = cols.map((c) => c.w * k);
    const row = (vals: string[], f: any, size: number, color = ink, bg?: any) => {
      need(size + 9);
      if (bg) page.drawRectangle({ x: LEFT, y: y - size - 6, width: RIGHT - LEFT, height: size + 8, color: bg });
      let x = RIGHT;
      vals.forEach((v, i) => {
        const txt = fit(v ?? "", f, size, ws[i]);
        if (cols[i].num) textL(txt, x - ws[i] + 4, y - size, f, size, color); else textR(txt, x - 4, y - size, f, size, color);
        x -= ws[i];
      });
      y -= size + 8;
      page.drawLine({ start: { x: LEFT, y: y + 1 }, end: { x: RIGHT, y: y + 1 }, thickness: 0.4, color: line });
    };
    row(cols.map((c) => c.title), bold, 9, muted, soft);
    for (const r of rows) row(r, reg, 10);
  };

  // ---- header
  page.drawRectangle({ x: LEFT, y: y - 52, width: RIGHT - LEFT, height: 52, color: soft });
  textR(`${p.title} ${p.number ?? ""}`, RIGHT - 10, y - 24, bold, 17, accent);
  textR(`${p.company ?? ""} — ${p.branch ?? ""}`, RIGHT - 10, y - 42, reg, 10, muted);
  if (p.event === "cancel") textL("ملغي", LEFT + 10, y - 26, bold, 16, rgb(0.75, 0.1, 0.1));
  y -= 64;

  const isVoucher = p.doc_type === "receipt" || p.doc_type === "payment";
  const info: [string, string][] = [
    ["التاريخ", `${dayText(p.date)}${p.created_at ? " — اتسجل " + timeText(p.created_at) : ""}`],
    ["الحساب", p.party ?? "—"],
    ["الموظف", p.employee ?? "—"],
  ];
  if (p.recipient) info.push(["المستلم", p.recipient]);
  if (p.extra?.on_invoice) info.push(["على فاتورة", String(p.extra.on_invoice)]);
  if (isVoucher) {
    if (p.extra?.category) info.push(["البند", String(p.extra.category)]);
    info.push(["طريقة الدفع", String(p.extra?.method ?? "—")]);
    if (Number(p.extra?.fee ?? 0) > 0) info.push(["العمولة", money(p.extra?.fee)]);
    if (p.extra?.description) info.push(["البيان", String(p.extra.description)]);
  }
  for (const [k, v] of info) {
    need(16);
    textR(`${k}:`, RIGHT, y - 11, bold, 10, muted);
    for (const [i, l] of wrap(v, reg, 11, RIGHT - LEFT - 90).entries()) { if (i) { y -= 15; need(16); } textR(l, RIGHT - 85, y - 11, reg, 11, ink); }
    y -= 17;
  }
  y -= 6;

  if (isVoucher) {
    need(40);
    page.drawRectangle({ x: LEFT, y: y - 34, width: RIGHT - LEFT, height: 34, color: soft });
    textR("المبلغ", RIGHT - 10, y - 22, bold, 12, muted);
    textL(money(p.total), LEFT + 10, y - 24, bold, 18, accent);
    y -= 46;
  } else {
    // ---- lines
    table([{ title: "#", w: 4, num: true }, { title: "الصنف", w: 52 }, { title: "الكمية", w: 10, num: true }, { title: "السعر", w: 16, num: true }, { title: "الإجمالي", w: 18, num: true }],
      (p.lines ?? []).map((l, i) => [String(i + 1), l.name ?? "—", money(l.qty), l.price == null ? "—" : money(l.price), money(l.total)]));
    y -= 6;
    // ---- totals
    const totals: [string, number][] = [];
    const ex = p.extra ?? {};
    if (Number(ex.subtotal ?? 0) > 0 && Number(ex.subtotal) !== Number(p.total)) totals.push(["قبل الخصم والضريبة", Number(ex.subtotal)]);
    if (Number(ex.discount ?? 0) > 0) totals.push(["الخصم", Number(ex.discount)]);
    if (Number(ex.vat ?? 0) > 0) totals.push(["الضريبة", Number(ex.vat)]);
    if (Number(ex.extra_costs ?? 0) > 0) totals.push(["مصاريف إضافية", Number(ex.extra_costs)]);
    for (const [k, v] of totals) { need(15); textR(k, RIGHT, y - 10, reg, 10, muted); textL(money(v), LEFT, y - 10, reg, 10, ink); y -= 15; }
    need(30);
    page.drawRectangle({ x: LEFT, y: y - 26, width: RIGHT - LEFT, height: 26, color: soft });
    textR("الإجمالي", RIGHT - 8, y - 18, bold, 12, ink);
    textL(money(p.total), LEFT + 8, y - 19, bold, 14, accent);
    y -= 36;

    // ---- the money saved with it (its own vouchers)
    const pays = (p.payments ?? []).filter((x) => x.status !== "cancelled");
    need(24);
    textR(pays.length ? "الفلوس اللي اتسجلت معاه" : "مفيش فلوس اتسجلت معاه (آجل)", RIGHT, y - 12, bold, 11, accent);
    y -= 20;
    if (pays.length) {
      table([{ title: "رقم السند", w: 22 }, { title: "النوع", w: 22 }, { title: "طريقة الدفع", w: 30 }, { title: "المبلغ", w: 26, num: true }],
        pays.map((x) => [x.number, x.type === "receipt" ? "سند قبض" : "سند صرف", x.method, money(x.amount)]));
      const sum = pays.reduce((s, x) => s + Number(x.amount || 0), 0);
      const rest = Number(p.total ?? 0) - sum;
      if (p.doc_type === "sale" && rest > 0.009) { need(16); textR(`الباقي آجل على الحساب: ${money(rest)}`, RIGHT, y - 11, bold, 10, ink); y -= 16; }
    }
  }

  if (p.notes) { y -= 6; need(20); textR("ملاحظات:", RIGHT, y - 11, bold, 10, muted); y -= 16; para(p.notes, reg, 10); }
  if (p.event === "cancel" && p.cancel) {
    y -= 6; need(36);
    para(`اتلغى — السبب: ${p.cancel.reason || "—"} — ألغاه: ${p.cancel.by} — ${dayText(p.cancel.at)} ${timeText(p.cancel.at)}`, bold, 10, rgb(0.75, 0.1, 0.1));
  }
  footer();
  return await doc.save();
}
