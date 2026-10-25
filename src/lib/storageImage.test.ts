import { describe, it, expect, vi, beforeEach } from "vitest";

const createSignedUrls = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrls }) } } }));
vi.mock("@/lib/compressImage", () => ({ compressImage: vi.fn() }));
vi.mock("@/lib/attachmentPath", () => ({ tenantStoragePath: vi.fn() }));

import { getSignedUrl } from "./storageImage";

describe("product images: few requests, missing files asked once (2026-10-25 connection problem)", () => {
  beforeEach(() => createSignedUrls.mockReset());

  it("images shown together are signed in ONE request", async () => {
    createSignedUrls.mockImplementation(async (...args: any[]) => { const paths: string[] = args[0] ?? []; return ({ data: paths.map((p) => ({ path: p, signedUrl: `https://x/${p}?t=1`, error: null })), error: null }); });
    const urls = await Promise.all(["t/a.webp", "t/b.webp", "t/c.webp"].map((p) => getSignedUrl("product-images", p)));
    expect(urls).toEqual(["https://x/t/a.webp?t=1", "https://x/t/b.webp?t=1", "https://x/t/c.webp?t=1"]);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    // shown again: from the cache, no request
    await getSignedUrl("product-images", "t/a.webp");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it("a missing file is not asked again — even by the image's own retry", async () => {
    createSignedUrls.mockResolvedValue({ data: [{ path: "t/gone.jpg", signedUrl: null, error: "Object not found" }], error: null });
    expect(await getSignedUrl("product-images", "t/gone.jpg")).toBeNull();
    expect(await getSignedUrl("product-images", "t/gone.jpg")).toBeNull();
    expect(await getSignedUrl("product-images", "t/gone.jpg", { force: true })).toBeNull();
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it("800 products = 8 requests, not 800", async () => {
    createSignedUrls.mockImplementation(async (...args: any[]) => { const paths: string[] = args[0] ?? []; return ({ data: paths.map((p) => ({ path: p, signedUrl: null, error: "Object not found" })), error: null }); });
    await Promise.all(Array.from({ length: 800 }, (_, i) => getSignedUrl("product-images", `t/p${i}.webp`)));
    expect(createSignedUrls).toHaveBeenCalledTimes(8);
  });

  it("a failed call (network / limit) is not remembered as missing", async () => {
    createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: "429" } });
    expect(await getSignedUrl("product-images", "t/later.webp")).toBeNull();
    createSignedUrls.mockResolvedValueOnce({ data: [{ path: "t/later.webp", signedUrl: "https://x/ok", error: null }], error: null });
    expect(await getSignedUrl("product-images", "t/later.webp")).toBe("https://x/ok");
  });
});
