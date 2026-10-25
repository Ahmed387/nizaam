import { DecompressionStream as DS } from "node:stream/web";
(globalThis as any).DecompressionStream ??= DS;
import { describe, it, expect } from "vitest";
import { readZip } from "./zipRead";
import { Blob as NodeBlob } from "node:buffer";
const B = NodeBlob as unknown as typeof Blob;

// made with Python's zipfile: a folder, a deflated entry and a stored entry
const ZIP = "UEsDBBQAAAAAAAFsWV0AAAAAAAAAAAAAAAAHAAAAZm9sZGVyL1BLAwQUAAAACAAAACEAMnmY0hIAAAAEAQAADQAAAGZvbGRlci9hLndlYnDLSM3JyVdISU3LSSxJzRiZHABQSwMEFAAAAAAAAAAhAKZkOLMMAAAADAAAAAUAAABiLmpwZ3N0b3JlZC1ieXRlc1BLAQIUAxQAAAAAAAFsWV0AAAAAAAAAAAAAAAAHAAAAAAAAAAAAEAD9QQAAAABmb2xkZXIvUEsBAhQDFAAAAAgAAAAhADJ5mNISAAAABAEAAA0AAAAAAAAAAAAAAIABJQAAAGZvbGRlci9hLndlYnBQSwECFAMUAAAAAAAAACEApmQ4swwAAAAMAAAABQAAAAAAAAAAAAAAgAFiAAAAYi5qcGdQSwUGAAAAAAMAAwCjAAAAkQAAAAAA";

describe("readZip (no library)", () => {
  it("lists files (not folders) and reads deflated and stored entries", async () => {
    const bytes = Uint8Array.from(atob(ZIP), (c) => c.charCodeAt(0));
    const entries = await readZip(new B([bytes]));
    expect(entries.map((e) => e.name)).toEqual(["folder/a.webp", "b.jpg"]);
    expect(new TextDecoder().decode(await entries[0].read())).toBe("hello deflate".repeat(20));
    expect(new TextDecoder().decode(await entries[1].read())).toBe("stored-bytes");
  });
  it("refuses a file that is not a zip", async () => {
    await expect(readZip(new B([new Uint8Array(40)]))).rejects.toThrow("مش zip");
  });
});
