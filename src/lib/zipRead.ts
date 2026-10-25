/**
 * Tiny ZIP reader for the browser, no library: reads the central directory and inflates «deflate» entries with the
 * built-in DecompressionStream («deflate-raw»: Chrome 103+, Safari 16.4+, Firefox 113+). Stored entries are copied.
 * Enough for photos zipped by Windows / macOS / Lovable's storage download (no ZIP64, no encryption).
 */
export type ZipEntry = { name: string; size: number; read: () => Promise<Uint8Array> };

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new (globalThis as any).DecompressionStream("deflate-raw");
  const out = (new Response(data as BodyInit).body as ReadableStream<Uint8Array>).pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function readZip(file: Blob): Promise<ZipEntry[]> {
  // Response reads any Blob (older engines lack Blob.arrayBuffer)
  const buf = new Uint8Array(await new Response(file).arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // end of central directory: last 22..65557 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("الملف ده مش zip سليم");
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(view, p) !== 0x02014b50) throw new Error("الـ zip فيه جزء بايظ");
    const method = u16(view, p + 10);
    const csize = u32(view, p + 20);
    const size = u32(view, p + 24);
    const nlen = u16(view, p + 28), elen = u16(view, p + 30), clen = u16(view, p + 32);
    const local = u32(view, p + 42);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith("/")) continue;
    const lnlen = u16(view, local + 26), lelen = u16(view, local + 28);
    const start = local + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    out.push({
      name, size,
      read: async () => (method === 0 ? raw.slice() : method === 8 ? inflateRaw(raw) : Promise.reject(new Error(`ضغط مش مدعوم (${method})`))),
    });
  }
  return out;
}
