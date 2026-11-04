import { describe, it, expect } from "vitest";
import { crc32, zipStore } from "./zipWrite";
import { readZip } from "./zipRead";
import { Blob as NodeBlob } from "node:buffer";
const B = NodeBlob as unknown as typeof Blob;

describe("folder backup → one zip (0152)", () => {
  it("crc32 matches the known value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("every file of the folder comes back from the zip under the folder name", async () => {
    const a = new TextEncoder().encode('[{"id":1}]');
    const b = new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4]);
    const zip = zipStore([
      { name: "backup-2026-11-04/manifest.json", bytes: a },
      { name: "backup-2026-11-04/invoices.json.gz", bytes: b },
    ]);
    const back = await readZip(new B([zip]));
    expect(back.map((e) => e.name)).toEqual(["backup-2026-11-04/manifest.json", "backup-2026-11-04/invoices.json.gz"]);
    expect(Array.from(await back[1].read())).toEqual(Array.from(b));
    expect(new TextDecoder().decode(await back[0].read())).toBe('[{"id":1}]');
  });
});
