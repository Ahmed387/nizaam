/**
 * «ابعت للعميل واتساب» (owner 2026-11-16 «نفذ»): the invoice text is written by the system and WhatsApp opens on the
 * cashier's own phone / computer on the customer's chat (wa.me link) — the cashier presses «إرسال». Free, no WhatsApp
 * Business account, nothing is sent by the server.
 */

const AR_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

/** One number in international form without «+» (2010…), or null. */
function onePhone(raw: string): string | null {
  let d = raw.replace(/[٠-٩]/g, (c) => AR_DIGITS[c]).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^01[0125]\d{8}$/.test(d)) return "2" + d;          // 010xxxxxxxx → 2010xxxxxxxx
  if (/^1[0125]\d{8}$/.test(d)) return "20" + d;           // 10xxxxxxxx
  if (/^201[0125]\d{8}$/.test(d)) return d;                // 2010xxxxxxxx
  if (/^\d{10,15}$/.test(d) && !d.startsWith("0")) return d; // another country, already international
  return null;
}

/** An Egyptian mobile in international form without «+» (2010…), or null when there is no usable number. A field with
 *  two numbers («0100… / 0111…», a landline and a mobile) gives the first mobile. */
export function waPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const whole = onePhone(String(raw));
  if (whole) return whole;
  for (const part of String(raw).split(/[\/\-,،;|\n]+|\s{2,}/)) {
    const p = onePhone(part);
    if (p) return p;
  }
  return null;
}

const n = (v: number) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface SaleMessageInput {
  customer: string | null;
  number: string;
  branch: string | null;
  date: string; // already formatted dd/mm/yyyy
  items: { name: string; quantity: number; total: number }[];
  total: number;
  paid: number;
  remaining: number;
  company?: string | null;
}

export function saleMessage(m: SaleMessageInput): string {
  const lines: string[] = [];
  lines.push(m.customer ? `السلام عليكم أ/ ${m.customer}` : "السلام عليكم");
  lines.push(`فاتورة رقم ${m.number}${m.branch ? ` — ${m.branch}` : ""} — ${m.date}`);
  const shown = m.items.slice(0, 15);
  for (const it of shown) lines.push(`• ${it.name} × ${n(it.quantity)} = ${n(it.total)}`);
  if (m.items.length > shown.length) lines.push(`• (+${m.items.length - shown.length} أصناف كمان)`);
  lines.push(`الإجمالي: ${n(m.total)}`);
  lines.push(`المدفوع: ${n(m.paid)}`);
  lines.push(m.remaining > 0.009 ? `الباقي عليك: ${n(m.remaining)}` : "الفاتورة مدفوعة بالكامل ✅");
  lines.push(`شكرًا لتعاملك معانا${m.company ? ` — ${m.company}` : ""}`);
  return lines.join("\n");
}

export const waLink = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
