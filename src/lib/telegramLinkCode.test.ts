import { describe, expect, it } from "vitest";
import { linkCodeOf } from "../../supabase/functions/telegram/format.ts";

describe("linkCodeOf — what the bot accepts as a link code", () => {
  it("the link's /start with the 6 digits", () => expect(linkCodeOf("/start 123456", false)).toEqual({ code: "123456" }));
  it("in a group with the bot's name", () => expect(linkCodeOf("/start@Nizam_Taxes_bot 004512", true)).toEqual({ code: "004512" }));
  it("/link typed in a group", () => expect(linkCodeOf("/link 778899", true)).toEqual({ code: "778899" }));
  it("the digits alone in a private chat, Arabic digits and spaces too", () => {
    expect(linkCodeOf("123456", false)).toEqual({ code: "123456" });
    expect(linkCodeOf("١٢٣ ٤٥٦", false)).toEqual({ code: "123456" });
  });
  it("digits alone in a group are ignored (any chat number would link)", () => expect(linkCodeOf("123456", true)).toBeNull());
  it("bare /start asks for the code", () => {
    expect(linkCodeOf("/start", false)).toBe("bare");
    expect(linkCodeOf("/start@Nizam_Taxes_bot", true)).toBe("bare");
  });
  it("old 24-letter codes still work", () => expect(linkCodeOf("/start 431812eddb02bc506fc0387c", false)).toEqual({ code: "431812eddb02bc506fc0387c" }));
  it("anything else is not a code", () => {
    expect(linkCodeOf("ازيك", false)).toBeNull();
    expect(linkCodeOf("12345", false)).toBeNull();
  });
});
