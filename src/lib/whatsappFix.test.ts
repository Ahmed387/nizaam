import { describe, expect, it } from "vitest";
import { phoneProblem, contactFixPath, fixParams, afterPhoneSaved, waReady, withoutWaReady } from "./whatsappFix";

describe("زرار الواتساب لما الرقم مش موجود (owner 2026-11-19)", () => {
  it("phoneProblem: none / missing / a landline that WhatsApp can't open", () => {
    expect(phoneProblem("01001234567")).toBeNull();
    expect(phoneProblem("٠١٠٠١٢٣٤٥٦٧")).toBeNull();
    expect(phoneProblem(null)?.kind).toBe("missing");
    expect(phoneProblem("  ")?.kind).toBe("missing");
    const land = phoneProblem("0862345678");
    expect(land?.kind).toBe("not_mobile");
    expect(land?.text).toContain("0862345678");
  });

  it("the account's page with the phone to fix and the way back", () => {
    expect(contactFixPath({ branchId: "b1", contactId: "c1", back: "/branch/b1/sales/i1" }))
      .toBe("/branch/b1/contacts/c1?fix=phone&back=%2Fbranch%2Fb1%2Fsales%2Fi1");
    expect(contactFixPath({ branchId: null, contactId: "c1", back: "/x" })).toBe("/admin/contacts/c1?fix=phone&back=%2Fx");
  });

  it("reads the request on the account's page; a back path from elsewhere is ignored", () => {
    expect(fixParams("?fix=phone&back=%2Fbranch%2Fb1%2Fsales%2Fi1")).toEqual({ fixPhone: true, back: "/branch/b1/sales/i1" });
    expect(fixParams("?back=https%3A%2F%2Fevil.com").back).toBeNull();
    expect(fixParams("?back=%2F%2Fevil.com").back).toBeNull();
    expect(fixParams("").fixPhone).toBe(false);
  });

  it("after saving: back to the document with wa=ready only when the new number is a mobile", () => {
    expect(afterPhoneSaved({ fixPhone: true, back: "/branch/b1/sales/i1" }, "01001234567")).toBe("/branch/b1/sales/i1?wa=ready");
    expect(afterPhoneSaved({ fixPhone: true, back: "/branch/b1/sales/i1?tab=x" }, "01001234567")).toBe("/branch/b1/sales/i1?tab=x&wa=ready");
    expect(afterPhoneSaved({ fixPhone: true, back: "/branch/b1/sales/i1" }, "0862345678")).toBeNull();
    expect(afterPhoneSaved({ fixPhone: true, back: null }, "01001234567")).toBeNull();
    expect(afterPhoneSaved({ fixPhone: false, back: "/x" }, "01001234567")).toBeNull();
  });

  it("the document notices wa=ready and drops it after", () => {
    expect(waReady("?wa=ready")).toBe(true);
    expect(waReady("?print=1")).toBe(false);
    expect(withoutWaReady("?wa=ready&tab=x")).toBe("tab=x");
  });
});
