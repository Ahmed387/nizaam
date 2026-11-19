import { describe, expect, it } from "vitest";
import { splitCompanyName } from "./ThermalReceiptPrint";

describe("company name on the receipt", () => {
  it("the Latin brand at the end gets its own line", () => {
    expect(splitCompanyName("شركة ايه اند ان للأجهزة الكهربائية A & N")).toEqual({ main: "شركة ايه اند ان للأجهزة الكهربائية", latin: "A & N" });
  });
  it("an Arabic-only name stays as it is", () => {
    expect(splitCompanyName("معرض الأمل  للأجهزة")).toEqual({ main: "معرض الأمل للأجهزة", latin: null });
  });
  it("a Latin-only name stays as it is", () => {
    expect(splitCompanyName("A & N Electronics")).toEqual({ main: "A & N Electronics", latin: null });
  });
  it("trailing digits alone are not a brand", () => {
    expect(splitCompanyName("معرض 2000")).toEqual({ main: "معرض 2000", latin: null });
  });
});
