import { describe, expect, it } from "vitest";
import { tgInviteCode, tgTimeLeft, tgWhatsappHref } from "./telegramInvite";

const URL_ = "https://t.me/Nizam_Taxes_bot?start=0123456789abcdef01234567";
describe("Telegram link for the daily report", () => {
  it("reads the one-time code (for «/start <code>» typed by hand)", () => {
    expect(tgInviteCode(URL_)).toBe("0123456789abcdef01234567");
    expect(tgInviteCode("https://t.me/x?startgroup=0123456789abcdef01234567")).toBe("0123456789abcdef01234567");
    expect(tgInviteCode("https://t.me/x")).toBeNull();
  });
  it("WhatsApp goes to the owner's saved mobile, or lets you pick", () => {
    expect(tgWhatsappHref(URL_, "01001234567")).toMatch(/^https:\/\/wa\.me\/201001234567\?text=/);
    expect(tgWhatsappHref(URL_, null)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(tgWhatsappHref(URL_, null))).toContain(URL_);
  });
  it("15-minute countdown", () => {
    expect(tgTimeLeft(1_000_000 + 900_000, 1_000_000)).toBe("15:00");
    expect(tgTimeLeft(1_000_000 + 61_000, 1_000_000)).toBe("1:01");
    expect(tgTimeLeft(1_000_000, 1_000_000)).toBeNull();
  });
});
