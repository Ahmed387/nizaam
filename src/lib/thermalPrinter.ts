// Thermal printer (ESC/POS) helpers
// Two modes:
//  1) printThermalReceipt(html, widthMm) — opens a system print dialog sized for 58mm/80mm rolls.
//     Works on any browser with a thermal printer driver installed (USB/Network).
//  2) printViaBluetoothESCPOS(bytes) — sends raw ESC/POS commands to a BLE thermal printer via Web Bluetooth.
//     Works on Chrome (Android/Desktop). Requires a BLE-capable thermal printer.

import { toast } from "sonner";

// ============================================================
// 1) Browser print (driver-based) — formatted for 58/80mm rolls
// ============================================================

export interface ThermalReceiptData {
  storeName: string;
  storePhone?: string;
  storeAddress?: string;
  invoiceNumber: string;
  dateTime: string;
  cashier?: string;
  customer?: string;
  customerPhone?: string;
  items: { name: string; qty: number; price: number; discount?: number }[];
  subtotal: number;
  discount?: number;
  total: number;
  payments?: { method: string; amount: number; ref?: string }[];
  footer?: string;
}

const fmtEGP = (n: number) => `${(Number(n) || 0).toFixed(2)} ج`;

export function printThermalReceipt(d: ThermalReceiptData, widthMm: 58 | 80 = 80) {
  const pageWidth = widthMm;
  const fontSize = widthMm === 58 ? "11px" : "12px";
  const w = window.open("", "_blank", `width=${widthMm * 4},height=720`);
  if (!w) {
    toast.error("فعّل النوافذ المنبثقة للطباعة");
    return;
  }
  const itemsRows = d.items.map((it) => {
    const lineTotal = it.qty * it.price - (it.discount ?? 0);
    return `
      <tr>
        <td colspan="3" class="name">${escapeHtml(it.name)}</td>
      </tr>
      <tr>
        <td class="qty">${it.qty} × ${fmtEGP(it.price)}</td>
        <td class="disc">${it.discount ? `- ${fmtEGP(it.discount)}` : ""}</td>
        <td class="tot">${fmtEGP(lineTotal)}</td>
      </tr>`;
  }).join("");

  const paymentsRows = (d.payments ?? []).map((p) =>
    `<div class="row"><span>${escapeHtml(p.method)}${p.ref ? ` (${escapeHtml(p.ref)})` : ""}</span><span>${fmtEGP(p.amount)}</span></div>`
  ).join("");

  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head>
<meta charset="utf-8"><title>إيصال ${escapeHtml(d.invoiceNumber)}</title>
<style>
  @page { size: ${pageWidth}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { width: ${pageWidth}mm; font-family: "Tahoma", "Arial", sans-serif; font-size: ${fontSize}; color: #000; padding: 4mm 3mm; }
  h1 { text-align: center; margin: 0 0 4px; font-size: 14px; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 10px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; font-size: ${fontSize}; }
  td.name { font-weight: bold; }
  td.qty { color: #333; font-size: 10px; }
  td.disc { text-align: center; font-size: 10px; color: #b00; }
  td.tot { text-align: left; font-weight: bold; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; }
  .total { font-size: 15px; font-weight: 900; }
  .footer { text-align: center; margin-top: 6px; font-size: 10px; }
</style></head><body>
  <h1>${escapeHtml(d.storeName)}</h1>
  ${d.storeAddress ? `<div class="center muted">${escapeHtml(d.storeAddress)}</div>` : ""}
  ${d.storePhone ? `<div class="center muted" dir="ltr">${escapeHtml(d.storePhone)}</div>` : ""}
  <hr>
  <div class="row"><span>فاتورة</span><span dir="ltr">${escapeHtml(d.invoiceNumber)}</span></div>
  <div class="row muted"><span>التاريخ</span><span>${escapeHtml(d.dateTime)}</span></div>
  ${d.cashier ? `<div class="row muted"><span>الكاشير</span><span>${escapeHtml(d.cashier)}</span></div>` : ""}
  ${d.customer ? `<div class="row muted"><span>العميل</span><span>${escapeHtml(d.customer)}</span></div>` : ""}
  ${d.customerPhone ? `<div class="row muted"><span>تليفون</span><span dir="ltr">${escapeHtml(d.customerPhone)}</span></div>` : ""}
  <hr>
  <table>${itemsRows}</table>
  <hr>
  <div class="row"><span>الإجمالي قبل الخصم</span><span>${fmtEGP(d.subtotal)}</span></div>
  ${d.discount ? `<div class="row"><span>الخصم</span><span>- ${fmtEGP(d.discount)}</span></div>` : ""}
  <div class="row total"><span>الإجمالي</span><span>${fmtEGP(d.total)}</span></div>
  ${paymentsRows ? `<hr>${paymentsRows}` : ""}
  <hr>
  <div class="footer">${escapeHtml(d.footer ?? "شكراً لتعاملكم معنا")}</div>
  <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),400);}</script>
</body></html>`);
  w.document.close();
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ============================================================
// 2) Web Bluetooth ESC/POS — for BLE thermal printers
// ============================================================
// Common BLE thermal printer service / characteristic UUIDs.
// We try several to cover the most common Chinese 58mm BLE printers.

const KNOWN_SERVICES = [
  0x18f0, // Common thermal service
  "000018f0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC/Microchip RN4870
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb", // HM-10 modules
];
const KNOWN_WRITE_CHARS = [
  0x2af1,
  "00002af1-0000-1000-8000-00805f9b34fb",
  "49535343-8841-43f4-a8d4-ecbe34729bb3",
  "0000ff02-0000-1000-8000-00805f9b34fb",
  "0000ffe1-0000-1000-8000-00805f9b34fb",
];

interface BTConnection {
  device: any;
  characteristic: any;
}

let btConn: BTConnection | null = null;

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}

export async function connectThermalBluetooth(): Promise<BTConnection> {
  if (!isWebBluetoothSupported()) {
    throw new Error("المتصفح لا يدعم Web Bluetooth — استخدم Chrome على أندرويد/ويندوز");
  }
  const bt = (navigator as any).bluetooth;
  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: KNOWN_SERVICES,
  });
  const server = await device.gatt.connect();
  // try services in order
  let writeChar: any = null;
  for (const svcUuid of KNOWN_SERVICES) {
    try {
      const svc = await server.getPrimaryService(svcUuid as any);
      const chars = await svc.getCharacteristics();
      writeChar = chars.find((c: any) => c.properties.writeWithoutResponse || c.properties.write);
      if (writeChar) break;
      for (const cUuid of KNOWN_WRITE_CHARS) {
        try {
          const c = await svc.getCharacteristic(cUuid as any);
          if (c) { writeChar = c; break; }
        } catch {}
      }
      if (writeChar) break;
    } catch {}
  }
  if (!writeChar) throw new Error("لم يتم العثور على خاصية كتابة في الطابعة");
  btConn = { device, characteristic: writeChar };
  device.addEventListener?.("gattserverdisconnected", () => { btConn = null; });
  return btConn;
}

export function disconnectThermalBluetooth() {
  try { btConn?.device?.gatt?.disconnect?.(); } catch {}
  btConn = null;
}

export function getBluetoothConnection(): BTConnection | null {
  return btConn;
}

async function writeChunks(characteristic: any, bytes: Uint8Array) {
  // BLE MTU is small — chunk at 180 bytes to be safe
  const CHUNK = 180;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.slice(i, i + CHUNK);
    try {
      await characteristic.writeValueWithoutResponse(slice);
    } catch {
      await characteristic.writeValue(slice);
    }
  }
}

export async function printRawESCPOS(bytes: Uint8Array) {
  if (!btConn) await connectThermalBluetooth();
  if (!btConn) throw new Error("لم يتم الاتصال بالطابعة");
  await writeChunks(btConn.characteristic, bytes);
}

// Build ESC/POS bytes for a receipt
// Note: Arabic text rendering over raw ESC/POS depends on the printer's code page.
// Many small BLE printers do NOT support Arabic glyphs and will print boxes.
// For Arabic-only stores prefer printThermalReceipt() (driver/browser print).
export function buildESCPOSReceipt(d: ThermalReceiptData): Uint8Array {
  const enc = new TextEncoder();
  const out: number[] = [];
  const push = (arr: number[] | Uint8Array) => out.push(...Array.from(arr));
  const text = (s: string) => push(enc.encode(s));

  // init
  push([0x1b, 0x40]);
  // center
  push([0x1b, 0x61, 0x01]);
  // double height/width for store name
  push([0x1d, 0x21, 0x11]);
  text(d.storeName + "\n");
  push([0x1d, 0x21, 0x00]);
  if (d.storeAddress) text(d.storeAddress + "\n");
  if (d.storePhone) text(d.storePhone + "\n");
  text("--------------------------------\n");
  // left
  push([0x1b, 0x61, 0x00]);
  text(`Invoice: ${d.invoiceNumber}\n`);
  text(`Date: ${d.dateTime}\n`);
  if (d.cashier) text(`Cashier: ${d.cashier}\n`);
  if (d.customer) text(`Customer: ${d.customer}\n`);
  text("--------------------------------\n");
  for (const it of d.items) {
    const lineTotal = it.qty * it.price - (it.discount ?? 0);
    text(`${it.name}\n`);
    text(`  ${it.qty} x ${it.price.toFixed(2)} = ${lineTotal.toFixed(2)}\n`);
  }
  text("--------------------------------\n");
  text(`Subtotal: ${d.subtotal.toFixed(2)}\n`);
  if (d.discount) text(`Discount: -${d.discount.toFixed(2)}\n`);
  push([0x1d, 0x21, 0x11]);
  text(`TOTAL: ${d.total.toFixed(2)}\n`);
  push([0x1d, 0x21, 0x00]);
  if (d.payments?.length) {
    text("--------------------------------\n");
    for (const p of d.payments) text(`${p.method}: ${p.amount.toFixed(2)}\n`);
  }
  text("--------------------------------\n");
  push([0x1b, 0x61, 0x01]);
  text((d.footer ?? "Thank you") + "\n");
  // feed + cut
  push([0x1b, 0x64, 0x04]);
  push([0x1d, 0x56, 0x42, 0x00]);
  return new Uint8Array(out);
}
