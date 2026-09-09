// Minimal streaming TAR writer (ustar) — entries are emitted one by one so the
// function never holds the whole archive in memory. Each entry's bytes must be
// known when it is written, so callers buffer a single entry at a time.

const encoder = new TextEncoder();

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

export function tarHeader(name: string, size: number, mtime = Date.now() / 1000): Uint8Array {
  const block = new Uint8Array(512);
  const put = (str: string, offset: number, len: number) => {
    const bytes = encoder.encode(str);
    block.set(bytes.subarray(0, len), offset);
  };

  let path = name.replace(/^\/+/, "");
  let prefix = "";
  if (path.length > 100) {
    const cut = path.lastIndexOf("/", path.length - 100);
    prefix = cut > 0 ? path.slice(0, cut) : "";
    path = cut > 0 ? path.slice(cut + 1) : path.slice(-100);
  }

  put(path, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(Math.floor(mtime), 12), 136, 12);
  put("        ", 148, 8); // checksum placeholder
  put("0", 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);

  let sum = 0;
  for (const b of block) sum += b;
  put(octal(sum, 7) + " ", 148, 8);
  return block;
}

export function tarPadding(size: number): Uint8Array {
  const rem = size % 512;
  return rem === 0 ? new Uint8Array(0) : new Uint8Array(512 - rem);
}

export const TAR_END = new Uint8Array(1024);

/** Wraps an async byte generator into a gzip-compressed ReadableStream. */
export function gzipStream(source: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  const raw = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await source.next();
      if (done) return controller.close();
      controller.enqueue(value);
    },
    async cancel() {
      await source.return?.(undefined as never);
    },
  });
  return raw.pipeThrough(new CompressionStream("gzip"));
}
