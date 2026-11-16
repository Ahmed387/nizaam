import { describe, it, expect } from "vitest";
import { accountKey, accountOfNumber, activeAccountsOf, allowedNow, usedPct, vesselAccountError, type VesselAccount } from "./vesselAccounts";

const acc = (p: Partial<VesselAccount>): VesselAccount => ({
  id: p.id ?? "1", payment_method: p.payment_method ?? "vodafone", employee_id: null,
  holder_name: p.holder_name ?? "أحمد", account_number: p.account_number ?? "01012345678", is_active: p.is_active ?? true,
});

describe("vessel accounts", () => {
  it("normalises numbers like the server", () => {
    expect(accountKey("010 1234-5678")).toBe("01012345678");
    expect(accountKey("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
    expect(accountKey("EG12 ABC")).toBe("eg12abc");
    expect(accountKey(null)).toBe("");
  });
  it("lists only the active accounts of one vessel", () => {
    const l = [acc({ id: "1" }), acc({ id: "2", is_active: false }), acc({ id: "3", payment_method: "instapay" })];
    expect(activeAccountsOf("vodafone", l).map((a) => a.id)).toEqual(["1"]);
    expect(accountOfNumber("vodafone", "٠١٠-١٢٣٤٥٦٧٨", l)?.id).toBe("1");
  });
  it("requires one of the vessel's accounts when it has some", () => {
    const l = [acc({})];
    expect(vesselAccountError({ method: "vodafone", transfer_to_account: "01012345678" }, l)).toBeNull();
    expect(vesselAccountError({ method: "vodafone", transfer_from_account: "010 1234 5678" }, l)).toBeNull();
    expect(vesselAccountError({ method: "vodafone", transfer_to_account: "0109" }, l)).not.toBeNull();
    expect(vesselAccountError({ method: "instapay", transfer_to_account: "x" }, l)).toBeNull();
  });
  it("works out what can still be sent", () => {
    expect(allowedNow({ daily_limit: 60000, monthly_limit: 200000, sent_today: 50000, sent_month: 100000 })).toBe(10000);
    expect(allowedNow({ daily_limit: 60000, monthly_limit: 200000, sent_today: 0, sent_month: 195000 })).toBe(5000);
    expect(allowedNow({ daily_limit: 100, monthly_limit: null, sent_today: 150, sent_month: 0 })).toBe(0);
    expect(allowedNow({ daily_limit: null, monthly_limit: null, sent_today: 5, sent_month: 5 })).toBeNull();
    expect(usedPct(30000, 60000)).toBe(50);
    expect(usedPct(90000, 60000)).toBe(100);
    expect(usedPct(5, null)).toBeNull();
  });
});
