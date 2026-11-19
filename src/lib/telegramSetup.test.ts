import { describe, expect, it } from "vitest";
import { tgSetupSteps, tgSetupDone, type TgSetupState } from "./telegramSetup";

const base: TgSetupState = {
  bot_ready: true, group_linked: false, group_title: null, tg_linked: false, tg_username: null,
  docs_enabled: false, daily_report_enabled: false, owner_phone: "01012345678", plan_daily_report: true,
};

describe("tgSetupSteps — the platform owner's 4 steps for one company", () => {
  it("a new company: four steps, none done, the group comes first", () => {
    const s = tgSetupSteps(base);
    expect(s.map((x) => x.key)).toEqual(["group", "owner", "docs", "daily"]);
    expect(s.every((x) => !x.done)).toBe(true);
    expect(tgSetupDone(base)).toBe(0);
  });

  it("each step is done by its own fact", () => {
    const s = tgSetupSteps({ ...base, group_linked: true, group_title: "A&N", tg_linked: true, tg_username: "ahmed", docs_enabled: true, daily_report_enabled: true });
    expect(s.every((x) => x.done)).toBe(true);
    expect(s[0].detail).toContain("A&N");
    expect(s[1].detail).toContain("@ahmed");
  });

  it("documents need the group: blocked until it is linked", () => {
    expect(tgSetupSteps(base)[2].blocked).toBe("اربط الجروب الأول");
    expect(tgSetupSteps({ ...base, group_linked: true })[2].blocked).toBeNull();
  });

  it("the daily report needs the owner's Telegram and the plan", () => {
    expect(tgSetupSteps(base)[3].blocked).toBe("اربط تليجرام صاحب الشركة الأول");
    expect(tgSetupSteps({ ...base, tg_linked: true, plan_daily_report: false })[3].blocked).toBe("باقة الشركة مافيهاش التقرير اليومي");
    expect(tgSetupSteps({ ...base, tg_linked: true })[3].blocked).toBeNull();
  });

  it("no bot yet: the two links are blocked", () => {
    const s = tgSetupSteps({ ...base, bot_ready: false });
    expect(s[0].blocked).toBe("جهّز البوت الأول من «نظرة عامة»");
    expect(s[1].blocked).toBe("جهّز البوت الأول من «نظرة عامة»");
  });

  it("no saved mobile: the owner step says so (WhatsApp will ask whom to send to)", () => {
    expect(tgSetupSteps({ ...base, owner_phone: null })[1].hint).toContain("مفيش موبايل");
    expect(tgSetupSteps(base)[1].hint).toContain("01012345678");
  });

  it("counts done steps", () => {
    expect(tgSetupDone({ ...base, group_linked: true, docs_enabled: true })).toBe(2);
  });
});
