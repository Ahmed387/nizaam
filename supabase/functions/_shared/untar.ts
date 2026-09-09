// Minimal TAR reader for the archives produced by _shared/tarGzip.ts.
export type TarEntry = { name: string; bytes: Uint8Array };

const decoder = new TextDecoder();

function readString(block: Uint8Array, offset: number, len: number): string {
  const slice = block.subarray(offset, offset + len);
  const end = slice.indexOf(0);
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end)).trim();
}

export function untar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let pos = 0;
  while (pos + 512 <= buf.byteLength) {
    const header = buf.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const sizeOctal = readString(header, 124, 12);
    const size = parseInt(sizeOctal || "0", 8) || 0;
    pos += 512;
    const bytes = buf.subarray(pos, pos + size);
    entries.push({ name: prefix ? `${prefix}/${name}` : name, bytes });
    pos += size + (size % 512 === 0 ? 0 : 512 - (size % 512));
  }
  return entries;
}

export async function gunzip(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const out = stream.pipeThrough(new DecompressionStream("gzip"));
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = out.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
  return buf;
}
